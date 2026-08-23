import { describe, expect, it } from 'vitest';
import { ChatMessage, ParsedChat } from '../models/chat-message.model';
import { Participant } from '../models/participant.model';
import { computeLeverageMetrics, tokenize } from './leverage-metrics';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = Date.UTC(2024, 0, 1, 9, 0, 0);

interface Line {
  sender: string;
  text: string;
  /** Minutes after START. */
  at: number;
}

function buildChat(lines: Line[]): ParsedChat {
  const ids = [...new Set(lines.map((l) => l.sender))];
  const participants: Participant[] = ids.map((id) => ({
    id,
    rawName: id,
    displayName: id,
    messageCount: lines.filter((l) => l.sender === id).length,
    looksLikePhoneNumber: false,
  }));
  const messages: ChatMessage[] = lines.map((l, i) => ({
    id: `m${i}`,
    senderId: l.sender,
    timestampMs: START + l.at * MINUTE,
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

function metricFor(chat: ParsedChat, id: string) {
  const found = computeLeverageMetrics(chat).find((m) => m.participantId === id);
  if (!found) throw new Error(`no metrics for ${id}`);
  return found;
}

describe('tokenize', () => {
  it('keeps contractions intact and strips surrounding punctuation', () => {
    expect(tokenize("I'm fine, you're not — really?")).toEqual(["i'm", 'fine', "you're", 'not', 'really']);
  });

  it("does not match 'i' inside another word", () => {
    expect(tokenize('this is instrumental')).toEqual(['this', 'is', 'instrumental']);
  });
});

describe('computeLeverageMetrics — self-absorption', () => {
  it('scores a me-focused talker above an others-focused one', () => {
    const chat = buildChat([
      { sender: 'ego', text: 'I had the best day, I got promoted and I told my boss my plan', at: 0 },
      { sender: 'carer', text: 'how are you doing? your news sounds great, we should celebrate you', at: 5 },
    ]);

    expect(metricFor(chat, 'ego').selfAbsorptionRatio).toBeGreaterThan(0.5);
    expect(metricFor(chat, 'carer').selfAbsorptionRatio).toBeLessThan(0.5);
    expect(metricFor(chat, 'ego').narcissismScore).toBeGreaterThan(metricFor(chat, 'carer').narcissismScore);
  });

  it('never divides by zero when someone uses no second-person pronouns at all', () => {
    const chat = buildChat([{ sender: 'solo', text: 'I I I me my mine', at: 0 }]);
    const metric = metricFor(chat, 'solo');
    expect(Number.isFinite(metric.selfAbsorptionRatio)).toBe(true);
    expect(Number.isNaN(metric.narcissismScore)).toBe(false);
  });

  it('reports self-absorption as a bounded share, so talking more cannot inflate it', () => {
    const chatty = buildChat([{ sender: 'a', text: 'I '.repeat(200), at: 0 }]);
    const brief = buildChat([{ sender: 'a', text: 'I think so', at: 0 }]);

    // The old first:other ratio floored its denominator at 1, so these would have been 200 vs 1.
    expect(metricFor(chatty, 'a').selfAbsorptionRatio).toBe(1);
    expect(metricFor(brief, 'a').selfAbsorptionRatio).toBe(1);
  });

  it('scores 0 when a participant uses no personal pronouns at all', () => {
    const chat = buildChat([{ sender: 'a', text: 'the train leaves at four', at: 0 }]);
    expect(metricFor(chat, 'a').selfAbsorptionRatio).toBe(0);
  });
});

describe('computeLeverageMetrics — small-sample smoothing', () => {
  it('ranks the same raw rate by how much evidence stands behind it', () => {
    // Both hijack 100% of their opportunities — 'thin' from a single one, 'thick' from ten.
    // Raw rates alone can't tell them apart; smoothing is what separates a fluke from a habit.
    const lines: Line[] = [];
    lines.push({ sender: 'other', text: 'I had a hard day and my head hurts', at: 0 });
    lines.push({ sender: 'thin', text: 'I know, my week was worse honestly', at: 2 });
    for (let i = 0; i < 10; i++) {
      const at = 100 + i * 30;
      lines.push({ sender: 'other', text: 'I had a hard day and my head hurts', at });
      lines.push({ sender: 'thick', text: 'I went through my own version of that', at: at + 2 });
    }
    const chat = buildChat(lines);

    expect(metricFor(chat, 'thin').hijackRate).toBe(1);
    expect(metricFor(chat, 'thick').hijackRate).toBe(1);
    expect(metricFor(chat, 'thick').narcissismScore).toBeGreaterThan(metricFor(chat, 'thin').narcissismScore);
  });
});

describe('computeLeverageMetrics — hijacking', () => {
  it('counts a pivot-to-self reply that lands soon after someone shares personal news', () => {
    const chat = buildChat([
      { sender: 'alice', text: 'I just lost my job today', at: 0 },
      { sender: 'bob', text: 'I remember when I got fired, my situation was worse', at: 2 },
    ]);
    expect(metricFor(chat, 'bob').hijackRate).toBe(1);
  });

  it('does not count a reply that stays on the other person', () => {
    const chat = buildChat([
      { sender: 'alice', text: 'I just lost my job today', at: 0 },
      { sender: 'bob', text: 'oh no, are you okay? what happened to you', at: 2 },
    ]);
    expect(metricFor(chat, 'bob').hijackRate).toBe(0);
  });

  it('ignores a self-focused reply that arrives long after the personal message', () => {
    const chat = buildChat([
      { sender: 'alice', text: 'I just lost my job today', at: 0 },
      { sender: 'bob', text: 'I had a rough week too, my car broke', at: 90 },
    ]);
    expect(metricFor(chat, 'bob').hijackRate).toBe(0);
  });
});

describe('computeLeverageMetrics — double-texting', () => {
  it('counts a spaced-out follow-up to your own message', () => {
    const chat = buildChat([
      { sender: 'ann', text: 'hey are you around', at: 0 },
      { sender: 'ann', text: 'hello???', at: 30 },
    ]);
    expect(metricFor(chat, 'ann').doubleTextRate).toBeGreaterThan(0);
  });

  it('does not count one thought split across rapid-fire lines', () => {
    const chat = buildChat([
      { sender: 'ann', text: 'so the thing is', at: 0 },
      { sender: 'ann', text: 'it was really weird', at: 0 },
    ]);
    expect(metricFor(chat, 'ann').doubleTextRate).toBe(0);
  });
});

describe('computeLeverageMetrics — initiation and ghosting', () => {
  const chat = buildChat([
    // Day 1 — starter opens, replier answers within the hour.
    { sender: 'starter', text: 'morning everyone', at: 0 },
    { sender: 'replier', text: 'morning!', at: 10 },
    // Day 2 — starter opens again, only replier shows up.
    { sender: 'starter', text: 'anyone free today', at: DAY / MINUTE },
    { sender: 'replier', text: 'I am', at: DAY / MINUTE + 5 },
    // Day 3 — starter opens again, replier shows up; ghost surfaces hours later, long
    // after the window closed, so they're present in the chat but never actually respond.
    { sender: 'starter', text: 'checking in again', at: (2 * DAY) / MINUTE },
    { sender: 'replier', text: 'here', at: (2 * DAY) / MINUTE + 5 },
    { sender: 'ghost', text: 'oh sorry just saw this', at: (2 * DAY) / MINUTE + 5 * 60 },
  ]);

  it('attributes every conversation-opener to the person who started it', () => {
    expect(metricFor(chat, 'starter').initiationShare).toBe(1);
    expect(metricFor(chat, 'replier').initiationShare).toBe(0);
  });

  it('rates a consistent responder as low ghosting and a no-show as high', () => {
    expect(metricFor(chat, 'replier').responseRate).toBe(1);
    expect(metricFor(chat, 'replier').ghostingTendency).toBe('low');

    expect(metricFor(chat, 'ghost').responseRate).toBe(0);
    expect(metricFor(chat, 'ghost').ghostingTendency).toBe('high');
  });

  it('reports a median reply latency for someone who actually replies', () => {
    expect(metricFor(chat, 'replier').medianReplyLatencyMs).toBeGreaterThan(0);
  });
});

describe('computeLeverageMetrics — edge cases', () => {
  it('gives a lone participant a neutral score rather than NaN or a top score', () => {
    const chat = buildChat([{ sender: 'solo', text: 'talking to myself again', at: 0 }]);
    const [metric] = computeLeverageMetrics(chat);
    expect(metric.narcissismScore).toBe(5);
    expect(metric.ghostingTendency).toBe('low');
    expect(metric.medianReplyLatencyMs).toBeNull();
  });

  it('returns nothing for a chat with no participants', () => {
    expect(computeLeverageMetrics(buildChat([]))).toEqual([]);
  });

  it('ignores system and media-placeholder messages', () => {
    const chat = buildChat([{ sender: 'ann', text: 'I am here', at: 0 }]);
    chat.messages.push(
      { id: 'sys', senderId: '__system__', timestampMs: START, text: 'x created group', isSystemMessage: true, isMediaOmitted: false },
      { id: 'med', senderId: 'ann', timestampMs: START, text: '<Media omitted>', isSystemMessage: false, isMediaOmitted: true },
    );
    expect(metricFor(chat, 'ann').avgMessageWords).toBe(3);
  });

  it('scores everyone equally when their behaviour is identical', () => {
    // 20 minutes apart, so neither is inside the other's hijack window — otherwise only the
    // second speaker would ever have the opportunity, and they would not in fact be identical.
    const chat = buildChat([
      { sender: 'a', text: 'I think I am right', at: 0 },
      { sender: 'b', text: 'I think I am right', at: 20 },
    ]);
    const scores = computeLeverageMetrics(chat).map((m) => m.narcissismScore);
    expect(scores[0]).toBe(scores[1]);
    expect(scores[0]).toBe(5);
  });
});
