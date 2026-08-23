import { AnalysisResult, GroupAudit, ParticipantDossier, Superlative } from '../models/report.model';
import { extractJsonCandidates, isNonEmptyString, isStringArray } from './structured-output-parser';

function tryEach<T>(text: string, extract: (parsed: unknown) => T | null): T | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = extract(parsed);
      if (result) return result;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Validates a Pass-1 (group audit only) response. */
export function validateGroupAuditPart(text: string): GroupAudit | null {
  return tryEach(text, (parsed) => {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const groupAudit = (parsed as Record<string, unknown>)['groupAudit'] as Record<string, unknown> | undefined;
    if (
      !groupAudit ||
      !isNonEmptyString(groupAudit['title']) ||
      !isNonEmptyString(groupAudit['summary']) ||
      !isNonEmptyString(groupAudit['verdictQuote'])
    ) {
      return null;
    }
    return {
      title: groupAudit['title'],
      summary: groupAudit['summary'],
      verdictQuote: groupAudit['verdictQuote'],
    };
  });
}

function isValidDossier(value: unknown): value is ParticipantDossier {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    isNonEmptyString(d['participantId']) &&
    isNonEmptyString(d['displayName']) &&
    isNonEmptyString(d['archetype']) &&
    isNonEmptyString(d['verdictQuote']) &&
    isNonEmptyString(d['behavioralSummary']) &&
    isStringArray(d['strengths']) &&
    isStringArray(d['redFlags'])
  );
}

/** Validates a Pass-2 (one dossier batch) response, cross-checking ids against the expected batch. */
export function validateDossierBatchPart(text: string, expectedParticipantIds: string[]): ParticipantDossier[] | null {
  return tryEach(text, (parsed) => {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const dossiersRaw = (parsed as Record<string, unknown>)['dossiers'];
    if (!Array.isArray(dossiersRaw) || dossiersRaw.length === 0) return null;
    if (!dossiersRaw.every(isValidDossier)) return null;

    // At most one dossier per requested id. Small models sometimes emit two entries for the
    // same person — especially on single-participant passes, where there is nobody else to
    // write about — and without this the report renders that person twice.
    const dossiers = dossiersRaw as ParticipantDossier[];
    const matched: ParticipantDossier[] = [];
    const taken = new Set<string>();
    for (const dossier of dossiers) {
      if (!expectedParticipantIds.includes(dossier.participantId)) continue;
      if (taken.has(dossier.participantId)) continue;
      taken.add(dossier.participantId);
      matched.push(dossier);
    }
    return matched.length > 0 ? matched : null;
  });
}

/** Validates a Pass-3 (superlatives) response, cross-checking ids against known participants. */
export function validateSuperlativesPart(text: string, knownParticipantIds: string[]): Superlative[] | null {
  return tryEach(text, (parsed) => {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = (parsed as Record<string, unknown>)['superlatives'];
    if (!Array.isArray(raw)) return null;

    const superlatives: Superlative[] = [];
    for (const s of raw) {
      if (typeof s !== 'object' || s === null) continue;
      const sr = s as Record<string, unknown>;
      if (
        isNonEmptyString(sr['title']) &&
        isNonEmptyString(sr['participantId']) &&
        isNonEmptyString(sr['blurb']) &&
        knownParticipantIds.includes(sr['participantId'])
      ) {
        superlatives.push({ title: sr['title'], participantId: sr['participantId'], blurb: sr['blurb'] });
      }
    }
    return superlatives;
  });
}

export function mergeLocalPasses(
  groupAudit: GroupAudit,
  dossiers: ParticipantDossier[],
  superlatives: Superlative[],
): AnalysisResult {
  return { groupAudit, dossiers, superlatives };
}
