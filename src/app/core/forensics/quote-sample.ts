import { ParsedChat } from '../models/chat-message.model';
import { cleanLine } from '../parsing/local-transcript';
import { buildDisplayNameMap } from '../parsing/transcript-builder';
import { estimateTokenCount } from '../../shared/utils/token-estimate';
import { truncateQuote } from '../../shared/utils/truncate-quote';

/**
 * A handful of each participant's own messages, kept verbatim, for the local evidence pack.
 *
 * The rest of the pack is numbers and flagged quotes; without some ordinary message text the
 * model has no sense of how anyone actually writes, and a chat pleasant enough to produce zero
 * receipts would leave it with nothing but percentages to work from.
 */

export interface ParticipantQuotes {
  participantId: string;
  displayName: string;
  lines: string[];
}

export interface QuoteSampleOptions {
  anonymize: boolean;
  /** Per-participant target before the total-token cap trims it back. */
  perParticipant?: number;
  maxTotalTokens?: number;
}

/** Shorter messages ("ok", "haha") carry no voice worth spending pack budget on. */
const MIN_WORDS = 5;
const DEFAULT_PER_PARTICIPANT = 8;
const DEFAULT_MAX_TOTAL_TOKENS = 1500;

/**
 * Even spread across the participant's own history — deliberately NOT the most recent N.
 * Recency bias in the truncated transcript is the thing this whole evidence path exists to
 * remove; re-introducing it here would defeat the point.
 */
function evenlySpaced<T>(items: T[], take: number): T[] {
  if (take >= items.length) return items;
  const step = items.length / take;
  const out: T[] = [];
  for (let i = 0; i < take; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

export function sampleParticipantQuotes(
  chat: ParsedChat,
  options: QuoteSampleOptions,
): ParticipantQuotes[] {
  const perParticipant = options.perParticipant ?? DEFAULT_PER_PARTICIPANT;
  const maxTotalTokens = options.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
  const displayNames = buildDisplayNameMap(chat.participants, options.anonymize);

  const byParticipant = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();

  for (const message of chat.messages) {
    if (message.isSystemMessage || message.isMediaOmitted) continue;
    if (!displayNames.has(message.senderId)) continue;

    const text = cleanLine(message.text).replace(/\s+/g, ' ').trim();
    if (text.split(' ').filter(Boolean).length < MIN_WORDS) continue;

    const dedupe = seen.get(message.senderId) ?? new Set<string>();
    const key = text.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    seen.set(message.senderId, dedupe);

    const list = byParticipant.get(message.senderId) ?? [];
    // Dedupe on the full text above, store the capped version: `take` bounds how MANY lines each
    // participant contributes, but without this one long message still blows the pack budget.
    list.push(truncateQuote(text));
    byParticipant.set(message.senderId, list);
  }

  // Large groups get proportionally fewer lines each so the pack stays inside a small model's
  // context no matter how many people are in the chat.
  const speakers = chat.participants.filter((p) => (byParticipant.get(p.id) ?? []).length > 0);
  if (speakers.length === 0) return [];

  let take = perParticipant;
  let result = buildResult(chat, speakers, byParticipant, displayNames, take);
  while (take > 1 && estimateTokenCount(flatten(result)) > maxTotalTokens) {
    take -= 1;
    result = buildResult(chat, speakers, byParticipant, displayNames, take);
  }
  return result;
}

function buildResult(
  chat: ParsedChat,
  speakers: ParsedChat['participants'],
  byParticipant: Map<string, string[]>,
  displayNames: Map<string, string>,
  take: number,
): ParticipantQuotes[] {
  return speakers.map((p) => ({
    participantId: p.id,
    displayName: displayNames.get(p.id) ?? p.id,
    lines: evenlySpaced(byParticipant.get(p.id) ?? [], take),
  }));
}

function flatten(quotes: ParticipantQuotes[]): string {
  return quotes.map((q) => `${q.displayName}\n${q.lines.join('\n')}`).join('\n');
}
