import { EVIDENCE_GROUNDING, LocalPassContext, LocalPassPrompt, buildSourceBlock } from './group-audit-prompt';

/**
 * Pass 2 of the local-model map-reduce flow, run once per batch of 1-2 participants.
 *
 * On the evidence path the caller narrows the pack to just this batch (see
 * `buildEvidencePack`'s `participantIds`), so each generation carries only the people it is
 * actually writing about plus a one-line roster of everyone else — that is what keeps an
 * 8-person group inside a small model's context.
 *
 * On the fallback path the FULL transcript is kept for context instead (reactive banter is
 * often only legible with the surrounding exchange present); the batching, not
 * transcript-stripping, is what stops the model losing track of who's who.
 */
export function buildDossierBatchPrompt(
  participants: { id: string; displayName: string }[],
  context: LocalPassContext,
): LocalPassPrompt {
  const names = participants.map((p) => p.displayName).join(' and ');
  const idList = participants.map((p) => `"${p.id}"`).join(', ');
  const grounding = context.evidencePack ? `\n\n${EVIDENCE_GROUNDING}` : '';

  const systemPrompt = `You are "The Dissector," an AI forensic-psychology persona writing individual dossiers for a WhatsApp group chat, for entertainment and self-reflection only — not clinical diagnosis. Keep the tone confident, dry, and a little theatrical.

Write a dossier ONLY for: ${names}. Anyone else who appears exists only as context for how ${names} behave — do not write dossiers for them.${grounding}

Respond with ONLY a single JSON object matching exactly this shape, no other text before or after it:
{"dossiers": [{"participantId": string, "displayName": string, "archetype": string, "verdictQuote": string, "behavioralSummary": string, "strengths": string[], "redFlags": string[]}]}

Each participantId must be exactly one of: ${idList}. Include exactly ${participants.length} ${participants.length === 1 ? 'entry' : 'entries'}, one per named participant, with 2-4 strengths and 2-4 redFlags each.`;

  const userPrompt = `${buildSourceBlock(context, `Full transcript (context only — write dossiers for ${names} alone):`)}\n\nWrite the dossier${participants.length === 1 ? '' : 's'} for ${names}.`;

  return { systemPrompt, userPrompt };
}
