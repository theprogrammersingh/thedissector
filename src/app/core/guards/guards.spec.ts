import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../state/session.store';
import { ParsedChat } from '../models/chat-message.model';
import { hasParsedChatGuard } from './has-parsed-chat.guard';
import { hasSettingsGuard } from './has-settings.guard';
import { hasConsentGuard } from './has-consent.guard';
import { hasAnalysisResultGuard } from './has-analysis-result.guard';

const EMPTY_CHAT: ParsedChat = {
  format: 'android',
  messages: [],
  participants: [],
  stats: { messageCount: 0, participantCount: 0, dateRangeStart: null, dateRangeEnd: null, longestGapMs: null },
};

function runGuard(guard: () => boolean | UrlTree) {
  return TestBed.runInInjectionContext(guard);
}

describe('route guards', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('hasParsedChatGuard redirects to /upload when no chat has been parsed', () => {
    const result = runGuard(() => hasParsedChatGuard({} as any, {} as any) as boolean | UrlTree);
    expect(result).not.toBe(true);
    expect((result as UrlTree).toString()).toBe('/upload');
  });

  it('hasParsedChatGuard allows navigation once a chat is parsed', () => {
    TestBed.inject(SessionStore).setParsedChat(EMPTY_CHAT, 'Test Chat');
    const result = runGuard(() => hasParsedChatGuard({} as any, {} as any) as boolean | UrlTree);
    expect(result).toBe(true);
  });

  it('hasSettingsGuard redirects to /settings until provider, model, and key are set', () => {
    const result = runGuard(() => hasSettingsGuard({} as any, {} as any) as boolean | UrlTree);
    expect(result).not.toBe(true);

    TestBed.inject(SessionStore).setSettings({ providerId: 'anthropic', modelId: 'claude-sonnet-5', apiKey: 'sk-test' });
    const afterSettings = runGuard(() => hasSettingsGuard({} as any, {} as any) as boolean | UrlTree);
    expect(afterSettings).toBe(true);
  });

  it('hasConsentGuard redirects to /consent until consent is given, and settings changes revoke it', () => {
    const store = TestBed.inject(SessionStore);
    expect(runGuard(() => hasConsentGuard({} as any, {} as any) as boolean | UrlTree)).not.toBe(true);

    store.giveConsent();
    expect(runGuard(() => hasConsentGuard({} as any, {} as any) as boolean | UrlTree)).toBe(true);

    store.setAnonymize(true);
    expect(runGuard(() => hasConsentGuard({} as any, {} as any) as boolean | UrlTree)).not.toBe(true);
  });

  it('hasAnalysisResultGuard redirects to /analysis until a result exists', () => {
    const result = runGuard(() => hasAnalysisResultGuard({} as any, {} as any) as boolean | UrlTree);
    expect(result).not.toBe(true);
  });
});
