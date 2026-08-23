import { AnalysisResult, ParticipantDossier, Superlative } from '../models/report.model';

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Scans from the first `{` and tracks brace depth (skipping over string contents so braces inside
 * quoted text don't confuse the count) to find the real bounds of the first top-level JSON object —
 * more robust than "first `{` to last `}`" against two real patterns small models produce: trailing
 * prose/garbage appended after a complete object (this stops exactly at the object's true end,
 * ignoring anything after), and a genuinely truncated object missing its closing brace(s) (repaired
 * by appending the missing `}` characters, after stripping any trailing markdown fence remnant that
 * would otherwise land between the real content and the repair).
 */
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  if (depth > 0) {
    const tail = text.slice(start).replace(/```+\s*$/, '').trimEnd();
    return tail + '}'.repeat(depth);
  }
  return null;
}

/** Every candidate substring worth trying to JSON.parse — models sometimes wrap JSON in prose or code fences. */
export function extractJsonCandidates(text: string): string[] {
  const attempts: string[] = [];

  const balanced = extractBalancedJson(text);
  if (balanced) attempts.push(balanced);

  attempts.push(text.trim());

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) attempts.push(fenced[1].trim());

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(text.slice(firstBrace, lastBrace + 1));
  }

  return attempts;
}

/** Validates (does not coerce) a parsed JSON value against the AnalysisResult shape. */
export function validateAnalysisResult(value: unknown): AnalysisResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  const groupAudit = v['groupAudit'] as Record<string, unknown> | undefined;
  if (
    !groupAudit ||
    !isNonEmptyString(groupAudit['title']) ||
    !isNonEmptyString(groupAudit['summary']) ||
    !isNonEmptyString(groupAudit['verdictQuote'])
  ) {
    return null;
  }

  const dossiersRaw = v['dossiers'];
  if (!Array.isArray(dossiersRaw) || dossiersRaw.length === 0) return null;

  const dossiers: ParticipantDossier[] = [];
  for (const d of dossiersRaw) {
    if (typeof d !== 'object' || d === null) return null;
    const dr = d as Record<string, unknown>;
    if (
      !isNonEmptyString(dr['participantId']) ||
      !isNonEmptyString(dr['displayName']) ||
      !isNonEmptyString(dr['archetype']) ||
      !isNonEmptyString(dr['verdictQuote']) ||
      !isNonEmptyString(dr['behavioralSummary']) ||
      !isStringArray(dr['strengths']) ||
      !isStringArray(dr['redFlags'])
    ) {
      return null;
    }
    dossiers.push({
      participantId: dr['participantId'],
      displayName: dr['displayName'],
      archetype: dr['archetype'],
      verdictQuote: dr['verdictQuote'],
      behavioralSummary: dr['behavioralSummary'],
      strengths: dr['strengths'],
      redFlags: dr['redFlags'],
    } as ParticipantDossier);
  }

  const superlatives: Superlative[] = [];
  const superlativesRaw = v['superlatives'];
  if (Array.isArray(superlativesRaw)) {
    for (const s of superlativesRaw) {
      if (typeof s !== 'object' || s === null) continue;
      const sr = s as Record<string, unknown>;
      if (isNonEmptyString(sr['title']) && isNonEmptyString(sr['participantId']) && isNonEmptyString(sr['blurb'])) {
        superlatives.push({ title: sr['title'], participantId: sr['participantId'], blurb: sr['blurb'] } as Superlative);
      }
    }
  }

  return {
    groupAudit: {
      title: groupAudit['title'] as string,
      summary: groupAudit['summary'] as string,
      verdictQuote: groupAudit['verdictQuote'] as string,
    },
    dossiers,
    superlatives,
  };
}

/** Finds and parses a JSON object anywhere in `text` — models sometimes wrap JSON in prose or code fences. */
export function parseStructuredJson(text: string): AnalysisResult | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const validated = validateAnalysisResult(parsed);
      if (validated) return validated;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
