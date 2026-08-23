/// <reference lib="webworker" />

import type { WorkerRequest, WorkerResponse } from './local-model.worker-messages';

// Lazily imported inside handlers so this worker's own chunk stays tiny until actually used —
// mirrors the confirmed Phase-0 finding that a dynamic import() here becomes its own separate
// esbuild-split chunk, keeping @huggingface/transformers out of every route's bundle cost.
type TransformersModule = typeof import('@huggingface/transformers');
type Tensor = InstanceType<TransformersModule['Tensor']>;
type DataType = import('@huggingface/transformers').DataType;

const CACHE_NAME = 'transformers-cache'; // confirmed via DevTools > Application > Cache Storage in Phase 0's spike.

let transformers: TransformersModule | null = null;
let tokenizer: Awaited<ReturnType<TransformersModule['AutoTokenizer']['from_pretrained']>> | null =
  null;
let model: Awaited<
  ReturnType<TransformersModule['AutoModelForCausalLM']['from_pretrained']>
> | null = null;
let loadedRepoId: string | null = null;

/**
 * There is deliberately no CPU fallback for generation.
 *
 * Note the catalogue is now mixed: the three Gemma entries are `q4f16`, the five Qwen entries are
 * plain `q4` (see local-model-catalog.ts for why). The argument below is stated for `q4f16` and
 * holds for those; for `q4` the objection is simpler — CPU inference on a multi-billion-parameter
 * model in a browser tab is slow enough to be useless, so neither dtype gets a CPU path.
 *
 * The `q4f16` weights are block-quantized and need `com.microsoft.GatherBlockQuantized`
 * for the embedding lookup — a kernel the CPU execution provider does not implement. Loading them
 * on WASM fails at session creation with "Failed to find kernel for
 * com.microsoft.GatherBlockQuantized ... ep:'CPUExecutionProvider'". Every CPU-viable dtype in
 * these repos is a different, larger file (int8 1.0 GB, quantized 1.5 GB, fp16 2.0 GB), so
 * "falling back" would mean asking someone who just ran out of memory to fetch another gigabyte.
 *
 * Recovery is therefore: drop the dead model and reload once on WebGPU — by then the forensics
 * task models have been released, so there is materially more headroom than on the first attempt.
 */

/**
 * Whether a failure is genuinely a lost/exhausted GPU device, as opposed to any other runtime
 * error.
 *
 * This has to be precise in both directions. onnxruntime-web wraps EVERY inference failure as
 * "failed to call OrtRun(). ERROR_CODE: N, ERROR_MESSAGE: ...", so matching on `OrtRun` — as an
 * earlier version of this did — labels unrelated failures (bad shapes, unsupported ops, the
 * Gemma3n cache defect) as "the GPU ran out of memory", and needlessly drops and reloads a
 * multi-gigabyte model on the way. Match only on the parts that actually indicate memory or a
 * dead device, wherever they appear in the wrapped message.
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
    // The invalidated-buffer cascade that follows a lost device.
    text.includes('due to a previous error') ||
    text.includes('invalid buffer') ||
    text.includes('mapasync') ||
    // std::bad_alloc from OrtRun() — a host-side allocation failure, seen when a model's
    // fp32-activation dtype (e.g. 'q4') needs more headroom than is left once the forensics
    // task models have already claimed their share of the device.
    text.includes('bad_alloc')
  );
}

/**
 * Whether a failure is onnxruntime refusing an oversized tensor rather than a genuine runtime
 * fault. The prefill logits tensor is `[1, seq_len, vocab_size]`, and with these models' very
 * large vocabularies its byte size crosses int32 at only ~2K input tokens (see
 * LOCAL_MAX_INPUT_TOKENS), at which point SafeInt throws. Distinguishing it matters because the
 * remedy is entirely different from a memory failure: a smaller prompt, not a smaller model.
 */
export function isContextOverflowError(err: unknown): boolean {
  const text = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return text.includes('integer overflow') || text.includes('safeint');
}

function reply(response: WorkerResponse): void {
  postMessage(response);
}

async function getTransformers(): Promise<TransformersModule> {
  if (!transformers) {
    transformers = await import('@huggingface/transformers');
  }
  return transformers;
}

async function handleLoad(req: Extract<WorkerRequest, { type: 'load' }>): Promise<void> {
  try {
    const { hfRepoId, dtype } = req.model;
    if (loadedRepoId === hfRepoId && model && tokenizer) {
      reply({ type: 'load-complete', requestId: req.requestId });
      return;
    }

    const { AutoTokenizer, AutoModelForCausalLM } = await getTransformers();

    let lastLoaded = 0;
    let lastTotal = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progress_callback = (info: any) => {
      if (info?.status === 'progress_total' || info?.status === 'progress') {
        lastLoaded = info.loaded ?? lastLoaded;
        lastTotal = info.total ?? lastTotal;
        reply({
          type: 'load-progress',
          requestId: req.requestId,
          loadedBytes: lastLoaded,
          totalBytes: lastTotal,
          file: info.file,
        });
      }
    };

    tokenizer = await AutoTokenizer.from_pretrained(hfRepoId);
    // AutoModelForCausalLM dispatches to each family's `*ForCausalLM` class (e.g.
    // Gemma4ForCausalLM), which transformers.js's cross-architecture loading detects against
    // these repos' native `*ForConditionalGeneration` config and loads text-only — this
    // genuinely skips downloading vision_encoder/audio_encoder files, not just their sessions.
    // See local-model-catalog.ts's doc comment for the exact mechanism/source references.
    model = await AutoModelForCausalLM.from_pretrained(hfRepoId, {
      dtype: dtype as DataType,
      device: 'webgpu',
      progress_callback,
    });
    loadedRepoId = hfRepoId;

    reply({ type: 'load-complete', requestId: req.requestId });
  } catch (err) {
    reply({
      type: 'load-error',
      requestId: req.requestId,
      error: {
        kind: 'local-download-failed',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function handleGenerate(req: Extract<WorkerRequest, { type: 'generate' }>): Promise<void> {
  try {
    if (!tokenizer || !model) {
      throw new Error('No local model is loaded — call load before generate.');
    }
    const messages = [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: req.userPrompt },
    ];
    const inputs = tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
    }) as { input_ids: { dims: number[] } } & Record<string, unknown>;

    // The real tokenized length, as opposed to the ~4-chars-per-token estimate the prompt was
    // budgeted against upstream. This is the number that decides whether the run survives, so
    // it is logged on every pass and attached to the error below when it doesn't.
    const inputTokens = inputs.input_ids.dims.at(-1) ?? 0;
    console.info(`[local-model] ${req.pass} pass: ${inputTokens} input tokens`);

    if (req.maxInputTokens && inputTokens > req.maxInputTokens) {
      reply({
        type: 'generate-error',
        requestId: req.requestId,
        pass: req.pass,
        error: {
          kind: 'local-context-overflow',
          message: 'The case file was too large for the on-device model to read in one go.',
          detail: `Prompt tokenized to ${inputTokens} tokens, over the ${req.maxInputTokens}-token limit for on-device runs.`,
        },
      });
      return;
    }

    const output = await model.generate({
      ...inputs,
      max_new_tokens: req.maxOutputTokens,
      temperature: req.temperature,
      do_sample: req.temperature > 0,
    });

    const outputTensor = output as Tensor;
    const inputLength = inputs.input_ids.dims.at(-1) ?? 0;
    const seqLength = outputTensor.dims.at(-1) ?? inputLength;
    const newTokens = outputTensor.slice(null, [inputLength, seqLength]);
    const decoded = tokenizer.batch_decode(newTokens, { skip_special_tokens: true });

    reply({
      type: 'generate-result',
      requestId: req.requestId,
      pass: req.pass,
      text: decoded[0] ?? '',
      inputTokens,
    });
  } catch (err) {
    // Checked before the device-lost branch: an oversized tensor is not a lost device, and
    // dropping and reloading a multi-gigabyte model would not help a prompt that is too long.
    if (isContextOverflowError(err)) {
      reply({
        type: 'generate-error',
        requestId: req.requestId,
        pass: req.pass,
        error: {
          kind: 'local-context-overflow',
          message: 'The case file was too large for the on-device model to read in one go.',
          detail: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }
    if (isDeviceLostError(err)) {
      // The cached model is unusable from here on — every later buffer op reports "invalid due to
      // a previous error" — so drop it and let the caller reload onto a fresh device.
      model = null;
      tokenizer = null;
      loadedRepoId = null;
      reply({
        type: 'generate-error',
        requestId: req.requestId,
        pass: req.pass,
        error: {
          kind: 'local-device-lost',
          message: 'The GPU ran out of memory and dropped the model.',
          detail: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }
    reply({
      type: 'generate-error',
      requestId: req.requestId,
      pass: req.pass,
      error: {
        kind: 'local-generation-failed',
        message: err instanceof Error ? err.message : String(err),
        detail: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function handleClearCache(
  req: Extract<WorkerRequest, { type: 'clear-cache' }>,
): Promise<void> {
  try {
    model = null;
    tokenizer = null;
    loadedRepoId = null;

    if (req.repoIds?.length) {
      // Targeted eviction: dropping the whole store would also throw away the forensics task
      // models, which have nothing to do with swapping the generation model.
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      await Promise.all(
        keys
          .filter((request) => req.repoIds!.some((repoId) => request.url.includes(repoId)))
          .map((request) => cache.delete(request)),
      );
    } else {
      await caches.delete(CACHE_NAME);
    }

    reply({ type: 'clear-cache-complete', requestId: req.requestId });
  } catch (err) {
    reply({
      type: 'cache-error',
      requestId: req.requestId,
      error: { kind: 'unknown', message: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Which of the given repos actually have files on disk. Cache Storage outlives the tab, so this
 * is the only trustworthy answer — an in-memory "what did we download" flag resets on reload
 * while the gigabytes stay put.
 */
async function handleListCached(
  req: Extract<WorkerRequest, { type: 'list-cached' }>,
): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const repoIds = new Set<string>();
    for (const request of keys) {
      const match = /huggingface\.co\/([^/]+\/[^/]+)\//.exec(request.url);
      if (match) repoIds.add(match[1]);
    }
    reply({ type: 'cached-models', requestId: req.requestId, repoIds: [...repoIds] });
  } catch (err) {
    reply({
      type: 'cache-error',
      requestId: req.requestId,
      error: { kind: 'unknown', message: err instanceof Error ? err.message : String(err) },
    });
  }
}

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  switch (data.type) {
    case 'load':
      void handleLoad(data);
      break;
    case 'generate':
      void handleGenerate(data);
      break;
    case 'clear-cache':
      void handleClearCache(data);
      break;
    case 'list-cached':
      void handleListCached(data);
      break;
    case 'cancel':
      // Best-effort only — transformers.js's generate() has no confirmed mid-run abort hook.
      // The main thread stops waiting on this requestId; any in-flight compute is discarded
      // when its result eventually arrives (see LocalModelService's requestId correlation).
      break;
  }
});
