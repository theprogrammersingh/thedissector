import { ForensicPayload } from '../models/forensics.model';
import {
  groupReceipts,
  rankedLeverage,
  renderLeverageLine,
  renderReceiptGroup,
  renderTimeline,
  topEmotions,
} from './forensic-sections';

/**
 * Renders the on-device forensics payload into a compact block appended after the transcript
 * in a cloud provider's payload, so the model's claims cite real quotes and real numbers
 * instead of inferring everything from the raw chat.
 *
 * This is the *supporting evidence* framing. The local provider gets the same numbers framed
 * as the sole source material — see `prompts/local/evidence-pack.ts`.
 */
export function renderForensicBrief(payload: ForensicPayload, displayNames: Map<string, string>): string {
  const name = (id: string) => displayNames.get(id) ?? id;
  const sections: string[] = [];

  if (payload.leverage.length > 0) {
    sections.push(
      [
        'BEHAVIORAL METRICS (computed deterministically from the full chat, not sampled).',
        'The dominance score is normalized within this group, so it is comparative, not absolute —',
        'someone always ranks highest. Treat these as hard evidence and reference them where relevant.',
        rankedLeverage(payload)
          .map((m) => renderLeverageLine(m, name(m.participantId)))
          .join('\n'),
      ].join('\n'),
    );
  }

  if (payload.receipts.length > 0) {
    sections.push(
      [
        'FLAGGED QUOTES ("receipts") surfaced by on-device semantic search. These are candidates,',
        'not proven intent — judge each one against the transcript. Where one genuinely supports a',
        'red flag, quote it verbatim in that participant\'s redFlags so the claim is evidenced.',
        [...groupReceipts(payload.receipts).entries()]
          .map(([id, list]) => renderReceiptGroup(name(id), list))
          .join('\n'),
      ].join('\n'),
    );
  }

  if (payload.emotionProfiles.length > 0) {
    const profiles = payload.emotionProfiles.map((p) => `- ${name(p.participantId)}: ${topEmotions(p.shares)}`);
    const sampledNote = payload.emotionsWereSampled
      ? ' (measured on a representative sample of messages, not every message)'
      : '';
    sections.push(`EMOTIONAL PROFILES from on-device classification${sampledNote}.\n${profiles.join('\n')}`);
  }

  if (payload.emotionTimeline.length > 0) {
    sections.push(
      `TENSION TIMELINE (share of anger/annoyance/disgust per month).\n${renderTimeline(payload)}`,
    );
  }

  if (sections.length === 0) return '';

  return [
    '=== FORENSIC BRIEF ===',
    'The following was extracted on the user\'s own device before this request was sent. It is',
    'evidence about the same conversation above — use it to ground your analysis in specifics.',
    '',
    sections.join('\n\n'),
    '=== END FORENSIC BRIEF ===',
  ].join('\n');
}
