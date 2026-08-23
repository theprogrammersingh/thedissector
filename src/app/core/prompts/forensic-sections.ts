import { ForensicPayload, LeverageMetrics, Receipt } from '../models/forensics.model';

/**
 * Shared formatting for the on-device forensics payload.
 *
 * Two renderers compose these: `forensic-brief.ts` builds the block appended to a cloud
 * provider's transcript, and `prompts/local/evidence-pack.ts` builds the pack a local model
 * gets *instead of* a transcript. They frame the evidence very differently — supporting
 * material vs. the sole source — but the numbers must read identically in both.
 *
 * Names come from the caller's display-name map (`buildDisplayNameMap`), so anonymization is
 * honored exactly as the transcript honors it. Same pre-existing caveat as `buildTranscript`:
 * verbatim quotes can still contain names typed *inside* a message body.
 */

export type NameLookup = (participantId: string) => string;

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function round(value: number, places = 1): string {
  return value.toFixed(places);
}

export function latency(ms: number | null): string {
  if (ms === null) return 'n/a';
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${round(minutes / 60)}h`;
}

export function renderLeverageLine(m: LeverageMetrics, name: string): string {
  return [
    `- ${name}:`,
    `dominance ${round(m.narcissismScore)}/10;`,
    `${pct(m.selfAbsorptionRatio)} of their personal pronouns are about themselves;`,
    `hijacks others' news ${pct(m.hijackRate)};`,
    `double-texts ${pct(m.doubleTextRate)};`,
    `starts ${pct(m.initiationShare)} of conversations;`,
    `answers ${pct(m.responseRate)} of others' openers (median reply ${latency(m.medianReplyLatencyMs)});`,
    `ghosting ${m.ghostingTendency};`,
    `avg ${Math.round(m.avgMessageWords)} words/msg`,
  ].join(' ');
}

/**
 * The headline metrics only, for when the pack is under budget pressure.
 *
 * The full line above runs ~330 characters, so on a large group the leverage block alone can eat
 * most of a small model's input allowance — and unlike quotes or the timeline it cannot simply be
 * dropped, since every participant needs a row to be profiled at all. Cutting the line down keeps
 * everyone represented instead of trading people away for detail about a few.
 */
export function renderLeverageLineCompact(m: LeverageMetrics, name: string): string {
  return [
    `- ${name}:`,
    `dominance ${round(m.narcissismScore)}/10;`,
    `${pct(m.selfAbsorptionRatio)} self-focused;`,
    `starts ${pct(m.initiationShare)} of conversations;`,
    `avg ${Math.round(m.avgMessageWords)} words/msg`,
  ].join(' ');
}

export function renderReceiptGroup(name: string, receipts: Receipt[]): string {
  const lines = receipts.map((r) => `  - [${r.category}] "${r.quote.replace(/\s+/g, ' ').trim()}"`);
  return `- ${name}:\n${lines.join('\n')}`;
}

export function groupReceipts(receipts: Receipt[]): Map<string, Receipt[]> {
  const byParticipant = new Map<string, Receipt[]>();
  for (const receipt of receipts) {
    const list = byParticipant.get(receipt.participantId) ?? [];
    list.push(receipt);
    byParticipant.set(receipt.participantId, list);
  }
  return byParticipant;
}

export function topEmotions(shares: Record<string, number>, take = 3): string {
  return Object.entries(shares)
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([emotion, share]) => `${emotion} ${pct(share)}`)
    .join(', ');
}

/** Ranked most-dominant-first, optionally narrowed to one dossier batch. */
export function rankedLeverage(payload: ForensicPayload, participantIds?: string[]): LeverageMetrics[] {
  const scoped = participantIds
    ? payload.leverage.filter((m) => participantIds.includes(m.participantId))
    : payload.leverage;
  return [...scoped].sort((a, b) => b.narcissismScore - a.narcissismScore);
}

export function renderTimeline(payload: ForensicPayload): string {
  const timeline = payload.emotionTimeline
    .map((b) => `- ${b.label}: tension ${pct(b.tensionScore)} (${b.messageCount} msgs)`)
    .join('\n');
  const peak = payload.peakTensionLabel ? `\nPeak hostility: ${payload.peakTensionLabel}.` : '';
  return `${timeline}${peak}`;
}
