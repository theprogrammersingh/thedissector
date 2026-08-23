import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalLimitsService } from './local-limits.service';
import {
  LocalModelDownloadProgress,
  LocalModelError,
  LocalModelKey,
  LocalModelStatus,
} from '../models/local-model.model';
import { LOCAL_MODELS, getLocalModel } from './local-model-catalog';
import { WorkerRequest, WorkerResponse } from './local-model.worker-messages';

/**
 * Deliberately generous: a cold model download on a slow connection is measured in minutes, and
 * a generation pass on a weak GPU is not much quicker. This exists to convert "the worker died
 * silently" into an error, not to police how long real work takes.
 */
const WORKER_TIMEOUT_MS = 15 * 60_000;

interface PendingRequest {
  /** Resolves with the whole response so structured replies (e.g. cache listings) survive. */
  resolve: (response: WorkerResponse) => void;
  reject: (error: LocalModelError) => void;
}

/**
 * Single owner of the app's one local-model Worker, deliberately separate from SessionStore —
 * downloaded model weights must survive SessionStore.reset() (re-downloading gigabytes on every
 * "start new dissection" would be absurd). Nothing here touches Worker or
 * `@huggingface/transformers` until confirmDownload() is actually called.
 */
@Injectable({ providedIn: 'root' })
export class LocalModelService {
  private readonly limits = inject(LocalLimitsService);

  readonly selectedModelKey = signal<LocalModelKey | null>(null);
  readonly cachedModelKey = signal<LocalModelKey | null>(null);
  readonly status = signal<LocalModelStatus>('idle');
  readonly downloadProgress = signal<LocalModelDownloadProgress | null>(null);
  readonly error = signal<LocalModelError | null>(null);

  readonly isReady = computed(() => this.status() === 'ready');
  /** True once a lost GPU device forced the model to be dropped and reloaded. */
  readonly recoveredFromDeviceLoss = signal(false);

  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  selectModel(key: LocalModelKey): void {
    this.selectedModelKey.set(key);
    this.error.set(null);
    this.status.set('awaiting-confirmation');
  }

  cancelDownload(): void {
    if (this.status() === 'downloading' || this.status() === 'clearing-cache' || this.status() === 'initializing') {
      this.status.set(this.cachedModelKey() === this.selectedModelKey() ? 'ready' : 'idle');
    } else {
      this.status.set('idle');
    }
    this.selectedModelKey.set(this.cachedModelKey());
  }

  async confirmDownload(): Promise<void> {
    const key = this.selectedModelKey();
    const descriptor = key ? getLocalModel(key) : undefined;
    if (!descriptor) return;

    this.error.set(null);
    const worker = this.ensureWorker();

    // Evict every OTHER generation model from disk, unconditionally.
    //
    // This used to be gated on `cachedModelKey`, which is an in-memory signal while Cache Storage
    // is persistent: after any page reload the signal is null, the guard short-circuited, and the
    // new model was downloaded on top of the old one. Two Gemmas (~3.5 GB) were observed cached
    // together that way. Only the current selection's repo is spared, so the forensics task
    // models are untouched.
    const stale = LOCAL_MODELS.map((m) => m.hfRepoId).filter((repoId) => repoId !== descriptor.hfRepoId);
    this.status.set('clearing-cache');
    try {
      await this.sendAndWait(worker, { type: 'clear-cache', requestId: crypto.randomUUID(), repoIds: stale });
    } catch (err) {
      this.status.set('error');
      this.error.set(err as LocalModelError);
      return;
    }

    this.status.set('downloading');
    try {
      await this.sendAndWait(worker, { type: 'load', requestId: crypto.randomUUID(), model: descriptor });
      this.cachedModelKey.set(key);
      this.status.set('ready');
      this.downloadProgress.set(null);
    } catch (err) {
      this.status.set('error');
      this.error.set(err as LocalModelError);
    }
  }

  async clearCache(): Promise<void> {
    const worker = this.ensureWorker();
    this.status.set('clearing-cache');
    try {
      await this.sendAndWait(worker, { type: 'clear-cache', requestId: crypto.randomUUID() });
      this.cachedModelKey.set(null);
      this.selectedModelKey.set(null);
      this.status.set('idle');
    } catch (err) {
      this.status.set('error');
      this.error.set(err as LocalModelError);
    }
  }

  /**
   * Reconciles `cachedModelKey` with what is genuinely on disk. Without this the picker reports
   * a freshly-reloaded tab as having nothing downloaded, even with gigabytes sitting in Cache
   * Storage. Safe to call on init; failures leave the signal untouched.
   */
  async syncCachedModel(): Promise<void> {
    try {
      const response = await this.sendAndWait(this.ensureWorker(), {
        type: 'list-cached',
        requestId: crypto.randomUUID(),
      });
      if (response.type !== 'cached-models') return;
      const cached = LOCAL_MODELS.find((m) => response.repoIds.includes(m.hfRepoId));
      // Assigned unconditionally: a successful listing that matches nothing means the cache was
      // emptied (from another tab, or by the browser reclaiming space), and leaving the old key
      // in place would badge a model that is no longer on disk as "Downloaded".
      this.cachedModelKey.set(cached?.key ?? null);
    } catch {
      // Best effort — an unavailable cache simply means we show nothing as downloaded.
    }
  }

  /** Runs one generation pass on the currently loaded model; used by LocalProvider. */
  async runPass(
    pass: string,
    systemPrompt: string,
    userPrompt: string,
    opts: { temperature: number; maxOutputTokens: number; maxInputTokens?: number },
  ): Promise<string> {
    if (!this.isReady()) {
      throw { kind: 'local-generation-failed', message: 'No local model is ready.' } satisfies LocalModelError;
    }
    const worker = this.ensureWorker();
    const response = await this.sendAndWait(worker, {
      type: 'generate',
      requestId: crypto.randomUUID(),
      pass,
      systemPrompt,
      userPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      maxInputTokens: opts.maxInputTokens,
    });
    if (response.type !== 'generate-result') return '';
    // Surfaced in the on-device settings so the budget can be tuned against a real measurement
    // rather than against the estimate that produced it.
    this.limits.lastMeasuredInputTokens.set(response.inputTokens);
    return response.text;
  }

  /**
   * Re-loads the current model onto a fresh GPU device after the worker dropped it.
   *
   * Deliberately not a CPU fallback: the `q4f16` weights need a block-quantized gather kernel
   * that the CPU execution provider does not implement, so WASM cannot run them at all. The
   * second attempt has a real chance because the forensics task models are released by this
   * point, freeing the memory that caused the loss. Weights come from Cache Storage — no
   * re-download.
   *
   * Throws if the reload itself fails, which the caller surfaces as an out-of-memory error.
   */
  async reloadAfterDeviceLoss(): Promise<void> {
    const key = this.selectedModelKey();
    const descriptor = key ? getLocalModel(key) : undefined;
    if (!descriptor) {
      throw { kind: 'local-out-of-memory', message: 'No local model to reload.' } satisfies LocalModelError;
    }

    this.recoveredFromDeviceLoss.set(true);
    this.status.set('initializing');
    try {
      await this.sendAndWait(this.ensureWorker(), {
        type: 'load',
        requestId: crypto.randomUUID(),
        model: descriptor,
      });
      this.status.set('ready');
    } catch (err) {
      this.status.set('error');
      this.error.set(err as LocalModelError);
      throw err;
    }
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./local-model.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data);
      this.worker.onerror = (e) => {
        // Dropping the reference is the load-bearing part: the crashed worker used to stay
        // cached, so every later request posted into a dead thread and waited forever.
        this.worker = null;
        this.rejectAll({ kind: 'unknown', message: e.message || 'The on-device worker crashed.' });
      };
    }
    return this.worker;
  }

  private sendAndWait(
    worker: Worker,
    request: WorkerRequest & { requestId: string },
  ): Promise<WorkerResponse> {
    return new Promise<WorkerResponse>((resolve, reject) => {
      // A model download or a generation pass can legitimately run for minutes, so the timeout
      // is a backstop against a lost message rather than a latency budget. Without one, a reply
      // that never arrives is indistinguishable from work still in progress — forever.
      const timeout = setTimeout(() => {
        if (!this.pending.has(request.requestId)) return;
        this.pending.delete(request.requestId);
        reject({
          kind: 'unknown',
          message: `The on-device worker stopped responding during "${request.type}". Try again.`,
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

  private handleMessage(data: WorkerResponse): void {
    switch (data.type) {
      case 'load-progress':
        this.downloadProgress.set({ loadedBytes: data.loadedBytes, totalBytes: data.totalBytes });
        if (data.totalBytes > 0 && data.loadedBytes < data.totalBytes) {
          this.status.set('downloading');
        } else {
          this.status.set('initializing');
        }
        return;
      case 'load-error':
      case 'generate-error':
      case 'cache-error':
        this.rejectPending(data.requestId, data.error);
        return;
      case 'load-complete':
      case 'generate-result':
      case 'clear-cache-complete':
      case 'cached-models':
        this.resolvePending(data.requestId, data);
        return;
    }
  }

  private resolvePending(requestId: string, response: WorkerResponse): void {
    this.pending.get(requestId)?.resolve(response);
    this.pending.delete(requestId);
  }

  private rejectPending(requestId: string, error: LocalModelError): void {
    this.pending.get(requestId)?.reject(error);
    this.pending.delete(requestId);
  }

  private rejectAll(error: LocalModelError): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
