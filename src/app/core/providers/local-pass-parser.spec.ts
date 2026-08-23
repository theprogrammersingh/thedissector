import { describe, expect, it } from 'vitest';
import { mergeLocalPasses, validateDossierBatchPart, validateGroupAuditPart, validateSuperlativesPart } from './local-pass-parser';

describe('validateGroupAuditPart', () => {
  const valid = { groupAudit: { title: 'T', summary: 'S', verdictQuote: 'Q' } };

  it('parses a well-formed raw JSON response', () => {
    expect(validateGroupAuditPart(JSON.stringify(valid))).toEqual(valid.groupAudit);
  });

  it('parses JSON wrapped in a fenced code block', () => {
    const text = 'Sure, here you go:\n```json\n' + JSON.stringify(valid) + '\n```';
    expect(validateGroupAuditPart(text)).toEqual(valid.groupAudit);
  });

  it('parses JSON embedded in surrounding prose', () => {
    const text = 'Here is the audit: ' + JSON.stringify(valid) + ' Hope that helps!';
    expect(validateGroupAuditPart(text)).toEqual(valid.groupAudit);
  });

  it('returns null for malformed JSON', () => {
    expect(validateGroupAuditPart('{not json')).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(validateGroupAuditPart(JSON.stringify({ groupAudit: { title: 'T', summary: 'S' } }))).toBeNull();
  });
});

describe('validateDossierBatchPart', () => {
  const dossier = {
    participantId: 'alice',
    displayName: 'Alice',
    archetype: 'The Instigator',
    verdictQuote: 'Q',
    behavioralSummary: 'S',
    strengths: ['a'],
    redFlags: ['b'],
  };

  it('parses a well-formed batch and matches expected ids', () => {
    const text = JSON.stringify({ dossiers: [dossier] });
    expect(validateDossierBatchPart(text, ['alice'])).toEqual([dossier]);
  });

  it('drops entries whose participantId is not in the expected batch', () => {
    const other = { ...dossier, participantId: 'mallory' };
    const text = JSON.stringify({ dossiers: [dossier, other] });
    expect(validateDossierBatchPart(text, ['alice'])).toEqual([dossier]);
  });

  it('returns null when no entries match the expected batch', () => {
    const other = { ...dossier, participantId: 'mallory' };
    const text = JSON.stringify({ dossiers: [other] });
    expect(validateDossierBatchPart(text, ['alice'])).toBeNull();
  });

  it('returns null when an entry is missing required fields', () => {
    const text = JSON.stringify({ dossiers: [{ participantId: 'alice', displayName: 'Alice' }] });
    expect(validateDossierBatchPart(text, ['alice'])).toBeNull();
  });

  it('returns null for an empty dossiers array', () => {
    expect(validateDossierBatchPart(JSON.stringify({ dossiers: [] }), ['alice'])).toBeNull();
  });

  it('keeps only the first dossier when the model writes the same person twice', () => {
    // Observed live from gemma-3-1b on a single-participant pass: two entries for one id,
    // which rendered that person twice in the report.
    const second = { ...dossier, archetype: 'The Curator' };
    const text = JSON.stringify({ dossiers: [dossier, second] });

    expect(validateDossierBatchPart(text, ['alice'])).toEqual([dossier]);
  });

  it('still returns one entry per id for a genuine two-person batch', () => {
    const bob = { ...dossier, participantId: 'bob', displayName: 'Bob' };
    const text = JSON.stringify({ dossiers: [dossier, bob, { ...dossier, archetype: 'dupe' }] });

    expect(validateDossierBatchPart(text, ['alice', 'bob'])).toEqual([dossier, bob]);
  });
});

describe('validateSuperlativesPart', () => {
  it('parses well-formed superlatives', () => {
    const s = { title: 'Most Likely to Leave You on Read', participantId: 'alice', blurb: 'B' };
    const text = JSON.stringify({ superlatives: [s] });
    expect(validateSuperlativesPart(text, ['alice'])).toEqual([s]);
  });

  it('silently skips entries with an unknown participantId', () => {
    const known = { title: 'T1', participantId: 'alice', blurb: 'B' };
    const unknown = { title: 'T2', participantId: 'mallory', blurb: 'B' };
    const text = JSON.stringify({ superlatives: [known, unknown] });
    expect(validateSuperlativesPart(text, ['alice'])).toEqual([known]);
  });

  it('returns an empty array rather than null when superlatives is present but empty', () => {
    expect(validateSuperlativesPart(JSON.stringify({ superlatives: [] }), ['alice'])).toEqual([]);
  });

  it('returns null when the superlatives key is missing entirely', () => {
    expect(validateSuperlativesPart(JSON.stringify({}), ['alice'])).toBeNull();
  });
});

describe('mergeLocalPasses', () => {
  it('assembles the three passes into one AnalysisResult', () => {
    const groupAudit = { title: 'T', summary: 'S', verdictQuote: 'Q' };
    const dossiers = [
      {
        participantId: 'alice',
        displayName: 'Alice',
        archetype: 'A',
        verdictQuote: 'Q',
        behavioralSummary: 'S',
        strengths: [],
        redFlags: [],
      },
    ];
    const superlatives = [{ title: 'T', participantId: 'alice', blurb: 'B' }];
    expect(mergeLocalPasses(groupAudit, dossiers, superlatives)).toEqual({ groupAudit, dossiers, superlatives });
  });
});
