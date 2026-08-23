import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionStore } from '../../core/state/session.store';
import { ProviderRegistry } from '../../core/providers/provider-registry';
import { buildTrimmedTranscript, TrimResult } from '../../core/parsing/trim-chat';
import { buildDisplayNameMap } from '../../core/parsing/transcript-builder';
import { SYSTEM_PROMPT } from '../../core/prompts/system-prompt';
import { renderForensicBrief } from '../../core/prompts/forensic-brief';
import { buildEvidencePack } from '../../core/prompts/local/evidence-pack';
import { sampleParticipantQuotes } from '../../core/forensics/quote-sample';
import { EvidencePack } from '../../core/providers/provider.types';
import { ParsedChat } from '../../core/models/chat-message.model';
import { LocalModelService } from '../../core/local-llm/local-model.service';
import { LOCAL_PROMPT_OVERHEAD_TOKENS } from '../../core/local-llm/run-pass-with-retry';
import { LocalLimitsService } from '../../core/local-llm/local-limits.service';
import { capRecentMessages } from '../../core/parsing/cap-messages';
import { AppButton } from '../../shared/ui/app-button/app-button';
import { estimateTokenCount } from '../../shared/utils/token-estimate';
import { prefersReducedMotion } from '../../shared/utils/reduced-motion';

const RESERVED_FOR_PROMPT_AND_OUTPUT = 4000;
const STATUS_ROTATE_MS = 2200;

@Component({
  selector: 'app-analysis-loading-page',
  imports: [AppButton],
  templateUrl: './analysis-loading-page.html',
  styleUrl: './analysis-loading-page.scss',
})
export class AnalysisLoadingPage implements OnInit, OnDestroy {
  private readonly store = inject(SessionStore);
  private readonly registry = inject(ProviderRegistry);
  private readonly router = inject(Router);
  private readonly localModel = inject(LocalModelService);
  private readonly limits = inject(LocalLimitsService);

  /** Shown when a lost GPU device forced the model to be dropped and reloaded mid-run. */
  protected readonly recoveredFromDeviceLoss = this.localModel.recoveredFromDeviceLoss;

  /**
   * The raw runtime message, when it differs from the summary shown above it. On-device failures
   * never reach a server, so the user is the only one who can see what actually broke.
   */
  protected readonly errorDetail = computed(() => {
    const err = this.error();
    return err?.detail && err.detail !== err.message ? err.detail : null;
  });

  protected readonly status = this.store.analysisStatus;
  protected readonly error = this.store.analysisError;
  protected readonly reducedMotion = prefersReducedMotion();

  protected readonly statusLines = computed(() => {
    const names = this.store.parsedChat()?.participants.map((p) => p.displayName) ?? [];
    const lines = ['Cross-referencing the transcript…', 'Weighing red flags against redeeming qualities…'];
    for (const name of names) lines.push(`Building a profile on ${name}…`);
    lines.push('Drafting the verdict…');
    return lines;
  });

  protected readonly currentStatusIndex = signal(0);
  private rotationHandle: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;
  private lastTrim: TrimResult | null = null;

  ngOnInit(): void {
    this.rotationHandle = setInterval(() => {
      this.currentStatusIndex.update((i) => (i + 1) % this.statusLines().length);
    }, STATUS_ROTATE_MS);
    void this.runAnalysis();
  }

  ngOnDestroy(): void {
    if (this.rotationHandle) clearInterval(this.rotationHandle);
    this.controller?.abort();
  }

  private async runAnalysis(): Promise<void> {
    const chat = this.store.parsedChat();
    const settings = this.store.settings();
    if (!chat || !settings.providerId || !settings.modelId) {
      // Reachable if the store is cleared from another screen mid-navigation. Returning silently
      // left the user on "Preparing…" with no error and no way out but a reload.
      this.store.failAnalysis({
        kind: 'unknown',
        message: 'The chat or provider settings went missing before the analysis could start. Go back and set them again.',
      });
      return;
    }

    const provider = this.registry.get(settings.providerId);
    const model = provider.models.find((m) => m.id === settings.modelId);
    if (!model) {
      // A stale `modelId` — one retired from a provider's lineup between sessions — passes
      // `hasSettings()` and every route guard, then dies here, after the user has consented.
      this.store.failAnalysis({
        kind: 'unknown',
        message: `"${settings.modelId}" is no longer offered by ${provider.label}. Go back to Provider & model and pick another one.`,
      });
      return;
    }

    const payload = this.store.forensicPayload();
    const anonymize = this.store.anonymize();
    const displayNames = buildDisplayNameMap(chat.participants, anonymize);

    // A local model's practical context is ~8K, so the transcript it would otherwise get is
    // hard-truncated to a recent tail. The evidence pack is computed over the whole chat, so
    // sending it INSTEAD raises coverage while shrinking the payload.
    // Must match the window the forensics passes used, or the evidence pack's quotes and message
    // counts would describe a wider conversation than the findings they sit next to.
    const analysisChat =
      provider.id === 'local' ? capRecentMessages(chat, this.limits.maxMessages()) : chat;

    const evidencePack =
      provider.id === 'local' && payload && payload.leverage.length > 0
        ? this.buildPack(analysisChat, anonymize, displayNames)
        : undefined;

    let transcript = '';
    if (!evidencePack) {
      // The brief is built first so its tokens come out of the same context budget the
      // transcript is trimmed against — otherwise appending it could overflow the window.
      // Local never takes this branch with a brief attached: `parseTranscriptLines` would
      // swallow the brief as message continuations.
      const brief = provider.id === 'local' || !payload ? '' : renderForensicBrief(payload, displayNames);

      const trim = this.store.trimOptions();
      // On-device budgets against the real input ceiling, not the advertised context window:
      // this branch is reachable for local when forensics was skipped, and 8192 − 4000 would
      // hand the model several times what it can actually run.
      const budgetTokens =
        provider.id === 'local'
          ? this.limits.maxInputTokens() + RESERVED_FOR_PROMPT_AND_OUTPUT
          : model.contextWindowTokens;
      const trimResult = buildTrimmedTranscript(
        analysisChat,
        { anonymize, startMs: trim.startMs, endMs: trim.endMs, maxMessages: trim.maxMessages },
        budgetTokens,
        RESERVED_FOR_PROMPT_AND_OUTPUT + estimateTokenCount(brief),
      );
      this.lastTrim = trimResult;
      transcript = brief ? `${trimResult.transcript}\n\n${brief}` : trimResult.transcript;
    }

    this.controller = new AbortController();
    this.store.startAnalysis();

    const outcome = await provider.analyze(settings.apiKey, {
      systemPrompt: SYSTEM_PROMPT,
      transcript,
      evidencePack,
      modelId: settings.modelId,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      // Names as the MODEL sees them, not as the report displays them. Every consumer wants
      // it that way: the dossier prompts address participants by name, `buildParticipantStats`
      // matches them against transcript senders, and the markdown fallback parser matches them
      // against the model's own headings — all of which use anonymized labels when the toggle
      // is on. Ids stay real, since that is what the report cross-references dossiers by.
      knownParticipants: chat.participants.map((p) => ({
        id: p.id,
        displayName: displayNames.get(p.id) ?? p.displayName,
      })),
      signal: this.controller.signal,
    });

    if (this.store.analysisStatus() === 'cancelled') return;

    if (!outcome.ok) {
      this.store.failAnalysis(outcome.error);
      return;
    }

    this.store.completeAnalysis(
      outcome.value.analysis,
      {
        providerId: provider.id,
        modelId: settings.modelId,
        consentGivenAt: this.store.consentGivenAt() ?? new Date().toISOString(),
        anonymized: this.store.anonymize(),
        generatedAt: new Date().toISOString(),
        chatName: this.store.chatName(),
      },
      outcome.value.usedFallbackParser,
    );
    this.router.navigate(['/report']);
  }

  /**
   * Renders the whole-group pack plus one narrowed pack per participant. Narrowing happens
   * here because the provider only receives rendered text and cannot re-scope it — and it is
   * what keeps an 8-person group inside a small model's context.
   */
  private buildPack(
    chat: ParsedChat,
    anonymize: boolean,
    displayNames: Map<string, string>,
  ): EvidencePack {
    const payload = this.store.forensicPayload()!;
    const quotes = sampleParticipantQuotes(chat, { anonymize });
    const messageCounts = new Map(chat.participants.map((p) => [p.id, p.messageCount]));
    // The budget is what keeps this path inside what onnxruntime can actually run: the pack is
    // derived from every message in the chat, so without it a long chat renders a prompt that
    // overflows the model's tensor size math. See LOCAL_MAX_EVIDENCE_TOKENS for the arithmetic.
    const maxTokens = Math.max(this.limits.maxInputTokens() - LOCAL_PROMPT_OVERHEAD_TOKENS, 200);
    const base = { payload, displayNames, quotes, messageCounts, maxTokens };

    const byParticipant: Record<string, string> = {};
    for (const participant of chat.participants) {
      byParticipant[participant.id] = buildEvidencePack({ ...base, participantIds: [participant.id] });
    }

    return { group: buildEvidencePack(base), byParticipant };
  }

  cancel(): void {
    this.controller?.abort();
    this.store.cancelAnalysis();
    this.router.navigate(['/consent']);
  }

  retry(): void {
    void this.runAnalysis();
  }

  /** Shrinks the trim cap to fit under Gemini's reported free-tier input-token quota, then retries. */
  reduceAndRetry(): void {
    const suggestedMaxInputTokens = this.error()?.suggestedMaxInputTokens;
    const trim = this.lastTrim;
    if (!suggestedMaxInputTokens || !trim || trim.estimatedTokens <= 0 || trim.keptMessageCount <= 0) return;

    const targetTokens = Math.max(suggestedMaxInputTokens - RESERVED_FOR_PROMPT_AND_OUTPUT, 1000) * 0.85;
    const tokensPerMessage = trim.estimatedTokens / trim.keptMessageCount;
    const newMaxMessages = Math.max(1, Math.floor(targetTokens / tokensPerMessage));

    this.store.setTrimOptions({ ...this.store.trimOptions(), maxMessages: newMaxMessages });
    void this.runAnalysis();
  }

  backToSettings(): void {
    this.router.navigate(['/settings']);
  }
}
