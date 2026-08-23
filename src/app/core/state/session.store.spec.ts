import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from './session.store';
import { ForensicsService } from '../forensics/forensics.service';
import { ChatMessage, ParsedChat } from '../models/chat-message.model';
import { computeChatStats } from '../parsing/whatsapp-parser';
import { emptyForensicPayload } from '../models/forensics.model';
import { AnalysisResult } from '../models/report.model';

/**
 * The forensics screen gates its auto-run on these statuses, so "did the store reset them" is the
 * behaviour under test. Stubbed rather than real so no Worker is constructed under jsdom.
 */
class ForensicsServiceStub {
  resetPassesCalls = 0;
  resetPasses(): void {
    this.resetPassesCalls++;
  }
}

function chatWith(participantIds: string[]): ParsedChat {
  const messages: ChatMessage[] = participantIds.map((id, i) => ({
    id: `m${i}`,
    senderId: id,
    text: 'hello there friend',
    timestampMs: 1_000 + i,
    isSystemMessage: false,
    isMediaOmitted: false,
  }));

  return {
    format: 'android',
    messages,
    participants: participantIds.map((id) => ({
      id,
      rawName: id,
      displayName: id,
      messageCount: 1,
      looksLikePhoneNumber: false,
    })),
    stats: computeChatStats(messages, participantIds.length),
  };
}

describe('SessionStore', () => {
  let store: SessionStore;
  let forensics: ForensicsServiceStub;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SessionStore, { provide: ForensicsService, useClass: ForensicsServiceStub }],
    });
    store = TestBed.inject(SessionStore);
    forensics = TestBed.inject(ForensicsService) as unknown as ForensicsServiceStub;
    store.setParsedChat(chatWith(['alice', 'bob']), 'Test chat');
    forensics.resetPassesCalls = 0;
  });

  /** Puts the store in the state it reaches after a completed forensics run. */
  function withFindings(): void {
    store.setForensicPayload({ ...emptyForensicPayload(), leverage: [] });
  }

  describe('editing the chat invalidates stale findings', () => {
    it('drops the payload and resets the passes when the trim window changes', () => {
      withFindings();

      store.setTrimOptions({ maxMessages: 500 });

      expect(store.forensicPayload()).toBeNull();
      expect(forensics.resetPassesCalls).toBe(1);
    });

    it('drops them when a participant is removed', () => {
      withFindings();

      store.removeParticipant('bob');

      expect(store.forensicPayload()).toBeNull();
      expect(forensics.resetPassesCalls).toBe(1);
    });

    it('drops them when participants are merged', () => {
      withFindings();

      store.mergeParticipants('bob', 'alice');

      expect(store.forensicPayload()).toBeNull();
      expect(forensics.resetPassesCalls).toBe(1);
    });

    it('drops them on a rename too', () => {
      // Stricter than strictly necessary — a rename doesn't change which messages are analyzed —
      // but chosen deliberately so "any edit here invalidates" holds without exceptions.
      withFindings();

      store.renameParticipant('alice', 'Alice A.');

      expect(store.forensicPayload()).toBeNull();
      expect(forensics.resetPassesCalls).toBe(1);
    });

    it('leaves findings alone for edits made elsewhere in the flow', () => {
      withFindings();

      store.setSettings({ providerId: 'gemini' });
      store.setAnonymize(true);

      expect(store.forensicPayload()).not.toBeNull();
      expect(forensics.resetPassesCalls).toBe(0);
    });
  });

  describe('merge recomputes stats', () => {
    it('lowers the participant count when two people are folded together', () => {
      expect(store.parsedChat()!.stats.participantCount).toBe(2);

      store.mergeParticipants('bob', 'alice');

      expect(store.parsedChat()!.participants).toHaveLength(1);
      expect(store.parsedChat()!.stats.participantCount).toBe(1);
    });
  });

  describe('a new chat is a new analysis', () => {
    it('wipes findings, settings, consent and the previous report', () => {
      withFindings();
      store.setSettings({ providerId: 'gemini', modelId: 'gemini-3-flash-preview', apiKey: 'secret' });
      store.setAnonymize(true);
      store.giveConsent();
      store.completeAnalysis({ dossiers: [] } as unknown as AnalysisResult, {} as never, true);

      store.setParsedChat(chatWith(['carol']), 'Different chat');

      expect(store.forensicPayload()).toBeNull();
      expect(store.settings().providerId).toBeNull();
      expect(store.settings().apiKey).toBe('');
      expect(store.anonymize()).toBe(false);
      expect(store.consentGiven()).toBe(false);
      expect(store.analysisResult()).toBeNull();
      expect(store.analysisMetadata()).toBeNull();
      expect(store.usedFallbackParser()).toBe(false);
      expect(store.analysisStatus()).toBe('idle');
      expect(forensics.resetPassesCalls).toBeGreaterThan(0);
    });

    it('keeps the chat that was just loaded', () => {
      store.setParsedChat(chatWith(['carol']), 'Different chat');

      expect(store.chatName()).toBe('Different chat');
      expect(store.parsedChat()!.participants.map((p) => p.id)).toEqual(['carol']);
      expect(store.trimOptions()).toEqual({});
    });
  });

  describe('starting a run', () => {
    it('clears the previous run output, including the fallback-parser flag', () => {
      store.completeAnalysis({ dossiers: [] } as unknown as AnalysisResult, {} as never, true);
      expect(store.usedFallbackParser()).toBe(true);

      store.startAnalysis();

      expect(store.analysisResult()).toBeNull();
      expect(store.analysisMetadata()).toBeNull();
      expect(store.analysisError()).toBeNull();
      expect(store.usedFallbackParser()).toBe(false);
      expect(store.analysisStatus()).toBe('running');
    });

    it('keeps the inputs the run itself depends on', () => {
      // Wiping these mid-run would fail the route guards and abort the analysis being started.
      store.setSettings({ providerId: 'gemini', modelId: 'gemini-3-flash-preview', apiKey: 'secret' });
      store.giveConsent();
      withFindings();

      store.startAnalysis();

      expect(store.settings().apiKey).toBe('secret');
      expect(store.consentGiven()).toBe(true);
      expect(store.forensicPayload()).not.toBeNull();
    });
  });

  describe('invalidateForensics — the on-device limit case', () => {
    it('clears the findings and resets the passes', () => {
      withFindings();

      store.invalidateForensics();

      expect(store.forensicPayload()).toBeNull();
      expect(forensics.resetPassesCalls).toBe(1);
    });

    it('touches nothing outside the forensics screen', () => {
      // The whole point of exposing this: changing an on-device limit must not cost the user
      // their chat, provider, key or consent.
      store.setSettings({ providerId: 'local', modelId: 'gemma-3-1b', apiKey: 'secret' });
      store.giveConsent();
      withFindings();

      store.invalidateForensics();

      expect(store.parsedChat()).not.toBeNull();
      expect(store.settings().providerId).toBe('local');
      expect(store.settings().modelId).toBe('gemma-3-1b');
      expect(store.settings().apiKey).toBe('secret');
      expect(store.consentGiven()).toBe(true);
    });
  });

  describe('clearAnalysisResult — the token-budget case', () => {
    it('drops a finished report and its flags', () => {
      store.completeAnalysis({ dossiers: [] } as unknown as AnalysisResult, {} as never, true);

      store.clearAnalysisResult();

      expect(store.analysisResult()).toBeNull();
      expect(store.analysisMetadata()).toBeNull();
      expect(store.usedFallbackParser()).toBe(false);
      expect(store.analysisStatus()).toBe('idle');
    });

    it('leaves the findings and the inputs that produced them intact', () => {
      withFindings();
      store.setSettings({ providerId: 'local', modelId: 'gemma-3-1b' });
      store.giveConsent();
      store.completeAnalysis({ dossiers: [] } as unknown as AnalysisResult, {} as never, false);

      store.clearAnalysisResult();

      expect(store.forensicPayload()).not.toBeNull();
      expect(forensics.resetPassesCalls).toBe(0);
      expect(store.consentGiven()).toBe(true);
      expect(store.settings().modelId).toBe('gemma-3-1b');
    });
  });

  describe('reset', () => {
    it('clears the chat and resets the forensics passes', () => {
      withFindings();
      store.giveConsent();

      store.reset();

      expect(store.parsedChat()).toBeNull();
      expect(store.chatName()).toBe('');
      expect(store.forensicPayload()).toBeNull();
      expect(store.consentGiven()).toBe(false);
      expect(forensics.resetPassesCalls).toBeGreaterThan(0);
    });
  });
});
