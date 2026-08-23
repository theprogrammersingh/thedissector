import { LocalModelError } from '../models/local-model.model';

/**
 * Wire protocol for the forensics worker. Deliberately separate from
 * `local-llm/local-model.worker-messages.ts`: that worker owns a single generation-model slot
 * for the LLM path, and these small task models must never disturb it.
 *
 * Embeddings cross the boundary as one flat Float32Array plus a row width rather than
 * `number[][]` — a 3000×384 matrix as nested JS arrays is over a million boxed numbers to
 * structured-clone.
 */

export type ForensicsWorkerRequest =
  | { type: 'load-embedder'; requestId: string }
  | { type: 'embed'; requestId: string; texts: string[] }
  | { type: 'load-classifier'; requestId: string }
  | { type: 'classify'; requestId: string; texts: string[] }
  /** Drops the loaded models to free GPU memory, keeping the downloaded files cached. */
  | { type: 'release-models'; requestId: string }
  | { type: 'clear-cache'; requestId: string };

export type ForensicsWorkerResponse =
  | { type: 'load-progress'; requestId: string; loadedBytes: number; totalBytes: number; file?: string }
  | { type: 'load-complete'; requestId: string; device: string }
  | { type: 'embed-result'; requestId: string; vectors: Float32Array; dim: number }
  | { type: 'classify-result'; requestId: string; labels: string[]; scores: Float32Array }
  | { type: 'models-released'; requestId: string }
  | { type: 'cache-cleared'; requestId: string }
  | { type: 'error'; requestId: string; error: LocalModelError };
