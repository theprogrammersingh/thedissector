import { Injectable, signal } from '@angular/core';
import { ParsedChat } from '../models/chat-message.model';
import { LocalModelError } from '../models/local-model.model';
import { Receipt } from '../models/forensics.model';
import {
  EmotionAggregate,
  aggregateEmotions,
  lengthBucketedOrder,
  selectEmotionSamples,
} from './emotion-analysis';
import { ForensicsWorkerRequest, ForensicsWorkerResponse } from './forensics.worker-messages';
import { RECEIPT_QUERIES } from './receipt-queries';
import {
  ReceiptCandidate,
  meanPool,
  selectReceipts,
  similarityMatrix,
} from './receipt-selection';

export type ForensicsPassStatus = 'idle' | 'downloading' | 'running' | 'ready' | 'error' | 'cancelled';

export interface ForensicsProgress {
  /** 0–1 where known; null while the total is still unknown. */
  fraction: number | null;
  label: string;
}

/** Shorter messages carry too little signal for a sentence embedding to rank meaningfully. */
/** Backstop against a lost worker message, not a latency budget — see LocalModelService's copy. */
const WORKER_TIMEOUT_MS = 15 * 60_000;

const MIN_CANDIDATE_WORDS = 5;
/** MiniLM is fast, but embedding is still O(n) — this bounds the worst case on a huge export. */
const MAX_CANDIDATES = 3000;
const EMBED_BATCH_SIZE = 64;
/**
 * roberta-base is far heavier than MiniLM per item, so batches stay modest to keep the UI
 * responsive. Batch size itself barely moves throughput (32 measured within 3% of 16) — the
 * length bucketing below is what actually matters.
 */
const CLASSIFY_BATCH_SIZE = 32;

interface Pending {
  resolve: (response: ForensicsWorkerResponse) => void;
  reject: (error: LocalModelError) => void;
}

/**
 * Owns the forensics worker and the two model-backed passes.
 *
 * Separate from `LocalModelService` on purpose: that service owns the single generation-model
 * slot used to *write* reports, and these task models must be able to load and run without
 * evicting it (or being evicted by it).
 */
@Injectable({ providedIn: 'root' })
export class ForensicsService {
  readonly receiptsStatus = signal<ForensicsPassStatus>('idle');
  readonly emotionsStatus = signal<ForensicsPassStatus>('idle');
  /** Shared, because only one pass runs at a time — the UI disables the other while one is busy. */
  readonly progress = signal<ForensicsProgress | null>(null);
  readonly error = signal<LocalModelError | null>(null);

  /** What the shared progress signal currently refers to. */
  private downloadLabel = 'Fetching the model…';

  private worker: Worker | null = null;
  private readonly pending = new Map<string, Pending>();
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
    this.progress.set(null);
    for (const status of [this.receiptsStatus, this.emotionsStatus]) {
      if (status() === 'downloading' || status() === 'running') status.set('cancelled');
    }
  }

  /**
   * Drops every trace of previous passes so the next visit to the forensics screen re-runs from
   * scratch. Called by SessionStore whenever the chat being analyzed changes underneath us.
   *
   * These statuses are otherwise sticky for the life of the tab — the page's auto-run is gated on
   * `receiptsStatus() === 'idle'`, so a stale `'ready'` silently suppresses it and the screen goes
   * on reporting findings computed from a chat the user has since edited.
   *
   * `cancel()` runs first because it flips live passes to `'cancelled'`; writing `'idle'` after it
   * is what makes the reset hold for a pass that was still in flight.
   */
  resetPasses(): void {
    this.cancel();
    this.receiptsStatus.set('idle');
    this.emotionsStatus.set('idle');
    this.progress.set(null);
    this.error.set(null);
  }

  async runReceipts(chat: ParsedChat): Promise<Receipt[]> {
    this.cancelled = false;
    this.error.set(null);

    try {
      const candidates = this.buildCandidates(chat);
      if (candidates.length === 0) {
        this.receiptsStatus.set('ready');
        return [];
      }

      this.receiptsStatus.set('downloading');
      this.downloadLabel = 'Fetching the language model (23 MB)…';
      this.progress.set({ fraction: null, label: this.downloadLabel });
      await this.send({ type: 'load-embedder', requestId: crypto.randomUUID() });
      if (this.cancelled) return [];

      this.receiptsStatus.set('running');

      // Query centroids first — a handful of vectors, and they define what we're looking for.
      this.progress.set({ fraction: 0, label: 'Calibrating…' });
      const phrases = RECEIPT_QUERIES.flatMap((q) => q.phrases);
      const queryEmbeddings = await this.embed(phrases);
      if (this.cancelled) return [];

      const dim = queryEmbeddings.dim;
      const centroids = new Float32Array(RECEIPT_QUERIES.length * dim);
      let offset = 0;
      RECEIPT_QUERIES.forEach((query, qi) => {
        const slice = queryEmbeddings.vectors.subarray(offset * dim, (offset + query.phrases.length) * dim);
        centroids.set(meanPool(slice, query.phrases.length, dim), qi * dim);
        offset += query.phrases.length;
      });

      // Then the chat itself, in batches so progress moves and the UI keeps breathing.
      const candidateVectors = new Float32Array(candidates.length * dim);
      for (let start = 0; start < candidates.length; start += EMBED_BATCH_SIZE) {
        if (this.cancelled) return [];
        const batch = candidates.slice(start, start + EMBED_BATCH_SIZE);
        const embedded = await this.embed(batch.map((c) => c.text));
        candidateVectors.set(embedded.vectors, start * dim);
        this.progress.set({
          fraction: Math.min(1, (start + batch.length) / candidates.length),
          label: `Reading ${candidates.length} messages…`,
        });
      }
      if (this.cancelled) return [];

      const scores = similarityMatrix(candidateVectors, centroids, dim);
      const receipts = selectReceipts(
        candidates,
        scores,
        RECEIPT_QUERIES.map((q) => q.category),
      );

      this.receiptsStatus.set('ready');
      this.progress.set(null);
      return receipts;
    } catch (err) {
      this.error.set(err as LocalModelError);
      this.receiptsStatus.set('error');
      this.progress.set(null);
      return [];
    } finally {
      await this.releaseModels();
    }
  }

  async runEmotions(chat: ParsedChat): Promise<(EmotionAggregate & { wasSampled: boolean }) | null> {
    this.cancelled = false;
    this.error.set(null);

    try {
      const { samples, wasSampled } = selectEmotionSamples(chat);
      if (samples.length === 0) {
        this.emotionsStatus.set('ready');
        return { profiles: [], timeline: [], peakTensionLabel: null, wasSampled: false };
      }

      this.emotionsStatus.set('downloading');
      this.downloadLabel = 'Fetching the emotion model (125 MB)…';
      this.progress.set({ fraction: null, label: this.downloadLabel });
      await this.send({ type: 'load-classifier', requestId: crypto.randomUUID() });
      if (this.cancelled) return null;

      this.emotionsStatus.set('running');

      let labels: string[] = [];
      let scores: Float32Array | null = null;

      // Measured on a realistic length mix: 205ms → 86ms per message, a 2.4x speedup, with
      // identical results — only the order in which messages are fed changes.
      const order = lengthBucketedOrder(samples.map((s) => s.text));

      let processed = 0;
      for (let start = 0; start < order.length; start += CLASSIFY_BATCH_SIZE) {
        if (this.cancelled) return null;
        const batchIndexes = order.slice(start, start + CLASSIFY_BATCH_SIZE);
        const response = await this.send({
          type: 'classify',
          requestId: crypto.randomUUID(),
          texts: batchIndexes.map((i) => samples[i].text),
        });
        if (response.type !== 'classify-result') {
          throw { kind: 'local-generation-failed', message: 'Unexpected classifier response.' } satisfies LocalModelError;
        }
        if (!scores) {
          labels = response.labels;
          scores = new Float32Array(samples.length * labels.length);
        } else if (
          response.labels.length !== labels.length ||
          response.labels.some((label, i) => label !== labels[i])
        ) {
          // Batches are stitched into one matrix by column position, so a shifted label order
          // would silently attribute every score to the wrong emotion. The worker sorts labels
          // to a canonical order precisely to prevent this; fail loudly if that ever stops holding.
          throw {
            kind: 'local-generation-failed',
            message: 'The emotion model returned inconsistent labels between batches.',
          } satisfies LocalModelError;
        }

        // Rows come back in bucketed order, so each one is written to its ORIGINAL sample
        // index — `aggregateEmotions` indexes strictly by position in `samples`.
        batchIndexes.forEach((sampleIndex, row) => {
          scores!.set(
            response.scores.subarray(row * labels.length, (row + 1) * labels.length),
            sampleIndex * labels.length,
          );
        });

        processed += batchIndexes.length;
        this.progress.set({
          fraction: Math.min(1, processed / samples.length),
          label: `Reading the mood of ${samples.length} messages…`,
        });
      }
      if (this.cancelled || !scores) return null;

      const aggregate = aggregateEmotions(samples, labels, scores);
      this.emotionsStatus.set('ready');
      this.progress.set(null);
      return { ...aggregate, wasSampled };
    } catch (err) {
      this.error.set(err as LocalModelError);
      this.emotionsStatus.set('error');
      this.progress.set(null);
      return null;
    } finally {
      await this.releaseModels();
    }
  }

  /**
   * Hands the GPU back as soon as a pass is done. On the local path the generation model
   * (0.8–3.1 GB) is already resident before this page loads, so holding a task model afterwards
   * is pure pressure on a device that is already close to its limit. Best-effort by design — a
   * failure to release must never fail the pass whose results are already computed.
   */
  private async releaseModels(): Promise<void> {
    try {
      if (this.worker) await this.send({ type: 'release-models', requestId: crypto.randomUUID() });
    } catch {
      // Nothing useful to do; the next load will simply reuse whatever is still resident.
    }
  }

  /**
   * Real messages long enough to embed meaningfully, deduplicated so a catchphrase repeated
   * fifty times can't fill someone's entire exhibit list, newest-first under the cap.
   */
  private buildCandidates(chat: ParsedChat): ReceiptCandidate[] {
    const known = new Set(chat.participants.map((p) => p.id));
    const seen = new Set<string>();
    const candidates: ReceiptCandidate[] = [];

    for (const message of chat.messages) {
      if (message.isSystemMessage || message.isMediaOmitted) continue;
      if (!known.has(message.senderId)) continue;
      const text = message.text.replace(/\s+/g, ' ').trim();
      if (text.split(' ').filter(Boolean).length < MIN_CANDIDATE_WORDS) continue;
      const key = `${message.senderId}::${text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        messageId: message.id,
        participantId: message.senderId,
        text,
        timestampMs: message.timestampMs,
      });
    }

    if (candidates.length <= MAX_CANDIDATES) return candidates;
    // Keep an even spread across the whole history rather than only the most recent stretch.
    const step = candidates.length / MAX_CANDIDATES;
    const sampled: ReceiptCandidate[] = [];
    for (let i = 0; i < MAX_CANDIDATES; i++) sampled.push(candidates[Math.floor(i * step)]);
    return sampled;
  }

  private async embed(texts: string[]): Promise<{ vectors: Float32Array; dim: number }> {
    const response = await this.send({ type: 'embed', requestId: crypto.randomUUID(), texts });
    if (response.type !== 'embed-result') {
      throw { kind: 'local-generation-failed', message: 'Unexpected embedder response.' } satisfies LocalModelError;
    }
    return { vectors: response.vectors, dim: response.dim };
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./forensics.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<ForensicsWorkerResponse>) => this.handleMessage(e.data);
      this.worker.onerror = (e) => {
        // Same reasoning as LocalModelService: keeping a dead worker cached turns one crash into
        // every subsequent request hanging.
        this.worker = null;
        this.rejectAll({ kind: 'unknown', message: e.message || 'The forensics worker crashed.' });
      };
    }
    return this.worker;
  }

  private send(request: ForensicsWorkerRequest & { requestId: string }): Promise<ForensicsWorkerResponse> {
    const worker = this.ensureWorker();
    return new Promise<ForensicsWorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(request.requestId)) return;
        this.pending.delete(request.requestId);
        reject({
          kind: 'unknown',
          message: `The forensics worker stopped responding during "${request.type}". Try that pass again.`,
        } satisfies LocalModelError);
      }, WORKER_TIMEOUT_MS);

      const settle = <T>(fn: (value: T) => void) => (value: T) => {
        clearTimeout(timeout);
        fn(value);
      };

      this.pending.set(request.requestId, { resolve: settle(resolve), reject: settle(reject) });
      worker.postMessage(request);
    });
  }

  private handleMessage(data: ForensicsWorkerResponse): void {
    if (data.type === 'load-progress') {
      this.progress.set({
        fraction: data.totalBytes > 0 ? data.loadedBytes / data.totalBytes : null,
        label:
          data.totalBytes > 0 && data.loadedBytes >= data.totalBytes
            ? 'Starting the model up…'
            : this.downloadLabel,
      });
      return;
    }
    if (data.type === 'error') {
      this.pending.get(data.requestId)?.reject(data.error);
      this.pending.delete(data.requestId);
      return;
    }
    this.pending.get(data.requestId)?.resolve(data);
    this.pending.delete(data.requestId);
  }

  private rejectAll(error: LocalModelError): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
