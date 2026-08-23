import { describe, expect, it } from 'vitest';
import { ForensicPayload, emptyForensicPayload } from '../../models/forensics.model';
import { ParticipantQuotes } from '../../forensics/quote-sample';
import { EvidencePackInput, buildEvidencePack } from './evidence-pack';

const NAMES = new Map([
  ['alice', 'Alice'],
  ['bob', 'Bob'],
  ['carol', 'Carol'],
]);

const COUNTS = new Map([
  ['alice', 120],
  ['bob', 80],
  ['carol', 12],
]);

function metrics(participantId: string, narcissismScore = 5) {
  return {
    participantId,
    selfAbsorptionRatio: 0.6,
    hijackRate: 0.1,
    doubleTextRate: 0.2,
    avgMessageWords: 12,
    initiationShare: 0.3,
    responseRate: 0.8,
    medianReplyLatencyMs: 300_000,
    ghostingTendency: 'low' as const,
    narcissismScore,
  };
}

const QUOTES: ParticipantQuotes[] = [
  { participantId: 'alice', displayName: 'Alice', lines: ['alice line one', 'alice line two'] },
  { participantId: 'bob', displayName: 'Bob', lines: ['bob line one'] },
  { participantId: 'carol', displayName: 'Carol', lines: ['carol line one'] },
];

function payloadWithEverything(): ForensicPayload {
  return {
    ...emptyForensicPayload(),
    leverage: [metrics('alice', 8), metrics('bob', 3), metrics('carol', 1)],
    receipts: [
      { participantId: 'alice', category: 'guilt-trip', quote: 'after all I did', timestampMs: 0, similarity: 0.6 },
      { participantId: 'bob', category: 'dismissiveness', quote: 'whatever', timestampMs: 0, similarity: 0.6 },
    ],
    emotionProfiles: [
      { participantId: 'alice', shares: { anger: 0.5, annoyance: 0.2, disgust: 0, nervousness: 0, sadness: 0, joy: 0.3, amusement: 0, gratitude: 0, neutral: 0 }, sampledMessageCount: 50 },
      { participantId: 'bob', shares: { anger: 0, annoyance: 0, disgust: 0, nervousness: 0, sadness: 0, joy: 0.8, amusement: 0.2, gratitude: 0, neutral: 0 }, sampledMessageCount: 40 },
    ],
    emotionTimeline: [
      { bucketStartMs: 0, label: 'Mar 2024', shares: { anger: 0.5, annoyance: 0, disgust: 0, nervousness: 0, sadness: 0, joy: 0.5, amusement: 0, gratitude: 0, neutral: 0 }, tensionScore: 0.5, messageCount: 40 },
    ],
    peakTensionLabel: 'Mar 2024',
  };
}

function input(overrides: Partial<EvidencePackInput> = {}): EvidencePackInput {
  return {
    payload: payloadWithEverything(),
    displayNames: NAMES,
    quotes: QUOTES,
    messageCounts: COUNTS,
    ...overrides,
  };
}

describe('buildEvidencePack — framing', () => {
  it('tells the model it is reading findings, not the conversation', () => {
    const pack = buildEvidencePack(input());

    expect(pack).toContain('findings about a group chat, not the chat itself');
    expect(pack).toContain('Do not invent messages');
  });

  it('renders nothing at all for an empty payload with no quotes or counts', () => {
    const pack = buildEvidencePack({
      payload: emptyForensicPayload(),
      displayNames: new Map(),
      quotes: [],
      messageCounts: new Map(),
    });

    expect(pack).toBe('');
  });

  it('still produces a usable pack when only the free deterministic pass ran', () => {
    const pack = buildEvidencePack(
      input({ payload: { ...emptyForensicPayload(), leverage: [metrics('alice')] } }),
    );

    expect(pack).toContain('BEHAVIOURAL METRICS');
    expect(pack).toContain('REPRESENTATIVE MESSAGES');
    expect(pack).not.toContain('FLAGGED QUOTES');
  });
});

/**
 * The budget is what keeps this path runnable at all: the pack scales with the chat, and an
 * unbounded one overflows onnxruntime's tensor size math (see LOCAL_MAX_INPUT_TOKENS).
 */
describe('buildEvidencePack — token budget', () => {
  /** A chat big enough that the full pack is far over any small-model budget. */
  function bigInput(): EvidencePackInput {
    const payload = payloadWithEverything();
    payload.receipts = Array.from({ length: 60 }, (_, i) => ({
      participantId: i % 2 === 0 ? 'alice' : 'bob',
      category: 'guilt-trip' as const,
      quote: `receipt number ${i} with a decent amount of text in it to take up real space`,
      timestampMs: i,
      similarity: 0.6,
    }));
    payload.emotionTimeline = Array.from({ length: 36 }, (_, i) => ({
      bucketStartMs: i,
      label: `Month ${i}`,
      shares: { anger: 0.4, annoyance: 0, disgust: 0, nervousness: 0, sadness: 0, joy: 0.6, amusement: 0, gratitude: 0, neutral: 0 },
      tensionScore: 0.4,
      messageCount: 100,
    }));
    const quotes: ParticipantQuotes[] = ['alice', 'bob', 'carol'].map((id) => ({
      participantId: id,
      displayName: NAMES.get(id)!,
      lines: Array.from({ length: 20 }, (_, i) => `${id} says something reasonably long, line ${i}`),
    }));
    return input({ payload, quotes });
  }

  it('renders everything when no budget is given (the cloud path)', () => {
    const pack = buildEvidencePack(bigInput());

    expect(pack).toContain('TENSION OVER TIME');
    expect(pack.length).toBeGreaterThan(4000);
  });

  it('shrinks an oversized pack to fit the budget', () => {
    const budget = 400;
    const pack = buildEvidencePack({ ...bigInput(), maxTokens: budget });

    // Same ~4-chars-per-token heuristic the implementation budgets against.
    expect(Math.ceil(pack.length / 4)).toBeLessThanOrEqual(budget);
  });

  it('keeps the analytical core even at a punishing budget', () => {
    const pack = buildEvidencePack({ ...bigInput(), maxTokens: 200 });

    expect(pack).toContain('MESSAGE COUNTS');
    expect(pack).toContain('BEHAVIOURAL METRICS');
  });

  it('sheds the timeline before it sheds the quotes', () => {
    // A budget that forces some shedding but not the most severe rung.
    const pack = buildEvidencePack({ ...bigInput(), maxTokens: 500 });

    expect(pack).not.toContain('TENSION OVER TIME');
    expect(pack).toContain('REPRESENTATIVE MESSAGES');
  });

  it('leaves a pack that already fits completely untouched', () => {
    const generous = buildEvidencePack({ ...input(), maxTokens: 10_000 });

    expect(generous).toBe(buildEvidencePack(input()));
  });
});

describe('buildEvidencePack — full group pack', () => {
  const pack = buildEvidencePack(input());

  it('includes every section', () => {
    expect(pack).toContain('MESSAGE COUNTS');
    expect(pack).toContain('BEHAVIOURAL METRICS');
    expect(pack).toContain('FLAGGED QUOTES');
    expect(pack).toContain('REPRESENTATIVE MESSAGES');
    expect(pack).toContain('EMOTIONAL TONE');
    expect(pack).toContain('TENSION OVER TIME');
  });

  it('ranks participants by dominance', () => {
    expect(pack.indexOf('- Alice: dominance 8.0')).toBeLessThan(pack.indexOf('- Bob: dominance 3.0'));
  });

  it('carries real message counts, which no transcript is present to supply', () => {
    expect(pack).toContain('- Alice: 120 messages');
    expect(pack).toContain('- Carol: 12 messages');
  });

  it('does not add an "also in the chat" roster when nothing is narrowed', () => {
    expect(pack).not.toContain('ALSO IN THE CHAT');
  });
});

describe('buildEvidencePack — narrowed to a dossier batch', () => {
  const pack = buildEvidencePack(input({ participantIds: ['bob'] }));

  it('includes only the named participant\'s evidence', () => {
    expect(pack).toContain('- Bob: dominance 3.0');
    expect(pack).not.toContain('- Alice: dominance');
    expect(pack).not.toContain('after all I did');
    expect(pack).not.toContain('alice line one');
  });

  it('still names everyone else as context so the model knows the room', () => {
    expect(pack).toContain('ALSO IN THE CHAT');
    expect(pack).toContain('Alice (120 messages)');
    expect(pack).toContain('Carol (12 messages)');
    expect(pack).not.toContain('Bob (80 messages)');
  });

  it('drops the whole-chat tension timeline from a per-person pack', () => {
    expect(pack).not.toContain('TENSION OVER TIME');
  });

  it('keeps the batch member\'s own quotes and receipts', () => {
    expect(pack).toContain('bob line one');
    expect(pack).toContain('whatever');
  });
});

describe('buildEvidencePack — anonymization', () => {
  it('uses anonymized labels throughout when the map supplies them', () => {
    const anon = new Map([
      ['alice', 'Participant A'],
      ['bob', 'Participant B'],
      ['carol', 'Participant C'],
    ]);

    const pack = buildEvidencePack(input({ displayNames: anon }));

    expect(pack).toContain('Participant A');
    expect(pack).not.toContain('Alice:');
    expect(pack).not.toContain('Bob:');
  });
});
