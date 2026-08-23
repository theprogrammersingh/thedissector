export interface LocalPassPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * What a local pass has to work from. Exactly one of these two is populated:
 *
 * - `evidencePack` — the normal path. On-device findings covering the whole chat.
 * - `leanTranscript` — the fallback, used only when no forensics payload exists. Raw chat
 *   text, hard-truncated to fit an 8K context, so it is a recent tail rather than the whole
 *   conversation.
 */
export interface LocalPassContext {
  statsBlock?: string;
  leanTranscript?: string;
  evidencePack?: string;
}

/** Shared reminder for the evidence path — a model given only findings will otherwise invent dialogue. */
export const EVIDENCE_GROUNDING =
  'You are working from a case file of findings about the chat, not the raw chat. Every quoted line in it is real; anything not in it did not happen. Never invent a quote.';

export function buildSourceBlock(context: LocalPassContext, transcriptHeading: string): string {
  if (context.evidencePack) return context.evidencePack;
  const stats = context.statsBlock ? `Message counts per participant:\n${context.statsBlock}\n\n` : '';
  return `${stats}${transcriptHeading}\n${context.leanTranscript ?? ''}`;
}

/**
 * Pass 1 of the local-model map-reduce flow: group-level themes only, no per-participant
 * dossiers or superlatives — kept small and self-contained so a 1-4B model doesn't lose track
 * of the shape while also trying to profile everyone in the same generation.
 */
export function buildGroupAuditPrompt(context: LocalPassContext): LocalPassPrompt {
  const grounding = context.evidencePack ? `\n\n${EVIDENCE_GROUNDING}` : '';

  const systemPrompt = `You are "The Dissector," an AI forensic-psychology persona analyzing a WhatsApp group chat for entertainment and self-reflection only — not clinical diagnosis. Keep the tone confident, dry, and a little theatrical — sharp and specific, never generic astrology-speak. Base every claim on the evidence you are given.${grounding}

Respond with ONLY a single JSON object matching exactly this shape, no other text before or after it:
{"groupAudit": {"title": string, "summary": string, "verdictQuote": string}}

The following shows the SHAPE ONLY. Its wording is placeholder text about a different chat — never copy or reuse any of it. Write all three fields yourself, about the chat you were given.
{"groupAudit": {"title": "<a short title you invent>", "summary": "<a few sentences you write about this specific chat>", "verdictQuote": "<one punchy line you write>"}}`;

  const userPrompt = `${buildSourceBlock(context, 'Transcript:')}\n\nWrite the Group Dynamic Audit for this chat.`;

  return { systemPrompt, userPrompt };
}
