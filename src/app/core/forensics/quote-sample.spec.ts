import { describe, expect, it } from 'vitest';
import { ChatMessage, ParsedChat } from '../models/chat-message.model';
import { Participant } from '../models/participant.model';
import { sampleParticipantQuotes } from './quote-sample';

function chatFrom(lines: { sender: string; text: string }[]): ParsedChat {
  const ids = [...new Set(lines.map((l) => l.sender))];
  const participants: Participant[] = ids.map((id) => ({
    id,
    rawName: id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    messageCount: lines.filter((l) => l.sender === id).length,
    looksLikePhoneNumber: false,
  }));
  const messages: ChatMessage[] = lines.map((l, i) => ({
    id: `m${i}`,
    senderId: l.sender,
    timestampMs: 1_700_000_000_000 + i * 60_000,
    text: l.text,
    isSystemMessage: false,
    isMediaOmitted: false,
  }));
  return {
    format: 'android',
    messages,
    participants,
    stats: {
      messageCount: messages.length,
      participantCount: participants.length,
      dateRangeStart: messages[0]?.timestampMs ?? null,
      dateRangeEnd: messages[messages.length - 1]?.timestampMs ?? null,
      longestGapMs: null,
    },
  };
}

const LONG = 'this is a long enough message to keep';

describe('sampleParticipantQuotes — filtering', () => {
  it('drops messages too short to carry any voice', () => {
    const chat = chatFrom([
      { sender: 'a', text: 'ok' },
      { sender: 'a', text: 'yeah sure thanks' },
      { sender: 'a', text: LONG },
    ]);

    expect(sampleParticipantQuotes(chat, { anonymize: false })[0].lines).toEqual([LONG]);
  });

  it('drops system and media-placeholder messages', () => {
    const chat = chatFrom([{ sender: 'a', text: LONG }]);
    chat.messages.push(
      { id: 's', senderId: '__system__', timestampMs: 1, text: 'this group was created today', isSystemMessage: true, isMediaOmitted: false },
      { id: 'x', senderId: 'a', timestampMs: 2, text: 'image omitted from this chat export', isSystemMessage: false, isMediaOmitted: true },
    );

    expect(sampleParticipantQuotes(chat, { anonymize: false })[0].lines).toEqual([LONG]);
  });

  it('strips raw URLs the same way the transcript path does', () => {
    const chat = chatFrom([{ sender: 'a', text: 'you should really look at https://example.com/thing right now' }]);

    expect(sampleParticipantQuotes(chat, { anonymize: false })[0].lines[0]).toContain('[link]');
  });

  it('deduplicates a repeated catchphrase so it cannot fill the sample', () => {
    const chat = chatFrom([
      { sender: 'a', text: 'same exact message every single time' },
      { sender: 'a', text: 'same exact message every single time' },
      { sender: 'a', text: LONG },
    ]);

    expect(sampleParticipantQuotes(chat, { anonymize: false })[0].lines).toHaveLength(2);
  });

  it('omits participants who never said anything long enough to sample', () => {
    const chat = chatFrom([
      { sender: 'talker', text: LONG },
      { sender: 'lurker', text: 'k' },
    ]);

    const result = sampleParticipantQuotes(chat, { anonymize: false });

    expect(result.map((r) => r.participantId)).toEqual(['talker']);
  });
});

describe('sampleParticipantQuotes — spread', () => {
  const chat = chatFrom(
    Array.from({ length: 40 }, (_, i) => ({ sender: 'a', text: `message number ${i} with padding words` })),
  );

  it('spreads across the whole history rather than taking the most recent', () => {
    const lines = sampleParticipantQuotes(chat, { anonymize: false, perParticipant: 4 })[0].lines;
    const indexes = lines.map((l) => Number(/message number (\d+)/.exec(l)![1]));

    expect(indexes).toEqual([0, 10, 20, 30]);
    // The recency-biased answer would be the last four; that is the bias this path removes.
    expect(indexes).not.toEqual([36, 37, 38, 39]);
  });

  it('keeps everything when a participant has fewer messages than the target', () => {
    const small = chatFrom([
      { sender: 'a', text: 'first message with enough words' },
      { sender: 'a', text: 'second message with enough words' },
    ]);

    expect(sampleParticipantQuotes(small, { anonymize: false, perParticipant: 8 })[0].lines).toHaveLength(2);
  });

  it('handles a participant with exactly one usable message', () => {
    const single = chatFrom([{ sender: 'a', text: LONG }]);
    expect(sampleParticipantQuotes(single, { anonymize: false })[0].lines).toHaveLength(1);
  });
});

describe('sampleParticipantQuotes — budget', () => {
  it('scales lines down per participant so a large group still fits the cap', () => {
    const lines = [];
    for (let p = 0; p < 10; p++) {
      for (let i = 0; i < 30; i++) {
        lines.push({ sender: `p${p}`, text: `participant ${p} message ${i} padded out with several more words here` });
      }
    }
    const chat = chatFrom(lines);

    const result = sampleParticipantQuotes(chat, { anonymize: false, maxTotalTokens: 400 });
    const totalChars = result.reduce((acc, r) => acc + r.lines.join('\n').length, 0);

    expect(result).toHaveLength(10);
    expect(result.every((r) => r.lines.length >= 1)).toBe(true);
    expect(Math.ceil(totalChars / 4)).toBeLessThanOrEqual(500);
  });

  it('never drops a participant entirely just to meet the budget', () => {
    const lines = [];
    for (let p = 0; p < 8; p++) {
      for (let i = 0; i < 20; i++) lines.push({ sender: `p${p}`, text: `person ${p} saying something reasonably long ${i}` });
    }

    const result = sampleParticipantQuotes(chatFrom(lines), { anonymize: false, maxTotalTokens: 50 });

    expect(result).toHaveLength(8);
    expect(result.every((r) => r.lines.length === 1)).toBe(true);
  });
});

describe('sampleParticipantQuotes — anonymization', () => {
  it('labels participants the same way the transcript does', () => {
    const chat = chatFrom([
      { sender: 'alice', text: LONG },
      { sender: 'bob', text: LONG + ' too' },
    ]);

    const anon = sampleParticipantQuotes(chat, { anonymize: true });
    const real = sampleParticipantQuotes(chat, { anonymize: false });

    expect(anon.map((q) => q.displayName)).toEqual(['Participant A', 'Participant B']);
    expect(real.map((q) => q.displayName)).toEqual(['Alice', 'Bob']);
    // IDs stay real either way — they are how the report cross-references dossiers.
    expect(anon.map((q) => q.participantId)).toEqual(['alice', 'bob']);
  });
});
