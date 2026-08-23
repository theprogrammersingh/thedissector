import { describe, expect, it } from 'vitest';
import { ChatMessage, ParsedChat } from '../models/chat-message.model';
import { Participant } from '../models/participant.model';
import {
  EmotionSample,
  TRACKED_EMOTIONS,
  aggregateEmotions,
  lengthBucketedOrder,
  selectEmotionSamples,
} from './emotion-analysis';

const DAY = 86_400_000;

function chatFrom(messages: { sender: string; text: string; at: number }[]): ParsedChat {
  const ids = [...new Set(messages.map((m) => m.sender))];
  const participants: Participant[] = ids.map((id) => ({
    id,
    rawName: id,
    displayName: id,
    messageCount: messages.filter((m) => m.sender === id).length,
    looksLikePhoneNumber: false,
  }));
  const chatMessages: ChatMessage[] = messages.map((m, i) => ({
    id: `m${i}`,
    senderId: m.sender,
    timestampMs: m.at,
    text: m.text,
    isSystemMessage: false,
    isMediaOmitted: false,
  }));
  return {
    format: 'android',
    messages: chatMessages,
    participants,
    stats: {
      messageCount: chatMessages.length,
      participantCount: participants.length,
      dateRangeStart: chatMessages[0]?.timestampMs ?? null,
      dateRangeEnd: chatMessages[chatMessages.length - 1]?.timestampMs ?? null,
      longestGapMs: null,
    },
  };
}

const LONG = 'this is a long enough message to classify';

describe('selectEmotionSamples — filtering', () => {
  it('drops messages too short to classify', () => {
    const chat = chatFrom([
      { sender: 'a', text: 'ok', at: 0 },
      { sender: 'a', text: 'yeah sure', at: 1 },
      { sender: 'a', text: LONG, at: 2 },
    ]);

    const { samples } = selectEmotionSamples(chat);

    expect(samples).toHaveLength(1);
    expect(samples[0].text).toBe(LONG);
  });

  it('drops system and media-placeholder messages', () => {
    const chat = chatFrom([{ sender: 'a', text: LONG, at: 0 }]);
    chat.messages.push(
      { id: 's', senderId: '__system__', timestampMs: 1, text: 'group was created here', isSystemMessage: true, isMediaOmitted: false },
      { id: 'x', senderId: 'a', timestampMs: 2, text: 'image omitted from this export', isSystemMessage: false, isMediaOmitted: true },
    );

    expect(selectEmotionSamples(chat).samples).toHaveLength(1);
  });

  it('reports that it did not sample when everything fits under the cap', () => {
    const chat = chatFrom([{ sender: 'a', text: LONG, at: 0 }]);
    const result = selectEmotionSamples(chat);

    expect(result.wasSampled).toBe(false);
    expect(result.candidateCount).toBe(1);
  });
});

describe('selectEmotionSamples — capping', () => {
  // Three months of wildly different volume: a busy month, a normal one, a very quiet one.
  const busy = Array.from({ length: 400 }, (_, i) => ({ sender: 'a', text: `${LONG} ${i}`, at: i * 1000 }));
  const normal = Array.from({ length: 120 }, (_, i) => ({ sender: 'a', text: `${LONG} n${i}`, at: 40 * DAY + i * 1000 }));
  const quiet = Array.from({ length: 5 }, (_, i) => ({ sender: 'a', text: `${LONG} q${i}`, at: 80 * DAY + i * 1000 }));
  const chat = chatFrom([...busy, ...normal, ...quiet]);

  it('honours the cap and says it sampled', () => {
    const result = selectEmotionSamples(chat, 100);

    expect(result.wasSampled).toBe(true);
    expect(result.samples.length).toBeLessThanOrEqual(100);
    expect(result.candidateCount).toBe(525);
  });

  it('keeps every message from a month too small to sample, so quiet months stay visible', () => {
    const result = selectEmotionSamples(chat, 100);
    const quietKept = result.samples.filter((s) => s.timestampMs >= 80 * DAY);

    expect(quietKept).toHaveLength(5);
  });

  it('still gives the busiest month the most samples', () => {
    const result = selectEmotionSamples(chat, 100);
    const busyKept = result.samples.filter((s) => s.timestampMs < 40 * DAY).length;
    const normalKept = result.samples.filter((s) => s.timestampMs >= 40 * DAY && s.timestampMs < 80 * DAY).length;

    expect(busyKept).toBeGreaterThan(normalKept);
  });

  it('returns samples in chronological order', () => {
    const times = selectEmotionSamples(chat, 100).samples.map((s) => s.timestampMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('lengthBucketedOrder', () => {
  it('orders indexes shortest-first', () => {
    expect(lengthBucketedOrder(['ccc', 'a', 'bb'])).toEqual([1, 2, 0]);
  });

  it('is a permutation — every index exactly once', () => {
    // This is the load-bearing property. Callers scatter each result row back to its original
    // position, so a duplicated or dropped index silently gives one person another's emotions.
    const texts = Array.from({ length: 200 }, (_, i) => 'x'.repeat((i * 37) % 60));

    const order = lengthBucketedOrder(texts);

    expect(order).toHaveLength(texts.length);
    expect([...order].sort((a, b) => a - b)).toEqual(texts.map((_, i) => i));
  });

  it('breaks ties by original index so the order is deterministic', () => {
    const texts = ['aa', 'bb', 'cc'];
    expect(lengthBucketedOrder(texts)).toEqual([0, 1, 2]);
    expect(lengthBucketedOrder(texts)).toEqual(lengthBucketedOrder(texts));
  });

  it('round-trips scores back to their original positions', () => {
    // Mirrors exactly what the service does: classify in bucketed order, scatter back by index.
    const texts = ['ccc', 'a', 'bbbb', 'dd'];
    const order = lengthBucketedOrder(texts);
    const width = 2;
    const out = new Float32Array(texts.length * width);

    // Pretend the model returns [textLength, 0] for each row it is given.
    order.forEach((originalIndex, row) => {
      const fakeRow = new Float32Array([texts[originalIndex].length, row]);
      out.set(fakeRow, originalIndex * width);
    });

    // Column 0 must line up with the ORIGINAL text order, not the bucketed order.
    expect([...out].filter((_, i) => i % width === 0)).toEqual([3, 1, 4, 2]);
  });

  it('handles an empty list', () => {
    expect(lengthBucketedOrder([])).toEqual([]);
  });
});

describe('aggregateEmotions', () => {
  const labels = [...TRACKED_EMOTIONS, 'curiosity'];

  function scoresFor(rows: Partial<Record<string, number>>[]): Float32Array {
    const out = new Float32Array(rows.length * labels.length);
    rows.forEach((row, r) => {
      labels.forEach((label, c) => {
        out[r * labels.length + c] = row[label] ?? 0;
      });
    });
    return out;
  }

  const samples: EmotionSample[] = [
    { messageId: '1', participantId: 'angry', text: 'x', timestampMs: Date.UTC(2024, 2, 5) },
    { messageId: '2', participantId: 'happy', text: 'y', timestampMs: Date.UTC(2024, 2, 6) },
    { messageId: '3', participantId: 'angry', text: 'z', timestampMs: Date.UTC(2024, 4, 5) },
  ];

  it('builds one normalized profile per participant', () => {
    const scores = scoresFor([{ anger: 0.8, joy: 0.2 }, { joy: 1 }, { anger: 0.8, joy: 0.2 }]);

    const { profiles } = aggregateEmotions(samples, labels, scores);
    const angry = profiles.find((p) => p.participantId === 'angry')!;
    const total = TRACKED_EMOTIONS.reduce((acc, e) => acc + angry.shares[e], 0);

    expect(profiles).toHaveLength(2);
    expect(total).toBeCloseTo(1, 5);
    expect(angry.shares.anger).toBeCloseTo(0.8, 5);
    expect(angry.sampledMessageCount).toBe(2);
  });

  it('buckets the timeline by month in chronological order', () => {
    const scores = scoresFor([{ anger: 1 }, { joy: 1 }, { anger: 1 }]);

    const { timeline } = aggregateEmotions(samples, labels, scores);

    expect(timeline.map((b) => b.label)).toEqual(['Mar 2024', 'May 2024']);
    expect(timeline[0].messageCount).toBe(2);
    expect(timeline[1].messageCount).toBe(1);
  });

  it('scores tension from anger, annoyance and disgust only', () => {
    const scores = scoresFor([{ anger: 0.5, annoyance: 0.5 }, { joy: 1 }, { joy: 1 }]);

    const { timeline } = aggregateEmotions(samples, labels, scores);

    // March: one all-tension message and one all-joy message -> half tension.
    expect(timeline[0].tensionScore).toBeCloseTo(0.5, 5);
    expect(timeline[1].tensionScore).toBeCloseTo(0, 5);
  });

  it('names the most hostile month', () => {
    const scores = scoresFor([{ joy: 1 }, { joy: 1 }, { anger: 1 }]);

    expect(aggregateEmotions(samples, labels, scores).peakTensionLabel).toBe('May 2024');
  });

  it('ignores labels the model does not provide rather than throwing', () => {
    const partialLabels = ['anger', 'joy'];
    const scores = new Float32Array([1, 0, 0, 1, 1, 0]);

    const { profiles } = aggregateEmotions(samples, partialLabels, scores);

    expect(profiles).toHaveLength(2);
    expect(profiles.every((p) => Number.isFinite(p.shares.disgust))).toBe(true);
  });

  it('returns all-zero shares rather than NaN when every score is zero', () => {
    const scores = scoresFor([{}, {}, {}]);

    const { profiles, timeline } = aggregateEmotions(samples, labels, scores);

    expect(profiles.every((p) => TRACKED_EMOTIONS.every((e) => p.shares[e] === 0))).toBe(true);
    expect(timeline.every((b) => b.tensionScore === 0)).toBe(true);
  });

  it('reads each column strictly by position in the labels array', () => {
    // The classifier pipeline returns each row sorted by score, so label order is not fixed;
    // the worker sorts to a canonical order and everything downstream indexes by that array.
    // If a caller ever stitches batches together under a different order, this is what breaks.
    const shuffled = ['joy', 'anger'];
    const scores = new Float32Array([
      1, 0, // sample 1 -> joy
      1, 0, // sample 2 -> joy
      0, 1, // sample 3 -> anger
    ]);

    const { profiles } = aggregateEmotions(samples, shuffled, scores);
    const angry = profiles.find((p) => p.participantId === 'angry')!;

    expect(angry.shares.joy).toBeCloseTo(0.5, 5);
    expect(angry.shares.anger).toBeCloseTo(0.5, 5);
  });

  it('handles an empty sample list', () => {
    const result = aggregateEmotions([], labels, new Float32Array());

    expect(result.profiles).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.peakTensionLabel).toBeNull();
  });
});
