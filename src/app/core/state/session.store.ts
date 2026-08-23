import { Injectable, computed, inject, signal } from '@angular/core';
import { ParsedChat } from '../models/chat-message.model';
import { AnalysisMetadata, AnalysisResult } from '../models/report.model';
import { ForensicPayload } from '../models/forensics.model';
import { AnalysisSettings, DEFAULT_ANALYSIS_SETTINGS } from '../models/provider.model';
import { ProviderError } from '../providers/provider.types';
import { computeChatStats } from '../parsing/whatsapp-parser';
import { LocalModelService } from '../local-llm/local-model.service';
import { ForensicsService } from '../forensics/forensics.service';

export type AnalysisStatus = 'idle' | 'running' | 'error' | 'done' | 'cancelled';

export interface TrimOptions {
  startMs?: number;
  endMs?: number;
  maxMessages?: number;
}

/**
 * Single signal-based store for the whole upload → report flow. The API key lives only
 * here, in memory, for the life of this tab — it is never written to any storage.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly localModel = inject(LocalModelService);
  // Safe to inject: ForensicsService does not depend on this store (the forensics page is what
  // writes results back), so there is no cycle.
  private readonly forensics = inject(ForensicsService);

  readonly parsedChat = signal<ParsedChat | null>(null);
  readonly chatName = signal<string>('');
  readonly trimOptions = signal<TrimOptions>({});

  readonly settings = signal<AnalysisSettings>(DEFAULT_ANALYSIS_SETTINGS);
  readonly anonymize = signal<boolean>(false);

  readonly forensicPayload = signal<ForensicPayload | null>(null);

  readonly consentGiven = signal<boolean>(false);
  readonly consentGivenAt = signal<string | null>(null);

  readonly analysisStatus = signal<AnalysisStatus>('idle');
  readonly analysisResult = signal<AnalysisResult | null>(null);
  readonly analysisMetadata = signal<AnalysisMetadata | null>(null);
  readonly analysisError = signal<ProviderError | null>(null);
  readonly usedFallbackParser = signal<boolean>(false);

  readonly hasParsedChat = computed(() => this.parsedChat() !== null);
  readonly hasSettings = computed(() => {
    const s = this.settings();
    if (!s.providerId || !s.modelId) return false;
    if (s.providerId === 'local') {
      return this.localModel.isReady() && this.localModel.selectedModelKey() === s.modelId;
    }
    return s.apiKey.trim().length > 0;
  });
  readonly hasConsent = computed(() => this.consentGiven());
  readonly hasResult = computed(() => this.analysisResult() !== null);

  /**
   * A new chat is a new analysis, so everything downstream of it goes: findings, settings,
   * consent, and any previous report. Without this a second upload inherits the first chat's
   * forensic payload and result, and the report screen can show a dossier for a conversation
   * that is no longer loaded.
   */
  setParsedChat(chat: ParsedChat, chatName: string): void {
    this.clearForNewAnalysis();
    this.parsedChat.set(chat);
    this.chatName.set(chatName);
    this.trimOptions.set({});
  }

  renameParticipant(participantId: string, displayName: string): void {
    const chat = this.parsedChat();
    if (!chat) return;
    this.parsedChat.set({
      ...chat,
      participants: chat.participants.map((p) => (p.id === participantId ? { ...p, displayName } : p)),
    });
    this.invalidateForensics();
  }

  /** Folds `fromId`'s messages and count into `intoId` (e.g. merging a phone-number ID with a named duplicate). */
  mergeParticipants(fromId: string, intoId: string): void {
    const chat = this.parsedChat();
    if (!chat || fromId === intoId) return;
    const from = chat.participants.find((p) => p.id === fromId);
    const into = chat.participants.find((p) => p.id === intoId);
    if (!from || !into) return;

    const messages = chat.messages.map((m) => (m.senderId === fromId ? { ...m, senderId: intoId } : m));
    const participants = chat.participants
      .filter((p) => p.id !== fromId)
      .map((p) => (p.id === intoId ? { ...p, messageCount: p.messageCount + from.messageCount } : p));

    this.parsedChat.set({
      ...chat,
      messages,
      participants,
      // Merging drops a participant, so the cached participant count is now wrong — the same
      // reason removeParticipant recomputes.
      stats: computeChatStats(messages, participants.length),
    });
    this.invalidateForensics();
  }

  /** Removes a participant and cascade-deletes every message they sent, recomputing stats. */
  removeParticipant(participantId: string): void {
    const chat = this.parsedChat();
    if (!chat) return;
    const participants = chat.participants.filter((p) => p.id !== participantId);
    if (participants.length === chat.participants.length) return;
    const messages = chat.messages.filter((m) => m.senderId !== participantId);
    this.parsedChat.set({
      ...chat,
      messages,
      participants,
      stats: computeChatStats(messages, participants.length),
    });
    this.invalidateForensics();
  }

  setTrimOptions(options: TrimOptions): void {
    this.trimOptions.set(options);
    this.invalidateForensics();
  }

  setSettings(patch: Partial<AnalysisSettings>): void {
    this.settings.update((current) => ({ ...current, ...patch }));
    this.revokeConsentIfGiven();
  }

  /**
   * Deliberately does NOT revoke consent: the forensics passes run *before* the consent gate,
   * and the consent screen reports what they produced. Revoking here would make the gate
   * un-passable.
   */
  setForensicPayload(payload: ForensicPayload | null): void {
    this.forensicPayload.set(payload);
  }

  setAnonymize(anonymize: boolean): void {
    this.anonymize.set(anonymize);
    this.revokeConsentIfGiven();
  }

  /**
   * Anything that changes which messages or people get analyzed makes the existing findings
   * describe a chat that no longer exists. Clearing the payload alone is not enough: the
   * forensics screen also gates its auto-run on ForensicsService's pass statuses, which are
   * sticky, so both have to go together or the screen shows "Complete" over nothing.
   *
   * Lives in the store rather than at each call site — same reasoning as revokeConsentIfGiven
   * below — so a mutator added later cannot quietly skip it.
   *
   * Public because the on-device message limit lives outside this store (LocalLimitsService) but
   * decides which messages the passes read. Its blast radius is deliberately narrow: findings and
   * pass statuses only — the chat, provider, key and consent all survive.
   */
  invalidateForensics(): void {
    this.forensicPayload.set(null);
    this.forensics.resetPasses();
  }

  /** Everything downstream of the chat itself. Shared by `setParsedChat` and `reset`. */
  private clearForNewAnalysis(): void {
    this.settings.set(DEFAULT_ANALYSIS_SETTINGS);
    this.anonymize.set(false);
    this.invalidateForensics();
    this.consentGiven.set(false);
    this.consentGivenAt.set(null);
    this.clearAnalysisResult();
  }

  private revokeConsentIfGiven(): void {
    // Changing settings/anonymization after consenting re-opens the gate — consent has to
    // stay attached to what's actually about to be sent (PRD FR-8).
    if (this.consentGiven()) {
      this.consentGiven.set(false);
      this.consentGivenAt.set(null);
    }
  }

  giveConsent(): void {
    this.consentGiven.set(true);
    this.consentGivenAt.set(new Date().toISOString());
  }

  /**
   * Clears the previous run's output only. It deliberately leaves provider/key/consent and the
   * forensic payload alone: this fires *during* a dissection, and the analysis reads all of them
   * — wiping them here would fail the route guards and abort the run it is starting. The full
   * wipe belongs at the two real new-analysis boundaries, `setParsedChat` and `reset`.
   */
  startAnalysis(): void {
    this.clearAnalysisResult();
    this.analysisStatus.set('running');
  }

  /**
   * Drops a finished (or failed) run's output without touching anything it was produced from.
   * Used both at the start of a new run and when a setting changes that affects the analysis
   * but not the findings — the on-device token budget being the case in point.
   */
  clearAnalysisResult(): void {
    this.analysisStatus.set('idle');
    this.analysisError.set(null);
    this.analysisResult.set(null);
    this.analysisMetadata.set(null);
    this.usedFallbackParser.set(false);
  }

  completeAnalysis(result: AnalysisResult, metadata: AnalysisMetadata, usedFallbackParser: boolean): void {
    this.analysisResult.set(result);
    this.analysisMetadata.set(metadata);
    this.usedFallbackParser.set(usedFallbackParser);
    this.analysisStatus.set('done');
  }

  failAnalysis(error: ProviderError): void {
    this.analysisError.set(error);
    this.analysisStatus.set('error');
  }

  cancelAnalysis(): void {
    this.analysisStatus.set('cancelled');
  }

  reset(): void {
    this.parsedChat.set(null);
    this.chatName.set('');
    this.trimOptions.set({});
    this.clearForNewAnalysis();
  }
}
