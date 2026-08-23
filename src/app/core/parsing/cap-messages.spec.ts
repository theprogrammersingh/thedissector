import { describe, expect, it } from 'vitest';
import { capRecentMessages } from './cap-messages';
import { ChatMessage, ParsedChat } from '../models/chat-message.model';
import { computeChatStats } from './whatsapp-parser';

function chat(senders: string[], opts: { systemEvery?: number } = {}): ParsedChat {
  const messages: ChatMessage[] = senders.map((id, i) => ({
    id: `m${i}`,
    senderId: id,
    text: `message ${i}`,
    timestampMs: 1_000 + i * 60_000,
    isSystemMessage: opts.systemEvery ? i % opts.systemEvery === 0 : false,
    isMediaOmitted: false,
  }));

  const ids = [...new Set(senders)];
  return {
    format: 'android',
    messages,
    participants: ids.map((id) => ({
      id,
      rawName: id,
      displayName: id,
      messageCount: senders.filter((s) => s === id).length,
      looksLikePhoneNumber: false,
    })),
    stats: computeChatStats(messages, ids.length),
  };
}

/** 30 messages round-robin across three people. */
function bigChat(): ParsedChat {
  return chat(Array.from({ length: 30 }, (_, i) => ['alice', 'bob', 'carol'][i % 3]));
}

describe('capRecentMessages', () => {
  it('returns the chat untouched when it is already under the cap', () => {
    const original = bigChat();

    expect(capRecentMessages(original, 100)).toBe(original);
  });

  it('keeps the most recent N, not the first N', () => {
    const capped = capRecentMessages(bigChat(), 6);

    expect(capped.messages).toHaveLength(6);
    expect(capped.messages.map((m) => m.id)).toEqual(['m24', 'm25', 'm26', 'm27', 'm28', 'm29']);
  });

  it('recomputes per-participant message counts for the window', () => {
    const capped = capRecentMessages(bigChat(), 6);

    // Six round-robin messages across three people is two each — not the original ten.
    expect(capped.participants.map((p) => p.messageCount)).toEqual([2, 2, 2]);
  });

  it('recomputes stats so they describe what was actually analyzed', () => {
    const capped = capRecentMessages(bigChat(), 6);

    expect(capped.stats.messageCount).toBe(6);
    expect(capped.stats.participantCount).toBe(3);
  });

  it('drops participants who said nothing inside the window', () => {
    // Carol only speaks at the very start, so a tail window excludes her entirely.
    const senders = ['carol', 'carol', ...Array.from({ length: 20 }, () => 'alice')];
    const capped = capRecentMessages(chat(senders), 5);

    expect(capped.participants.map((p) => p.id)).toEqual(['alice']);
    expect(capped.stats.participantCount).toBe(1);
  });

  it('ignores system messages when measuring the window', () => {
    // Every 4th message is a system line; those must not consume the budget.
    const withSystem = chat(
      Array.from({ length: 40 }, (_, i) => ['alice', 'bob'][i % 2]),
      { systemEvery: 4 },
    );

    const capped = capRecentMessages(withSystem, 10);

    expect(capped.messages).toHaveLength(10);
    expect(capped.messages.every((m) => !m.isSystemMessage)).toBe(true);
  });

  it('leaves the original chat object unmutated', () => {
    const original = bigChat();
    const beforeLength = original.messages.length;
    const beforeCounts = original.participants.map((p) => p.messageCount);

    capRecentMessages(original, 3);

    expect(original.messages).toHaveLength(beforeLength);
    expect(original.participants.map((p) => p.messageCount)).toEqual(beforeCounts);
  });
});
