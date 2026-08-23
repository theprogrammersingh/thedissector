import { describe, expect, it } from 'vitest';
import { ForensicPayload, LeverageMetrics, emptyForensicPayload } from '../models/forensics.model';
import { renderForensicBrief } from './forensic-brief';

function metrics(overrides: Partial<LeverageMetrics> & { participantId: string }): LeverageMetrics {
  return {
    selfAbsorptionRatio: 1,
    hijackRate: 0,
    doubleTextRate: 0,
    avgMessageWords: 10,
    initiationShare: 0,
    responseRate: 1,
    medianReplyLatencyMs: null,
    ghostingTendency: 'low',
    narcissismScore: 5,
    ...overrides,
  };
}

const NAMES = new Map([
  ['alice', 'Alice'],
  ['bob', 'Bob'],
]);

describe('renderForensicBrief', () => {
  it('renders nothing at all for an empty payload, so no stray header reaches the prompt', () => {
    expect(renderForensicBrief(emptyForensicPayload(), NAMES)).toBe('');
  });

  it('ranks participants by dominance and uses display names, not ids', () => {
    const payload: ForensicPayload = {
      ...emptyForensicPayload(),
      leverage: [
        metrics({ participantId: 'alice', narcissismScore: 2 }),
        metrics({ participantId: 'bob', narcissismScore: 9 }),
      ],
    };

    const brief = renderForensicBrief(payload, NAMES);

    expect(brief).toContain('Alice');
    expect(brief).toContain('Bob');
    expect(brief).not.toContain('- alice:');
    expect(brief.indexOf('Bob')).toBeLessThan(brief.indexOf('Alice'));
  });

  it('tells the model the dominance score is comparative, not absolute', () => {
    const payload: ForensicPayload = {
      ...emptyForensicPayload(),
      leverage: [metrics({ participantId: 'alice' })],
    };
    expect(renderForensicBrief(payload, NAMES)).toContain('comparative');
  });

  it('honors anonymized labels exactly as the transcript does', () => {
    const payload: ForensicPayload = {
      ...emptyForensicPayload(),
      leverage: [metrics({ participantId: 'alice' })],
    };
    const anonymized = new Map([['alice', 'Participant A']]);

    const brief = renderForensicBrief(payload, anonymized);

    expect(brief).toContain('Participant A');
    expect(brief).not.toContain('Alice');
  });

  it('groups receipts under each participant and flags them as unproven', () => {
    const payload: ForensicPayload = {
      ...emptyForensicPayload(),
      receipts: [
        { participantId: 'bob', category: 'guilt-trip', quote: 'after all I did\n for you', timestampMs: 0, similarity: 0.5 },
        { participantId: 'bob', category: 'dismissiveness', quote: 'whatever', timestampMs: 0, similarity: 0.4 },
      ],
    };

    const brief = renderForensicBrief(payload, NAMES);

    expect(brief).toContain('[guilt-trip]');
    // Newlines inside a quote would break the one-receipt-per-line layout.
    expect(brief).toContain('"after all I did for you"');
    expect(brief).toContain('not proven intent');
  });

  it('says so when the emotion pass only sampled the chat', () => {
    const shares = {
      anger: 0.5, annoyance: 0.2, disgust: 0.1, nervousness: 0.05,
      sadness: 0.05, joy: 0.05, amusement: 0.03, gratitude: 0.02, neutral: 0,
    };
    const payload: ForensicPayload = {
      ...emptyForensicPayload(),
      emotionProfiles: [{ participantId: 'alice', shares, sampledMessageCount: 200 }],
      emotionsWereSampled: true,
    };

    const brief = renderForensicBrief(payload, NAMES);

    expect(brief).toContain('not every message');
    expect(brief).toContain('anger 50%');
  });

  it('names the peak-tension month when a timeline is present', () => {
    const shares = {
      anger: 0.4, annoyance: 0.3, disgust: 0.1, nervousness: 0,
      sadness: 0.1, joy: 0.1, amusement: 0, gratitude: 0, neutral: 0,
    };
    const payload: ForensicPayload = {
      ...emptyForensicPayload(),
      emotionTimeline: [
        { bucketStartMs: 0, label: 'Mar 2024', shares, tensionScore: 0.8, messageCount: 40 },
      ],
      peakTensionLabel: 'Mar 2024',
    };

    expect(renderForensicBrief(payload, NAMES)).toContain('Peak hostility: Mar 2024.');
  });
});
