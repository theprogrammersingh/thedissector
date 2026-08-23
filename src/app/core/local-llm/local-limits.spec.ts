import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalLimitsService } from './local-limits.service';
import { LOCAL_MAX_INPUT_TOKENS, LOCAL_MAX_MESSAGES } from './run-pass-with-retry';

const STORAGE_KEY = 'dissector.local-limits';

function makeService(): LocalLimitsService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [LocalLimitsService] });
  return TestBed.inject(LocalLimitsService);
}

describe('LocalLimitsService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts from the module defaults when nothing is stored', () => {
    const limits = makeService();

    expect(limits.maxMessages()).toBe(LOCAL_MAX_MESSAGES);
    expect(limits.maxInputTokens()).toBe(LOCAL_MAX_INPUT_TOKENS);
  });

  it('persists a raised limit and reads it back on a fresh instance', () => {
    // The whole point: a value tuned to this device must outlive the session, which
    // SessionStore.setParsedChat wipes on every new chat.
    makeService().setMaxMessages(8000);

    expect(makeService().maxMessages()).toBe(8000);
  });

  it('persists both limits independently', () => {
    const limits = makeService();
    limits.setMaxMessages(5000);
    limits.setMaxInputTokens(4000);

    const reloaded = makeService();
    expect(reloaded.maxMessages()).toBe(5000);
    expect(reloaded.maxInputTokens()).toBe(4000);
  });

  it('falls back to defaults on a corrupt entry rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all');

    const limits = makeService();

    expect(limits.maxMessages()).toBe(LOCAL_MAX_MESSAGES);
    expect(limits.maxInputTokens()).toBe(LOCAL_MAX_INPUT_TOKENS);
  });

  it('ignores stored values of the wrong shape or sign', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ maxMessages: -5, maxInputTokens: 'lots' }));

    const limits = makeService();

    expect(limits.maxMessages()).toBe(LOCAL_MAX_MESSAGES);
    expect(limits.maxInputTokens()).toBe(LOCAL_MAX_INPUT_TOKENS);
  });

  it('clamps values a user could type into the number field', () => {
    const limits = makeService();

    limits.setMaxMessages(1);
    expect(limits.maxMessages()).toBe(100);

    limits.setMaxInputTokens(999_999);
    expect(limits.maxInputTokens()).toBe(32_000);
  });

  it('falls back rather than storing NaN from an emptied input', () => {
    const limits = makeService();

    limits.setMaxInputTokens(Number.NaN);

    expect(limits.maxInputTokens()).toBe(LOCAL_MAX_INPUT_TOKENS);
  });

  it('still applies the limit for this tab when storage is unavailable', () => {
    const limits = makeService();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => limits.setMaxMessages(3000)).not.toThrow();
    expect(limits.maxMessages()).toBe(3000);
  });
});
