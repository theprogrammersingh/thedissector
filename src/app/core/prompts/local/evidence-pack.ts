import { ForensicPayload } from '../../models/forensics.model';
import { ParticipantQuotes } from '../../forensics/quote-sample';
import { estimateTokenCount } from '../../../shared/utils/token-estimate';
import {
  groupReceipts,
  rankedLeverage,
  renderLeverageLine,
  renderLeverageLineCompact,
  renderReceiptGroup,
  renderTimeline,
  topEmotions,
} from '../forensic-sections';

/**
 * The local model's entire source material.
 *
 * Cloud providers get the raw transcript plus a supporting brief. A local model cannot: its
 * practical context is ~8K tokens, so the transcript it used to receive was hard-truncated to
 * roughly the most recent 4K — a biased tail of a month-long chat. The evidence here is
 * computed over 100% of the conversation, so swapping it in raises coverage while shrinking
 * the payload.
 *
 * Because there is no transcript alongside it, the framing has to be explicit that these are
 * *findings about* a conversation rather than the conversation itself — otherwise the model
 * invents dialogue it was never shown.
 */

export interface EvidencePackInput {
  payload: ForensicPayload;
  displayNames: Map<string, string>;
  quotes: ParticipantQuotes[];
  /** From `chat.participants[].messageCount` — there is no transcript here to count from. */
  messageCounts: Map<string, number>;
  /** Narrows the pack to one dossier batch; omit for group-level passes. */
  participantIds?: string[];
  /**
   * Hard ceiling on the rendered pack, in estimated tokens. Omit to render everything (the
   * cloud path, which has orders of magnitude more room). On-device callers MUST pass this:
   * the pack scales with the chat, and an unbounded one overflows onnxruntime's tensor size
   * math long before it reaches the model's nominal context window.
   */
  maxTokens?: number;
}

/**
 * How much evidence to render. The pack degrades along this ladder until it fits the budget:
 * the timeline goes first (whole-chat colour, least useful per token when profiling people),
 * then quotes and receipts thin out together.
 *
 * Message counts and leverage lines are deliberately absent from the ladder — they are one short
 * line per participant and they are the analytical core, so they are never shed. That means a
 * sufficiently small budget with a sufficiently large group can still overshoot; the caller is
 * expected to treat the budget as best-effort and check the real tokenized length (see
 * `local-model.worker.ts`), not to assume this function can always succeed.
 */
interface PackLimits {
  receiptsPerParticipant: number;
  quotesPerParticipant: number;
  includeTimeline: boolean;
  /** Trims each participant's metrics row to its headline numbers — see renderLeverageLineCompact. */
  compactLeverage: boolean;
}

const FULL: PackLimits = {
  receiptsPerParticipant: Number.POSITIVE_INFINITY,
  quotesPerParticipant: Number.POSITIVE_INFINITY,
  includeTimeline: true,
  compactLeverage: false,
};

const LADDER: PackLimits[] = [
  FULL,
  { receiptsPerParticipant: 6, quotesPerParticipant: 6, includeTimeline: true, compactLeverage: false },
  { receiptsPerParticipant: 4, quotesPerParticipant: 4, includeTimeline: true, compactLeverage: false },
  { receiptsPerParticipant: 3, quotesPerParticipant: 3, includeTimeline: false, compactLeverage: false },
  { receiptsPerParticipant: 3, quotesPerParticipant: 3, includeTimeline: false, compactLeverage: true },
  { receiptsPerParticipant: 2, quotesPerParticipant: 2, includeTimeline: false, compactLeverage: true },
  { receiptsPerParticipant: 1, quotesPerParticipant: 1, includeTimeline: false, compactLeverage: true },
  { receiptsPerParticipant: 0, quotesPerParticipant: 0, includeTimeline: false, compactLeverage: true },
];

/**
 * Resolves the name from the pack's own map rather than `group.displayName`. The sampler
 * carries a label too, but anonymization must be enforced in exactly one place — two sources
 * of naming truth is how a real name eventually leaks into an anonymized run.
 */
function renderQuoteGroup(group: ParticipantQuotes, name: (id: string) => string): string {
  return `- ${name(group.participantId)}:\n${group.lines.map((l) => `  - "${l}"`).join('\n')}`;
}

/** A one-line roster so a narrowed pack still knows who else is in the room. */
function renderRoster(input: EvidencePackInput, excluded: string[]): string {
  const others = [...input.messageCounts.entries()].filter(([id]) => !excluded.includes(id));
  if (others.length === 0) return '';
  const names = others.map(([id, count]) => `${input.displayNames.get(id) ?? id} (${count} messages)`);
  return `ALSO IN THE CHAT (context only — do not profile these people): ${names.join(', ')}.`;
}

export function buildEvidencePack(input: EvidencePackInput): string {
  if (input.maxTokens === undefined) return renderPack(input, FULL);

  let rendered = '';
  for (const limits of LADDER) {
    rendered = renderPack(input, limits);
    if (estimateTokenCount(rendered) <= input.maxTokens) return rendered;
  }
  // Nothing on the ladder fit. Return the smallest rendering rather than an oversized one —
  // the caller's own length check is what turns this into a legible error if it still overshoots.
  return rendered;
}

function renderPack(input: EvidencePackInput, limits: PackLimits): string {
  const { payload, displayNames, participantIds } = input;
  const name = (id: string) => displayNames.get(id) ?? id;
  const inScope = (id: string) => !participantIds || participantIds.includes(id);
  const sections: string[] = [];

  const counts = [...input.messageCounts.entries()]
    .filter(([id]) => inScope(id))
    .map(([id, count]) => `- ${name(id)}: ${count} messages`);
  if (counts.length > 0) sections.push(`MESSAGE COUNTS\n${counts.join('\n')}`);

  const leverage = rankedLeverage(payload, participantIds);
  if (leverage.length > 0) {
    sections.push(
      [
        'BEHAVIOURAL METRICS (counted from every message in the chat).',
        'Dominance is scored relative to this group, so it is comparative, not absolute.',
        leverage
          .map((m) =>
            limits.compactLeverage
              ? renderLeverageLineCompact(m, name(m.participantId))
              : renderLeverageLine(m, name(m.participantId)),
          )
          .join('\n'),
      ].join('\n'),
    );
  }

  const receipts = [...groupReceipts(payload.receipts).entries()]
    .filter(([id]) => inScope(id))
    .map(([id, list]) => [id, list.slice(0, limits.receiptsPerParticipant)] as const)
    .filter(([, list]) => list.length > 0);
  if (receipts.length > 0) {
    sections.push(
      [
        'FLAGGED QUOTES found by an on-device search for behavioural patterns. These are real',
        'messages, but the label on each is a guess — use one only where it genuinely fits.',
        receipts.map(([id, list]) => renderReceiptGroup(name(id), list)).join('\n'),
      ].join('\n'),
    );
  }

  const quotes = input.quotes
    .filter((q) => inScope(q.participantId) && q.lines.length > 0)
    .map((q) => ({ ...q, lines: q.lines.slice(0, limits.quotesPerParticipant) }))
    .filter((q) => q.lines.length > 0);
  if (quotes.length > 0) {
    sections.push(
      [
        'REPRESENTATIVE MESSAGES, sampled evenly across the whole history — this is how these',
        'people actually write. Quote only from here or from the flagged quotes above.',
        quotes.map((q) => renderQuoteGroup(q, name)).join('\n'),
      ].join('\n'),
    );
  }

  const profiles = payload.emotionProfiles.filter((p) => inScope(p.participantId));
  if (profiles.length > 0) {
    sections.push(
      `EMOTIONAL TONE measured on-device.\n${profiles
        .map((p) => `- ${name(p.participantId)}: ${topEmotions(p.shares)}`)
        .join('\n')}`,
    );
  }

  // Timeline is a property of the whole chat, so it stays out of a narrowed batch pack.
  if (limits.includeTimeline && !participantIds && payload.emotionTimeline.length > 0) {
    sections.push(`TENSION OVER TIME (share of anger/annoyance/disgust per month).\n${renderTimeline(payload)}`);
  }

  if (participantIds) {
    const roster = renderRoster(input, participantIds);
    if (roster) sections.push(roster);
  }

  if (sections.length === 0) return '';

  return [
    '=== CASE FILE ===',
    'You are reading findings about a group chat, not the chat itself. Every number below was',
    'measured on the full conversation; every quoted line is verbatim. Do not invent messages or',
    'quote anything that does not appear here.',
    '',
    sections.join('\n\n'),
    '=== END CASE FILE ===',
  ].join('\n');
}
