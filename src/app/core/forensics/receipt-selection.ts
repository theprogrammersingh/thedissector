import { Receipt, ReceiptCategory } from '../models/forensics.model';
import { truncateQuote } from '../../shared/utils/truncate-quote';

export interface ReceiptCandidate {
  messageId: string;
  participantId: string;
  text: string;
  timestampMs: number;
}

export interface ReceiptSelectionOptions {
  /**
   * Absolute cosine-similarity floor. This is the load-bearing rule of the whole feature:
   * a ranked search ALWAYS returns a top-k, so without a floor the app fabricates
   * incriminating quotes for participants who did nothing. Below the floor a participant
   * correctly ends up with no receipts at all.
   */
  floor: number;
  maxPerParticipant: number;
  /** Stops one category from monopolizing a participant's exhibits. */
  maxPerCategory: number;
}

/**
 * The floor is set from measured behaviour, not intuition. Against MiniLM with the centroids
 * in `receipt-queries.ts`, genuine matches land at 0.55–0.66, while the 0.39–0.45 band is
 * noise — that range produced "I am absolutely furious about this" tagged as unsolicited
 * advice, and a sincere "thank you so much for organising all of this" tagged as a guilt trip.
 *
 * 0.5 sits in the gap. It costs some recall, which is the right trade: these quotes are shown
 * as evidence against a named person, so a missed receipt is far cheaper than a libellous one.
 */
export const DEFAULT_RECEIPT_SELECTION: ReceiptSelectionOptions = {
  floor: 0.5,
  maxPerParticipant: 6,
  maxPerCategory: 2,
};

/**
 * Picks each candidate's best-matching category, drops everything under the floor, then takes
 * the strongest remaining quotes per participant under the per-category cap.
 *
 * `scores[candidateIndex][categoryIndex]` is cosine similarity; because the embeddings are
 * normalized upstream, that's a plain dot product.
 */
export function selectReceipts(
  candidates: ReceiptCandidate[],
  scores: number[][],
  categories: ReceiptCategory[],
  options: Partial<ReceiptSelectionOptions> = {},
): Receipt[] {
  const { floor, maxPerParticipant, maxPerCategory } = { ...DEFAULT_RECEIPT_SELECTION, ...options };

  const best: Receipt[] = [];
  candidates.forEach((candidate, i) => {
    const row = scores[i];
    if (!row) return;

    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < categories.length; c++) {
      const score = row[c] ?? Number.NEGATIVE_INFINITY;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = c;
      }
    }

    if (bestIndex < 0 || bestScore < floor) return;
    best.push({
      participantId: candidate.participantId,
      category: categories[bestIndex],
      // Capped here rather than at render time so both consumers — the evidence pack and the
      // report's exhibit cards — show the same quote, and neither can be handed an unbounded one.
      quote: truncateQuote(candidate.text),
      timestampMs: candidate.timestampMs,
      similarity: bestScore,
    });
  });

  // Strongest first; timestamp then quote break ties so the same input always yields the
  // same exhibits rather than depending on sort stability.
  best.sort(
    (a, b) =>
      b.similarity - a.similarity || a.timestampMs - b.timestampMs || a.quote.localeCompare(b.quote),
  );

  const takenByParticipant = new Map<string, number>();
  const takenByCategory = new Map<string, number>();
  const selected: Receipt[] = [];

  for (const receipt of best) {
    const participantKey = receipt.participantId;
    const categoryKey = `${receipt.participantId}::${receipt.category}`;
    if ((takenByParticipant.get(participantKey) ?? 0) >= maxPerParticipant) continue;
    if ((takenByCategory.get(categoryKey) ?? 0) >= maxPerCategory) continue;

    selected.push(receipt);
    takenByParticipant.set(participantKey, (takenByParticipant.get(participantKey) ?? 0) + 1);
    takenByCategory.set(categoryKey, (takenByCategory.get(categoryKey) ?? 0) + 1);
  }

  return selected;
}

/**
 * Cosine similarity of every candidate against every query centroid. Both sides are unit
 * vectors from the embedder, so this is a dot product.
 */
export function similarityMatrix(
  candidateVectors: Float32Array,
  queryVectors: Float32Array,
  dim: number,
): number[][] {
  const candidateCount = dim === 0 ? 0 : candidateVectors.length / dim;
  const queryCount = dim === 0 ? 0 : queryVectors.length / dim;
  const matrix: number[][] = [];

  for (let i = 0; i < candidateCount; i++) {
    const row: number[] = [];
    for (let q = 0; q < queryCount; q++) {
      let sum = 0;
      for (let d = 0; d < dim; d++) sum += candidateVectors[i * dim + d] * queryVectors[q * dim + d];
      row.push(sum);
    }
    matrix.push(row);
  }
  return matrix;
}

/** Mean of several phrase vectors, re-normalized so it stays comparable to unit candidates. */
export function meanPool(vectors: Float32Array, count: number, dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dim; d++) out[d] += vectors[i * dim + d];
  }
  let norm = 0;
  for (let d = 0; d < dim; d++) norm += out[d] * out[d];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let d = 0; d < dim; d++) out[d] /= norm;
  }
  return out;
}
