import { ParsedChat } from '../models/chat-message.model';
import { EmotionProfile, EmotionTimelineBucket, TrackedEmotion } from '../models/forensics.model';

/**
 * Sampling and aggregation for the emotion pass. Pure functions — the model itself lives in
 * the forensics worker; everything here is testable without downloading 125 MB.
 *
 * The tracked labels match go_emotions' names exactly. The first three build the tension
 * score; `neutral` is included so the shares stay honest on the many chat messages that carry
 * no emotional signal at all.
 */
export const TRACKED_EMOTIONS: TrackedEmotion[] = [
  'anger',
  'annoyance',
  'disgust',
  'nervousness',
  'sadness',
  'joy',
  'amusement',
  'gratitude',
  'neutral',
];

const TENSION_EMOTIONS: TrackedEmotion[] = ['anger', 'annoyance', 'disgust'];

/** Below this, a message is too short for the classifier to say anything meaningful about. */
export const MIN_EMOTION_WORDS = 4;
/**
 * Every output here is a mean — per-participant profiles and per-month tension — so precision
 * improves with the square root of the sample count and flattens out quickly. 1200 messages
 * still leaves ~150 per person in an 8-person group, and the per-bucket floor below protects
 * quiet months regardless. Dropping from 2000 buys a straight ~40% off the slowest pass for a
 * difference in the aggregates that does not survive rounding to a percentage.
 */
export const MAX_EMOTION_SAMPLES = 1200;
/** Every month keeps at least this many messages (or all of them) so quiet months stay visible. */
const MIN_PER_BUCKET = 20;

export interface EmotionSample {
  messageId: string;
  participantId: string;
  text: string;
  timestampMs: number;
}

export interface EmotionSampling {
  samples: EmotionSample[];
  wasSampled: boolean;
  candidateCount: number;
}

function monthKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

function emptyShares(): Record<TrackedEmotion, number> {
  return TRACKED_EMOTIONS.reduce(
    (acc, e) => ({ ...acc, [e]: 0 }),
    {} as Record<TrackedEmotion, number>,
  );
}

/** Turns raw per-emotion means into shares summing to 1 (all-zero input stays all-zero). */
function toShares(totals: Record<TrackedEmotion, number>): Record<TrackedEmotion, number> {
  const sum = TRACKED_EMOTIONS.reduce((acc, e) => acc + totals[e], 0);
  if (sum <= 0) return emptyShares();
  return TRACKED_EMOTIONS.reduce(
    (acc, e) => ({ ...acc, [e]: totals[e] / sum }),
    {} as Record<TrackedEmotion, number>,
  );
}

function evenlySpaced<T>(items: T[], take: number): T[] {
  if (take >= items.length) return items;
  const step = items.length / take;
  const out: T[] = [];
  for (let i = 0; i < take; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

/**
 * Picks which messages to classify.
 *
 * Straight random sampling under-represents quiet months and distorts the timeline; a strict
 * even-per-bucket quota distorts the magnitudes. Allocating a floor to every month and then
 * splitting the remainder proportionally keeps both the trend and the volumes honest.
 */
export function selectEmotionSamples(chat: ParsedChat, maxSamples = MAX_EMOTION_SAMPLES): EmotionSampling {
  const known = new Set(chat.participants.map((p) => p.id));
  const candidates: EmotionSample[] = [];

  for (const message of chat.messages) {
    if (message.isSystemMessage || message.isMediaOmitted) continue;
    if (!known.has(message.senderId)) continue;
    const text = message.text.replace(/\s+/g, ' ').trim();
    if (text.split(' ').filter(Boolean).length < MIN_EMOTION_WORDS) continue;
    candidates.push({
      messageId: message.id,
      participantId: message.senderId,
      text,
      timestampMs: message.timestampMs,
    });
  }

  candidates.sort((a, b) => a.timestampMs - b.timestampMs);
  if (candidates.length <= maxSamples) {
    return { samples: candidates, wasSampled: false, candidateCount: candidates.length };
  }

  const buckets = new Map<string, EmotionSample[]>();
  for (const candidate of candidates) {
    const key = monthKey(candidate.timestampMs);
    const list = buckets.get(key) ?? [];
    list.push(candidate);
    buckets.set(key, list);
  }

  const entries = [...buckets.entries()];
  const quotas = new Map<string, number>();
  let remaining = maxSamples;

  for (const [key, list] of entries) {
    const floor = Math.min(MIN_PER_BUCKET, list.length);
    quotas.set(key, floor);
    remaining -= floor;
  }

  if (remaining > 0) {
    const leftover = entries.reduce((acc, [key, list]) => acc + (list.length - (quotas.get(key) ?? 0)), 0);
    if (leftover > 0) {
      for (const [key, list] of entries) {
        const available = list.length - (quotas.get(key) ?? 0);
        const extra = Math.floor((available / leftover) * remaining);
        quotas.set(key, (quotas.get(key) ?? 0) + Math.min(extra, available));
      }
    }
  }

  const samples = entries
    .flatMap(([key, list]) => evenlySpaced(list, quotas.get(key) ?? 0))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  return { samples, wasSampled: true, candidateCount: candidates.length };
}

/**
 * Indexes into `texts`, ordered shortest-first so similar-length messages batch together.
 *
 * A batch is padded to its longest member and attention is quadratic in sequence length, so
 * one long message among short ones makes the entire batch cost as if every message were long
 * — measured at a 6x penalty on a realistic length mix. Feeding them in length order removes
 * that waste without changing any result.
 *
 * The return value MUST be a permutation of every index exactly once: callers scatter each
 * result row back to its original position, and a duplicated or dropped index would silently
 * attribute one message's emotions to another.
 */
export function lengthBucketedOrder(texts: string[]): number[] {
  return texts
    .map((text, index) => ({ index, length: text.length }))
    .sort((a, b) => a.length - b.length || a.index - b.index)
    .map((entry) => entry.index);
}

export interface EmotionAggregate {
  profiles: EmotionProfile[];
  timeline: EmotionTimelineBucket[];
  peakTensionLabel: string | null;
}

/**
 * Folds one score row per sample into per-participant profiles and a month-by-month timeline.
 * `scores` is row-major: `scores[sampleIndex * labels.length + labelIndex]`.
 */
export function aggregateEmotions(
  samples: EmotionSample[],
  labels: string[],
  scores: Float32Array,
): EmotionAggregate {
  const labelIndex = new Map(labels.map((label, i) => [label.toLowerCase(), i]));
  const trackedIndexes = TRACKED_EMOTIONS.map((e) => labelIndex.get(e) ?? -1);

  const byParticipant = new Map<string, { totals: Record<TrackedEmotion, number>; count: number }>();
  const byMonth = new Map<
    string,
    { totals: Record<TrackedEmotion, number>; count: number; startMs: number; label: string }
  >();

  samples.forEach((sample, s) => {
    const participant = byParticipant.get(sample.participantId) ?? { totals: emptyShares(), count: 0 };
    const key = monthKey(sample.timestampMs);
    const month = byMonth.get(key) ?? {
      totals: emptyShares(),
      count: 0,
      startMs: sample.timestampMs,
      label: monthLabel(sample.timestampMs),
    };

    TRACKED_EMOTIONS.forEach((emotion, t) => {
      const column = trackedIndexes[t];
      if (column < 0) return;
      const value = scores[s * labels.length + column] ?? 0;
      participant.totals[emotion] += value;
      month.totals[emotion] += value;
    });

    participant.count += 1;
    month.count += 1;
    byParticipant.set(sample.participantId, participant);
    byMonth.set(key, month);
  });

  const profiles: EmotionProfile[] = [...byParticipant.entries()].map(([participantId, entry]) => ({
    participantId,
    shares: toShares(entry.totals),
    sampledMessageCount: entry.count,
  }));

  const timeline: EmotionTimelineBucket[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, entry]) => {
      const shares = toShares(entry.totals);
      return {
        bucketStartMs: entry.startMs,
        label: entry.label,
        shares,
        tensionScore: TENSION_EMOTIONS.reduce((acc, e) => acc + shares[e], 0),
        messageCount: entry.count,
      };
    });

  const peak = timeline.reduce<EmotionTimelineBucket | null>(
    (best, bucket) => (best === null || bucket.tensionScore > best.tensionScore ? bucket : best),
    null,
  );

  return { profiles, timeline, peakTensionLabel: peak?.label ?? null };
}
