import { describe, expect, it } from 'vitest';
import { parseStructuredJson, validateAnalysisResult } from './structured-output-parser';

const VALID_RESULT = {
  groupAudit: { title: 'The Group', summary: 'A summary.', verdictQuote: 'A quote.' },
  dossiers: [
    {
      participantId: 'alice',
      displayName: 'Alice',
      archetype: 'The Planner',
      verdictQuote: 'Always five steps ahead.',
      behavioralSummary: 'Keeps the group organized.',
      strengths: ['reliable'],
      redFlags: ['controlling'],
    },
  ],
  superlatives: [{ title: 'Most Organized', participantId: 'alice', blurb: 'Never misses a beat.' }],
};

describe('validateAnalysisResult', () => {
  it('accepts a well-formed result', () => {
    expect(validateAnalysisResult(VALID_RESULT)).not.toBeNull();
  });

  it('rejects a result missing a required dossier field', () => {
    const broken = { ...VALID_RESULT, dossiers: [{ ...VALID_RESULT.dossiers[0], archetype: undefined }] };
    expect(validateAnalysisResult(broken)).toBeNull();
  });

  it('rejects a result with no dossiers', () => {
    expect(validateAnalysisResult({ ...VALID_RESULT, dossiers: [] })).toBeNull();
  });

  it('defaults superlatives to an empty array when the field is missing', () => {
    const { superlatives, ...withoutSuperlatives } = VALID_RESULT;
    const result = validateAnalysisResult(withoutSuperlatives);
    expect(result?.superlatives).toEqual([]);
  });
});

describe('parseStructuredJson', () => {
  it('parses raw JSON', () => {
    expect(parseStructuredJson(JSON.stringify(VALID_RESULT))).not.toBeNull();
  });

  it('extracts JSON from a fenced code block wrapped in prose', () => {
    const text = `Sure, here you go:\n\n\`\`\`json\n${JSON.stringify(VALID_RESULT)}\n\`\`\`\n\nHope that helps!`;
    expect(parseStructuredJson(text)).not.toBeNull();
  });

  it('returns null for unparseable text', () => {
    expect(parseStructuredJson('not json at all')).toBeNull();
  });

  it('repairs a fenced object missing its outer closing brace', () => {
    // Mirrors a real small-model failure: the inner object closes but the outer one never does.
    const truncated = JSON.stringify(VALID_RESULT).slice(0, -1);
    const text = `\`\`\`json\n${truncated}\n\`\`\``;
    expect(parseStructuredJson(text)).not.toBeNull();
  });

  it('stops at the end of a complete object, ignoring trailing garbage', () => {
    // Mirrors a real small-model failure: the model finishes a valid object then keeps rambling.
    const text = `${JSON.stringify(VALID_RESULT)}, "extra": {"nested": true}}`;
    expect(parseStructuredJson(text)).not.toBeNull();
  });
});
