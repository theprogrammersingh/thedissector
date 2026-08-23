/**
 * Everything the on-device "forensics" layer extracts from a chat before anything is sent
 * anywhere. Three independent passes fill this in:
 *
 *  - `leverage`  — pure string/regex math, no model, no download (core/forensics/leverage-metrics.ts)
 *  - `receipts`  — local sentence embeddings vs. forensic query centroids (MiniLM)
 *  - `emotion*`  — local multi-label emotion classification (go_emotions)
 *
 * The payload has two consumers: the report UI renders it, and `prompts/forensic-brief.ts`
 * renders it into a compact text block appended to the LLM payload so the cloud model's
 * claims are grounded in real quotes and real numbers rather than vibes.
 */

export type ReceiptCategory =
  | 'passive-aggressive'
  | 'guilt-trip'
  | 'unsolicited-advice'
  | 'fishing-for-compliments'
  | 'humble-brag'
  | 'dismissiveness';

/**
 * A subset of go_emotions' 28 labels, by exact label name. `neutral` is tracked even though
 * it isn't a "vibe": most chat messages are logistics, and dropping it made the remaining
 * crumbs of signal normalize to nonsense (a month of "the meeting is at ten" read as 89% joy).
 */
export type TrackedEmotion =
  | 'anger'
  | 'annoyance'
  | 'disgust'
  | 'nervousness'
  | 'sadness'
  | 'joy'
  | 'amusement'
  | 'gratitude'
  | 'neutral';

export type GhostingTendency = 'low' | 'medium' | 'high';

export interface LeverageMetrics {
  participantId: string;
  /**
   * 0–1: first-person pronouns as a share of all personal pronouns they use. >0.5 means they
   * talk about themselves more than about anyone else. A share rather than a first:other
   * ratio so it measures self-focus rather than sheer volume.
   */
  selfAbsorptionRatio: number;
  /** 0–1: how often they answer someone else's personal news by immediately talking about themselves. */
  hijackRate: number;
  /** 0–1: share of their messages that are unanswered follow-ups to their own previous message. */
  doubleTextRate: number;
  avgMessageWords: number;
  /** 0–1: their share of all conversation-openers in the chat. */
  initiationShare: number;
  /** 0–1: share of other people's conversation-openers they replied to within an hour. */
  responseRate: number;
  medianReplyLatencyMs: number | null;
  ghostingTendency: GhostingTendency;
  /**
   * 0–10, min-max normalized ACROSS THIS GROUP — not against absolute constants. Pronoun
   * ratios vary enormously by group and register, so fixed thresholds would push every
   * group to the same score. The tradeoff is that it's comparative: someone always ranks
   * highest, so the UI must label it "relative to this group".
   */
  narcissismScore: number;
}

export interface Receipt {
  participantId: string;
  category: ReceiptCategory;
  quote: string;
  timestampMs: number;
  /** Cosine similarity to the category centroid, kept so the UI can show how strong the match was. */
  similarity: number;
}

export interface EmotionProfile {
  participantId: string;
  /** Normalized shares across the tracked emotions, summing to 1. */
  shares: Record<TrackedEmotion, number>;
  sampledMessageCount: number;
}

export interface EmotionTimelineBucket {
  bucketStartMs: number;
  /** e.g. "Mar 2024" */
  label: string;
  shares: Record<TrackedEmotion, number>;
  /** anger + annoyance + disgust — the "how hostile was this month" number. */
  tensionScore: number;
  messageCount: number;
}

export interface ForensicPayload {
  leverage: LeverageMetrics[];
  receipts: Receipt[];
  emotionProfiles: EmotionProfile[];
  emotionTimeline: EmotionTimelineBucket[];
  peakTensionLabel: string | null;
  /** True when the emotion pass hit its message cap — the UI must not imply it read everything. */
  emotionsWereSampled: boolean;
}

export function emptyForensicPayload(): ForensicPayload {
  return {
    leverage: [],
    receipts: [],
    emotionProfiles: [],
    emotionTimeline: [],
    peakTensionLabel: null,
    emotionsWereSampled: false,
  };
}
