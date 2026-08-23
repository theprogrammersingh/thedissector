import { ChatMessage, ParsedChat } from '../models/chat-message.model';
import { GhostingTendency, LeverageMetrics } from '../models/forensics.model';

/**
 * Deterministic conversational-dominance metrics. Pure functions, no model, no download,
 * no network — this runs instantly for every user regardless of provider, and it is the
 * only forensics pass that always has data.
 *
 * Every threshold here is a judgement call about chat behaviour rather than a fact, so
 * they're named constants: tune them in one place, and the specs pin the behaviour.
 */

const FIRST_PERSON = new Set(["i", "me", "my", "mine", "myself", "i'm", "i've", "i'd", "i'll"]);
const OTHER_PERSON = new Set([
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
  "you're",
  "you've",
  'we',
  'us',
  'our',
  'ours',
  "we're",
  'everyone',
  'everybody',
]);

/** A message opening a fresh conversation rather than continuing one. */
const CONVERSATION_GAP_MS = 6 * 60 * 60 * 1000;
/** How soon after someone else's personal message a reply still counts as reacting to it. */
const HIJACK_WINDOW_MS = 10 * 60 * 1000;
/** Words of a reply we look at when deciding whether it immediately pivots to the speaker. */
const HIJACK_OPENING_WORDS = 8;
/** Below this gap, consecutive messages are one thought split across lines, not a double-text. */
const DOUBLE_TEXT_MIN_GAP_MS = 2 * 60 * 1000;
/** How long someone has to answer another person's conversation-opener before it counts as unanswered. */
const RESPONSE_WINDOW_MS = 60 * 60 * 1000;
/** Replies slower than this are treated as a new conversation, not a late reply. */
const MAX_REPLY_LATENCY_MS = 24 * 60 * 60 * 1000;

const GHOSTING_LOW_THRESHOLD = 0.6;
const GHOSTING_MEDIUM_THRESHOLD = 0.3;

// Weights for the composite narcissism score. Self-absorption dominates because it's the
// most direct signal; raw volume counts least because a chatty person isn't automatically
// self-absorbed.
const WEIGHT_SELF_ABSORPTION = 0.45;
const WEIGHT_HIJACK = 0.35;
const WEIGHT_VOLUME = 0.2;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? [])
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word.length > 0);
}

function countPronouns(words: string[]): { first: number; other: number } {
  let first = 0;
  let other = 0;
  for (const word of words) {
    if (FIRST_PERSON.has(word)) first++;
    else if (OTHER_PERSON.has(word)) other++;
  }
  return { first, other };
}

/** True when a message is the sender talking about themselves — the thing a hijacker talks over. */
function isSelfReferential(text: string): boolean {
  return countPronouns(tokenize(text)).first > 0;
}

/** True when a reply pivots to the responder within its opening words. */
function opensAboutSelf(text: string): boolean {
  return tokenize(text)
    .slice(0, HIJACK_OPENING_WORDS)
    .some((word) => FIRST_PERSON.has(word));
}

/** Plain share of `a` against `a + b`; 0 when there's nothing to divide. */
function share(a: number, b: number): number {
  const total = a + b;
  return total === 0 ? 0 : a / total;
}

/**
 * Laplace-smoothed share. Adding one imaginary observation to each side pulls sparse evidence
 * toward 0.5 ("unremarkable") while leaving well-evidenced participants essentially untouched:
 * 1-of-1 becomes 0.67 rather than a perfect 1.0, but 40-of-50 stays ~0.79.
 */
function smoothedShare(a: number, b: number): number {
  return (a + 1) / (a + Math.max(0, b) + 2);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Maps each value onto 0–1 against the group's own range. When everyone scores the same
 * (or there's only one participant) the range collapses, and 0.5 — "unremarkable" — is the
 * only honest answer.
 */
function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return values.map(() => 0.5);
  }
  return values.map((v) => (v - min) / (max - min));
}

function ghostingFrom(responseRate: number, opportunities: number): GhostingTendency {
  // No opportunities means no evidence of ghosting — not evidence of ghosting.
  if (opportunities === 0) return 'low';
  if (responseRate >= GHOSTING_LOW_THRESHOLD) return 'low';
  if (responseRate >= GHOSTING_MEDIUM_THRESHOLD) return 'medium';
  return 'high';
}

interface Accumulator {
  firstPerson: number;
  otherPerson: number;
  words: number;
  messages: number;
  hijacks: number;
  hijackOpportunities: number;
  doubleTexts: number;
  openers: number;
  openerResponses: number;
  openerOpportunities: number;
  replyLatencies: number[];
}

function newAccumulator(): Accumulator {
  return {
    firstPerson: 0,
    otherPerson: 0,
    words: 0,
    messages: 0,
    hijacks: 0,
    hijackOpportunities: 0,
    doubleTexts: 0,
    openers: 0,
    openerResponses: 0,
    openerOpportunities: 0,
    replyLatencies: [],
  };
}

/** Real content only, chronological — mirrors what `transcript-builder.ts` sends to the LLM. */
function realMessages(chat: ParsedChat): ChatMessage[] {
  return chat.messages
    .filter((m) => !m.isSystemMessage && !m.isMediaOmitted)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function computeLeverageMetrics(chat: ParsedChat): LeverageMetrics[] {
  const participantIds = chat.participants.map((p) => p.id);
  if (participantIds.length === 0) return [];

  const acc = new Map<string, Accumulator>(participantIds.map((id) => [id, newAccumulator()]));
  const messages = realMessages(chat);
  const openerIndices: number[] = [];
  let totalOpeners = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const stats = acc.get(message.senderId);
    if (!stats) continue; // sender was removed from the participant list

    const words = tokenize(message.text);
    const { first, other } = countPronouns(words);
    stats.firstPerson += first;
    stats.otherPerson += other;
    stats.words += words.length;
    stats.messages += 1;

    const previous = i > 0 ? messages[i - 1] : null;
    const gap = previous ? message.timestampMs - previous.timestampMs : Number.POSITIVE_INFINITY;

    if (gap >= CONVERSATION_GAP_MS) {
      stats.openers += 1;
      totalOpeners += 1;
      openerIndices.push(i);
    }

    if (previous && previous.senderId === message.senderId && gap >= DOUBLE_TEXT_MIN_GAP_MS) {
      stats.doubleTexts += 1;
    }

    if (previous && previous.senderId !== message.senderId) {
      if (gap <= HIJACK_WINDOW_MS && isSelfReferential(previous.text)) {
        stats.hijackOpportunities += 1;
        if (opensAboutSelf(message.text)) stats.hijacks += 1;
      }
      if (gap <= MAX_REPLY_LATENCY_MS) {
        stats.replyLatencies.push(gap);
      }
    }
  }

  // Response rate: of the conversation-openers *other people* started, how many did each
  // participant show up for? Scanning forward stops as soon as we leave the window.
  for (const index of openerIndices) {
    const opener = messages[index];
    const deadline = opener.timestampMs + RESPONSE_WINDOW_MS;
    const responded = new Set<string>();
    for (let j = index + 1; j < messages.length && messages[j].timestampMs <= deadline; j++) {
      responded.add(messages[j].senderId);
    }
    for (const id of participantIds) {
      if (id === opener.senderId) continue;
      const stats = acc.get(id);
      if (!stats) continue;
      stats.openerOpportunities += 1;
      if (responded.has(id)) stats.openerResponses += 1;
    }
  }

  const base = participantIds.map((id) => {
    const stats = acc.get(id) ?? newAccumulator();
    const fairShare = messages.length / participantIds.length;
    return {
      participantId: id,
      // A SHARE of personal pronouns, not first/other. The ratio form floors its denominator
      // at 1, so anyone who never says "you" scores their raw first-person COUNT — which
      // makes the metric scale with how much they talk instead of how self-focused they are.
      selfAbsorptionRatio: share(stats.firstPerson, stats.otherPerson),
      // Smoothed variants exist only for ranking: they pull thin evidence toward "unremarkable"
      // so one lucky opportunity can't hand someone a 10/10. The displayed rates stay raw.
      smoothedSelfAbsorption: smoothedShare(stats.firstPerson, stats.otherPerson),
      smoothedHijackRate: smoothedShare(stats.hijacks, stats.hijackOpportunities - stats.hijacks),
      hijackRate: stats.hijackOpportunities === 0 ? 0 : stats.hijacks / stats.hijackOpportunities,
      doubleTextRate: stats.messages === 0 ? 0 : stats.doubleTexts / stats.messages,
      avgMessageWords: stats.messages === 0 ? 0 : stats.words / stats.messages,
      initiationShare: totalOpeners === 0 ? 0 : stats.openers / totalOpeners,
      responseRate: stats.openerOpportunities === 0 ? 0 : stats.openerResponses / stats.openerOpportunities,
      openerOpportunities: stats.openerOpportunities,
      medianReplyLatencyMs: median(stats.replyLatencies),
      volumeOverFairShare: fairShare === 0 ? 0 : stats.messages / fairShare,
    };
  });

  const selfAbsorption = minMaxNormalize(base.map((b) => b.smoothedSelfAbsorption));
  const hijack = minMaxNormalize(base.map((b) => b.smoothedHijackRate));
  const volume = minMaxNormalize(base.map((b) => b.volumeOverFairShare));

  return base.map((b, i) => ({
    participantId: b.participantId,
    selfAbsorptionRatio: b.selfAbsorptionRatio,
    hijackRate: b.hijackRate,
    doubleTextRate: b.doubleTextRate,
    avgMessageWords: b.avgMessageWords,
    initiationShare: b.initiationShare,
    responseRate: b.responseRate,
    medianReplyLatencyMs: b.medianReplyLatencyMs,
    ghostingTendency: ghostingFrom(b.responseRate, b.openerOpportunities),
    narcissismScore:
      (selfAbsorption[i] * WEIGHT_SELF_ABSORPTION +
        hijack[i] * WEIGHT_HIJACK +
        volume[i] * WEIGHT_VOLUME) *
      10,
  }));
}
