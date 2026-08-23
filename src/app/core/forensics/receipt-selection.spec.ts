import { describe, expect, it } from 'vitest';
import { ReceiptCategory } from '../models/forensics.model';
import {
  DEFAULT_RECEIPT_SELECTION,
  ReceiptCandidate,
  meanPool,
  selectReceipts,
  similarityMatrix,
} from './receipt-selection';

const CATEGORIES: ReceiptCategory[] = ['passive-aggressive', 'guilt-trip', 'dismissiveness'];

function candidate(id: string, participantId: string, text = `text ${id}`, timestampMs = 0): ReceiptCandidate {
  return { messageId: id, participantId, text, timestampMs };
}

describe('selectReceipts — the similarity floor', () => {
  it('gives a participant no receipts at all when nothing clears the floor', () => {
    const candidates = [candidate('a', 'innocent'), candidate('b', 'innocent'), candidate('c', 'innocent')];
    const scores = [
      [0.1, 0.05, 0.2],
      [0.2, 0.11, 0.3],
      [0.05, 0.06, 0.09],
    ];

    // Ranking alone would happily return a "top 3" here — the floor is what prevents that.
    expect(selectReceipts(candidates, scores, CATEGORIES)).toEqual([]);
  });

  it('keeps only the candidates above the floor', () => {
    const candidates = [candidate('a', 'p'), candidate('b', 'p')];
    const scores = [
      [0.9, 0.1, 0.1],
      [0.2, 0.2, 0.2],
    ];

    const receipts = selectReceipts(candidates, scores, CATEGORIES);

    expect(receipts).toHaveLength(1);
    expect(receipts[0].quote).toBe('text a');
    expect(receipts[0].category).toBe('passive-aggressive');
  });

  it('respects a caller-supplied floor', () => {
    const candidates = [candidate('a', 'p')];
    const scores = [[0.5, 0.1, 0.1]];

    expect(selectReceipts(candidates, scores, CATEGORIES, { floor: 0.6 })).toEqual([]);
    expect(selectReceipts(candidates, scores, CATEGORIES, { floor: 0.4 })).toHaveLength(1);
  });
});

describe('selectReceipts — caps', () => {
  it('caps how many receipts one category can contribute per participant', () => {
    const candidates = ['a', 'b', 'c', 'd'].map((id) => candidate(id, 'p'));
    const scores = candidates.map((_, i) => [0.9 - i * 0.01, 0.1, 0.1]);

    const receipts = selectReceipts(candidates, scores, CATEGORIES, { maxPerCategory: 2 });

    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => r.category === 'passive-aggressive')).toBe(true);
  });

  it('caps the total per participant while leaving other participants untouched', () => {
    const candidates = [
      ...['a', 'b', 'c', 'd'].map((id) => candidate(id, 'loud')),
      candidate('e', 'quiet'),
    ];
    const scores = [
      [0.9, 0.1, 0.1],
      [0.88, 0.1, 0.1],
      [0.1, 0.87, 0.1],
      [0.1, 0.86, 0.1],
      [0.8, 0.1, 0.1],
    ];

    const receipts = selectReceipts(candidates, scores, CATEGORIES, { maxPerParticipant: 3, maxPerCategory: 2 });

    expect(receipts.filter((r) => r.participantId === 'loud')).toHaveLength(3);
    expect(receipts.filter((r) => r.participantId === 'quiet')).toHaveLength(1);
  });
});

describe('selectReceipts — determinism and shape', () => {
  it('orders by similarity, strongest first', () => {
    const candidates = [candidate('a', 'p'), candidate('b', 'p'), candidate('c', 'p')];
    const scores = [
      [0.5, 0.1, 0.1],
      [0.9, 0.1, 0.1],
      [0.7, 0.1, 0.1],
    ];

    const receipts = selectReceipts(candidates, scores, CATEGORIES, { maxPerCategory: 3 });

    expect(receipts.map((r) => r.quote)).toEqual(['text b', 'text c', 'text a']);
  });

  it('breaks exact ties the same way every run', () => {
    const candidates = [candidate('a', 'p', 'zebra', 200), candidate('b', 'p', 'apple', 100)];
    const scores = [
      [0.8, 0.1, 0.1],
      [0.8, 0.1, 0.1],
    ];

    const first = selectReceipts(candidates, scores, CATEGORIES, { maxPerCategory: 2 });
    const second = selectReceipts(candidates, scores, CATEGORIES, { maxPerCategory: 2 });

    expect(first.map((r) => r.quote)).toEqual(second.map((r) => r.quote));
    // Earlier timestamp wins the tie.
    expect(first[0].quote).toBe('apple');
  });

  it('assigns each quote to its single best-matching category', () => {
    const candidates = [candidate('a', 'p')];
    const scores = [[0.4, 0.95, 0.5]];

    expect(selectReceipts(candidates, scores, CATEGORIES)[0].category).toBe('guilt-trip');
  });

  it('tolerates a scores matrix shorter than the candidate list', () => {
    const candidates = [candidate('a', 'p'), candidate('b', 'p')];
    expect(() => selectReceipts(candidates, [[0.9, 0.1, 0.1]], CATEGORIES)).not.toThrow();
  });

  it('ships a floor high enough to sit above the measured noise band', () => {
    // Genuine matches measure 0.55–0.66 against these centroids; 0.39–0.45 is noise that
    // produced confidently wrong labels. Dropping the default back into that band regresses
    // the feature into accusing people based on nothing.
    expect(DEFAULT_RECEIPT_SELECTION.floor).toBeGreaterThanOrEqual(0.5);
    expect(DEFAULT_RECEIPT_SELECTION.floor).toBeLessThan(0.55);
  });
});

describe('similarityMatrix', () => {
  it('computes a dot product per candidate/query pair', () => {
    const candidates = new Float32Array([1, 0, 0, 1]); // two 2-d unit vectors
    const queries = new Float32Array([1, 0]); // one 2-d unit vector

    expect(similarityMatrix(candidates, queries, 2)).toEqual([[1], [0]]);
  });

  it('returns nothing when the embedding dimension is unknown', () => {
    expect(similarityMatrix(new Float32Array([1, 2]), new Float32Array([1]), 0)).toEqual([]);
  });
});

describe('meanPool', () => {
  it('averages phrase vectors and re-normalizes to unit length', () => {
    const pooled = meanPool(new Float32Array([1, 0, 0, 1]), 2, 2);
    const norm = Math.hypot(pooled[0], pooled[1]);

    expect(norm).toBeCloseTo(1, 5);
    expect(pooled[0]).toBeCloseTo(pooled[1], 5);
  });

  it('does not divide by zero when the vectors cancel out', () => {
    const pooled = meanPool(new Float32Array([1, 0, -1, 0]), 2, 2);
    expect([...pooled].every(Number.isFinite)).toBe(true);
  });
});
