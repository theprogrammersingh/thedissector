import { Injectable, signal } from '@angular/core';
import { LOCAL_MAX_INPUT_TOKENS, LOCAL_MAX_MESSAGES } from './run-pass-with-retry';

const STORAGE_KEY = 'dissector.local-limits';

interface StoredLimits {
  maxMessages?: number;
  maxInputTokens?: number;
}

/**
 * How much work this particular device is willing to do on-device.
 *
 * Deliberately NOT part of SessionStore: these describe the machine, not the conversation, and
 * `setParsedChat` wipes the session on every new chat — a limit the user tuned to their GPU has to
 * outlive that. Persisted to localStorage for the same reason: the right value is a property of
 * the hardware, so re-discovering it per tab would be busywork.
 *
 * Both defaults are conservative rather than optimal. The on-device input ceiling is genuinely not
 * known (see LOCAL_MAX_INPUT_TOKENS) — the honest design is a safe default plus a control, not a
 * confident number.
 */
@Injectable({ providedIn: 'root' })
export class LocalLimitsService {
  readonly maxMessages = signal(LOCAL_MAX_MESSAGES);
  readonly maxInputTokens = signal(LOCAL_MAX_INPUT_TOKENS);

  /** The last run's real tokenized prompt length — the number worth tuning against. */
  readonly lastMeasuredInputTokens = signal<number | null>(null);

  constructor() {
    const stored = this.read();
    if (stored.maxMessages !== undefined) this.maxMessages.set(stored.maxMessages);
    if (stored.maxInputTokens !== undefined) this.maxInputTokens.set(stored.maxInputTokens);
  }

  setMaxMessages(value: number): void {
    this.maxMessages.set(clamp(value, 100, 1_000_000, LOCAL_MAX_MESSAGES));
    this.persist();
  }

  setMaxInputTokens(value: number): void {
    this.maxInputTokens.set(clamp(value, 200, 32_000, LOCAL_MAX_INPUT_TOKENS));
    this.persist();
  }

  private read(): StoredLimits {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const { maxMessages, maxInputTokens } = parsed as StoredLimits;
      return {
        maxMessages: isUsable(maxMessages) ? maxMessages : undefined,
        maxInputTokens: isUsable(maxInputTokens) ? maxInputTokens : undefined,
      };
    } catch {
      // Corrupt entry, or storage blocked entirely (private mode, embedded webview) — the
      // defaults are the whole point of having defaults.
      return {};
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ maxMessages: this.maxMessages(), maxInputTokens: this.maxInputTokens() }),
      );
    } catch {
      // Non-fatal: the limit still applies for this tab, it just won't be remembered.
    }
  }
}

function isUsable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
