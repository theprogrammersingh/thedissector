import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { LocalLimitsService } from '../../core/local-llm/local-limits.service';
import { SessionStore } from '../../core/state/session.store';
import { ProviderRegistry } from '../../core/providers/provider-registry';
import { buildTrimmedTranscript } from '../../core/parsing/trim-chat';
import { AppButton } from '../../shared/ui/app-button/app-button';

// Rough headroom reserved for the system prompt itself and the model's output tokens,
// on top of the transcript, when deciding whether the chat needs auto-trimming.
const RESERVED_FOR_PROMPT_AND_OUTPUT = 4000;

@Component({
  selector: 'app-consent-page',
  imports: [AppButton, DecimalPipe],
  templateUrl: './consent-page.html',
  styleUrl: './consent-page.scss',
})
export class ConsentPage {
  private readonly store = inject(SessionStore);
  private readonly registry = inject(ProviderRegistry);
  private readonly router = inject(Router);
  private readonly limits = inject(LocalLimitsService);

  protected readonly settings = this.store.settings;
  protected readonly anonymize = this.store.anonymize;
  protected readonly consentChecked = signal(this.store.consentGiven());

  protected readonly providerLabel = computed(() => {
    const id = this.settings().providerId;
    return id ? this.registry.get(id).label : '';
  });

  protected readonly isLocal = computed(() => this.settings().providerId === 'local');

  /** Non-null only when the on-device message cap actually narrowed what was analyzed. */
  protected readonly localCapNotice = computed(() => {
    if (!this.isLocal()) return null;
    const total = this.store.parsedChat()?.stats.messageCount ?? 0;
    const limit = this.limits.maxMessages();
    return total > limit ? { total, limit } : null;
  });

  /**
   * On-device runs are built from the forensics findings instead of the chat text, so no
   * transcript is sent and nothing is truncated — the trim warning would be false here.
   */
  protected readonly usesEvidenceOnly = computed(() => {
    const payload = this.store.forensicPayload();
    return this.isLocal() && !!payload && payload.leverage.length > 0;
  });

  /**
   * What the on-device forensics passes added to the payload, in plain terms. The consent
   * gate has to name everything that's about to be sent (PRD FR-8) — quietly appending a
   * forensic brief to the transcript would break that promise.
   */
  protected readonly briefContents = computed(() => {
    const payload = this.store.forensicPayload();
    if (!payload) return [];
    const parts: string[] = [];
    if (payload.leverage.length) parts.push(`behavioral metrics for ${payload.leverage.length} participants`);
    if (payload.receipts.length) parts.push(`${payload.receipts.length} flagged quotes from the chat`);
    if (payload.emotionProfiles.length) parts.push(`${payload.emotionProfiles.length} emotional profiles`);
    if (payload.emotionTimeline.length) parts.push('a month-by-month tension timeline');
    return parts;
  });

  protected readonly trimPreview = computed(() => {
    const chat = this.store.parsedChat();
    const s = this.settings();
    if (!chat || !s.providerId || !s.modelId) return null;
    const model = this.registry.get(s.providerId).models.find((m) => m.id === s.modelId);
    if (!model) return null;
    const trim = this.store.trimOptions();
    return buildTrimmedTranscript(
      chat,
      { anonymize: this.anonymize(), startMs: trim.startMs, endMs: trim.endMs, maxMessages: trim.maxMessages },
      model.contextWindowTokens,
      RESERVED_FOR_PROMPT_AND_OUTPUT,
    );
  });

  toggleAnonymize(): void {
    this.store.setAnonymize(!this.anonymize());
  }

  toggleConsent(): void {
    this.consentChecked.set(!this.consentChecked());
  }

  proceed(): void {
    if (!this.consentChecked()) return;
    this.store.giveConsent();
    this.router.navigate(['/analysis']);
  }

  back(): void {
    this.router.navigate(['/settings']);
  }
}
