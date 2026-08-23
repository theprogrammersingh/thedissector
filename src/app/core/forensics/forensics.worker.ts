/// <reference lib="webworker" />

import { FORENSICS_MODELS } from './forensics-model-catalog';
import type { ForensicsWorkerRequest, ForensicsWorkerResponse } from './forensics.worker-messages';

/**
 * Runs the two small task models behind the forensics passes. `@huggingface/transformers` is
 * imported dynamically so it stays in its own esbuild chunk and costs nothing until a user
 * actually opts into one of these passes.
 */

type TransformersModule = typeof import('@huggingface/transformers');
type DataType = import('@huggingface/transformers').DataType;

const CACHE_NAME = 'transformers-cache';

const EMBEDDER_REPO = FORENSICS_MODELS.embedder.hfRepoId;
const CLASSIFIER_REPO = FORENSICS_MODELS.classifier.hfRepoId;
const DTYPE: DataType = 'q8';

/**
 * Guard against a single pasted wall of text dragging a whole batch's padded length up.
 * Measured to make no difference on ordinary chat messages — this is a safety bound, not a
 * speed optimization. The real win is the caller's length-bucketed batching.
 */
const MAX_SEQUENCE_LENGTH = 256;

type AnyPipeline = Awaited<ReturnType<TransformersModule['pipeline']>>;

let transformers: TransformersModule | null = null;
let embedder: AnyPipeline | null = null;
let classifier: AnyPipeline | null = null;

function reply(response: ForensicsWorkerResponse, transfer?: Transferable[]): void {
  postMessage(response, { transfer: transfer ?? [] });
}

async function getTransformers(): Promise<TransformersModule> {
  if (!transformers) transformers = await import('@huggingface/transformers');
  return transformers;
}

function progressReporter(requestId: string) {
  let lastLoaded = 0;
  let lastTotal = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (info: any) => {
    if (info?.status !== 'progress' && info?.status !== 'progress_total') return;
    lastLoaded = info.loaded ?? lastLoaded;
    lastTotal = info.total ?? lastTotal;
    reply({ type: 'load-progress', requestId, loadedBytes: lastLoaded, totalBytes: lastTotal, file: info.file });
  };
}

/**
 * WebGPU is dramatically faster but isn't available everywhere (and can fail at init on some
 * drivers), so a WASM fallback keeps the feature usable rather than simply unavailable.
 */
async function loadPipeline(
  task: 'feature-extraction' | 'text-classification',
  repo: string,
  requestId: string,
): Promise<{ pipe: AnyPipeline; device: string }> {
  const { pipeline } = await getTransformers();
  const progress_callback = progressReporter(requestId);
  try {
    const pipe = await pipeline(task, repo, { dtype: DTYPE, device: 'webgpu', progress_callback });
    return { pipe, device: 'webgpu' };
  } catch {
    const pipe = await pipeline(task, repo, { dtype: DTYPE, device: 'wasm', progress_callback });
    return { pipe, device: 'wasm' };
  }
}

/**
 * A lost WebGPU device surfaces as a wall of onnxruntime internals — file paths, `OrtRun`,
 * `mapAsync`, "invalid due to a previous error". None of that means anything to a user, and the
 * actionable cause is almost always memory pressure from another model sharing the GPU.
 */
/**
 * Same precision requirement as the generation worker's copy: onnxruntime-web wraps every
 * inference failure in "failed to call OrtRun()", so matching that would relabel unrelated
 * errors as out-of-memory. Match only genuine memory/device signals.
 */
export function isDeviceLostError(err: unknown): boolean {
  const text = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    text.includes('out of memory') ||
    text.includes('oom') ||
    text.includes('failed to allocate') ||
    text.includes('device lost') ||
    text.includes('device is lost') ||
    text.includes('device was lost') ||
    text.includes('due to a previous error') ||
    text.includes('invalid buffer') ||
    text.includes('mapasync')
  );
}

function toError(err: unknown, kind: 'local-download-failed' | 'local-generation-failed') {
  const detail = err instanceof Error ? err.message : String(err);
  if (isDeviceLostError(err)) {
    return { kind: 'local-out-of-memory', message: 'The GPU ran out of memory during this pass.', detail } as const;
  }
  return { kind, message: detail, detail } as const;
}

async function handleLoadEmbedder(req: Extract<ForensicsWorkerRequest, { type: 'load-embedder' }>): Promise<void> {
  try {
    if (embedder) {
      reply({ type: 'load-complete', requestId: req.requestId, device: 'cached' });
      return;
    }
    const { pipe, device } = await loadPipeline('feature-extraction', EMBEDDER_REPO, req.requestId);
    embedder = pipe;
    reply({ type: 'load-complete', requestId: req.requestId, device });
  } catch (err) {
    reply({ type: 'error', requestId: req.requestId, error: toError(err, 'local-download-failed') });
  }
}

async function handleLoadClassifier(req: Extract<ForensicsWorkerRequest, { type: 'load-classifier' }>): Promise<void> {
  try {
    if (classifier) {
      reply({ type: 'load-complete', requestId: req.requestId, device: 'cached' });
      return;
    }
    const { pipe, device } = await loadPipeline('text-classification', CLASSIFIER_REPO, req.requestId);
    classifier = pipe;
    reply({ type: 'load-complete', requestId: req.requestId, device });
  } catch (err) {
    reply({ type: 'error', requestId: req.requestId, error: toError(err, 'local-download-failed') });
  }
}

async function handleEmbed(req: Extract<ForensicsWorkerRequest, { type: 'embed' }>): Promise<void> {
  try {
    if (!embedder) throw new Error('Embedder is not loaded.');
    // `normalize: true` makes every vector unit-length, so cosine similarity downstream is a
    // plain dot product.
    const output = (await (embedder as unknown as CallableFunction)(req.texts, {
      pooling: 'mean',
      normalize: true,
    })) as { data: Float32Array; dims: number[] };

    const dim = output.dims.at(-1) ?? 0;
    const vectors = new Float32Array(output.data);
    reply({ type: 'embed-result', requestId: req.requestId, vectors, dim }, [vectors.buffer]);
  } catch (err) {
    reply({ type: 'error', requestId: req.requestId, error: toError(err, 'local-generation-failed') });
  }
}

async function handleClassify(req: Extract<ForensicsWorkerRequest, { type: 'classify' }>): Promise<void> {
  try {
    if (!classifier) throw new Error('Classifier is not loaded.');
    // go_emotions is multi-label: `top_k: null` returns every label's sigmoid score rather
    // than just the argmax, which is what the profiles and tension score need.
    const output = (await (classifier as unknown as CallableFunction)(req.texts, {
      top_k: null,
      truncation: true,
      max_length: MAX_SEQUENCE_LENGTH,
    })) as { label: string; score: number }[][] | { label: string; score: number }[];

    // A single input comes back unwrapped; normalize to one row per text.
    const rows = (Array.isArray(output[0]) ? output : [output]) as { label: string; score: number }[][];
    // CRITICAL: the pipeline returns each row's labels sorted by score descending, so the
    // order differs from row to row AND from batch to batch. Sorting to a canonical order
    // makes every batch's matrix line up — without it the caller stitches batches together
    // against the first batch's ordering and silently reads the wrong emotion per column.
    const labels = [...new Set(rows.flatMap((row) => row.map((entry) => entry.label)))].sort();
    const scores = new Float32Array(rows.length * labels.length);
    rows.forEach((row, r) => {
      const byLabel = new Map(row.map((entry) => [entry.label, entry.score]));
      labels.forEach((label, c) => {
        scores[r * labels.length + c] = byLabel.get(label) ?? 0;
      });
    });

    reply({ type: 'classify-result', requestId: req.requestId, labels, scores }, [scores.buffer]);
  } catch (err) {
    reply({ type: 'error', requestId: req.requestId, error: toError(err, 'local-generation-failed') });
  }
}

/**
 * Frees GPU memory without deleting the downloads.
 *
 * This worker shares the GPU with the generation worker, which on the local path already holds a
 * 0.8–3.1 GB model before this page is even reachable. Holding a task model after its pass has
 * finished is what pushed the device over and produced "Invalid Buffer ... invalid due to a
 * previous error". Reloading later comes from Cache Storage and costs a second or two.
 */
async function handleReleaseModels(
  req: Extract<ForensicsWorkerRequest, { type: 'release-models' }>,
): Promise<void> {
  embedder = null;
  classifier = null;
  // Give the GPU allocator a turn to actually reclaim before the caller loads anything else.
  await new Promise((resolve) => setTimeout(resolve, 0));
  reply({ type: 'models-released', requestId: req.requestId });
}

async function handleClearCache(req: Extract<ForensicsWorkerRequest, { type: 'clear-cache' }>): Promise<void> {
  try {
    embedder = null;
    classifier = null;
    await caches.delete(CACHE_NAME);
    reply({ type: 'cache-cleared', requestId: req.requestId });
  } catch (err) {
    reply({ type: 'error', requestId: req.requestId, error: toError(err, 'local-download-failed') });
  }
}

addEventListener('message', ({ data }: MessageEvent<ForensicsWorkerRequest>) => {
  switch (data.type) {
    case 'load-embedder':
      void handleLoadEmbedder(data);
      break;
    case 'load-classifier':
      void handleLoadClassifier(data);
      break;
    case 'embed':
      void handleEmbed(data);
      break;
    case 'classify':
      void handleClassify(data);
      break;
    case 'release-models':
      void handleReleaseModels(data);
      break;
    case 'clear-cache':
      void handleClearCache(data);
      break;
  }
});
