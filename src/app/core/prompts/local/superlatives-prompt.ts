import { ParticipantDossier } from '../../models/report.model';
import { LocalPassPrompt } from './group-audit-prompt';

/**
 * Pass 3 of the local-model map-reduce flow. Takes Pass 2's completed dossiers as input (not
 * the raw transcript or the evidence pack) — genuine map-reduce composability, and it keeps
 * this pass small and cheap on both paths.
 */
export function buildSuperlativesPrompt(
  contextBlock: string,
  completedDossiers: ParticipantDossier[],
): LocalPassPrompt {
  const roster = completedDossiers
    .map((d) => `- ${d.displayName} (id: ${d.participantId}): ${d.archetype}`)
    .join('\n');
  const idList = completedDossiers.map((d) => `"${d.participantId}"`).join(', ');

  const systemPrompt = `You are "The Dissector," an AI forensic-psychology persona writing playful superlative awards for a WhatsApp group chat, for entertainment only. Keep the tone confident, dry, and a little theatrical.

Respond with ONLY a single JSON object matching exactly this shape, no other text before or after it:
{"superlatives": [{"title": string, "participantId": string, "blurb": string}]}

Each participantId must be one of: ${idList}. Pick 2-4 superlatives total, each naming a different participant, with a punchy playful title (like "Most Likely to Leave You on Read") and a one-sentence blurb.`;

  const userPrompt = `${contextBlock}\n\nParticipants and their archetypes:\n${roster}`;

  return { systemPrompt, userPrompt };
}
