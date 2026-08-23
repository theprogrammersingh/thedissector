import { LocalModelDescriptor } from '../models/local-model.model';

/**
 * Sizes verified against live Hugging Face Hub file listings (q4f16 dtype). `gemma-3-4b` and
 * `gemma-4-e2b` are natively multimodal, but loading them via `AutoModelForCausalLM` (see
 * local-model.worker.ts) triggers transformers.js's built-in "cross-architecture loading"
 * path (`resolveTypeConfig` in `@huggingface/transformers/src/models/modeling_utils.js`):
 * requesting a `*ForCausalLM` class against a `*ForConditionalGeneration` model config sets
 * `textOnly = true`, which — per `MODEL_SESSION_CONFIG` in `session_config.js` and the file
 * filtering in `get_pipeline_files.js` — genuinely skips fetching the `vision_encoder`/
 * `audio_encoder` ONNX files, not just skips building sessions from already-fetched files.
 * The sizes below reflect that text-only path (decoder + embed_tokens only).
 *
 * `contextWindowTokens` is a conservative practical figure, not the advertised max — see
 * LocalModelDescriptor's doc comment.
 *
 * `gemma-3-4b`/`gemma-4-e2b` carry a `caveat`: live testing found they produce unusable output
 * (either the repeated placeholder token `<unused57>` under sampling, or an empty string under
 * greedy decoding) — likely because transformers.js's `.generate()` loop doesn't correctly carry
 * these Gemma3n-family models' extra `per_layer_inputs` cache tensor across steps when reached via
 * the cross-architecture text-only path (see `modeling_gemma3n.js`'s `forward()`). `gemma-3-1b` is
 * a plain, single-cache Gemma3 architecture with none of this and is not affected.
 *
 * They carry a second, independent problem: at 2.77–3.11 GB they leave little GPU headroom, and a
 * user hitting "Invalid Buffer ... invalid due to a previous error" mid-generation traced back to
 * exhausting the device while the forensics task models shared it. The generation path now drops
 * to CPU and recovers rather than dying, but no amount of memory management makes a 3.1 GB model
 * fit a GPU that hasn't the room.
 *
 * The five `qwen*` entries deliberately use `dtype: 'q4'` instead of the otherwise-standard
 * `q4f16` WebGPU-optimized variant. `q4f16` was tried first and failed at session creation with
 * "Type Error: Type (tensor(float16)) of output arg (.../input_layernorm/Cast_output_0) ... does
 * not match expected type (tensor(float))" — a WebGPU execution-provider bug where the exported
 * graph's LayerNorm Cast node disagrees with onnxruntime-web about its own output type. This is
 * the same class of bug tracked upstream for a different model at
 * https://github.com/microsoft/onnxruntime/issues/26732 (fp16/q4f16 models producing invalid
 * output or session-creation type errors on WebGPU specifically), hitting the `onnx-community`
 * Qwen2.5/Qwen3 conversion pipeline here. `q4` has no fp16-typed activations, so the Cast node
 * class that mismatches doesn't exist in that graph. Sizes below are the `q4` file sizes, verified
 * against each repo's live `onnx/` file listing — not the smaller `q4f16` sizes an earlier version
 * of this file estimated. `qwen3.5-0.8b`/`qwen3.5-2b` were switched to `q4` proactively (same
 * conversion pipeline, not yet reported broken but not verified fixed either) and separately carry
 * the same "untested multimodal forced-path" caveat as `gemma-3-4b`/`gemma-4-e2b`, described above.
 * `dtype: 'q4'` is in fact Hugging Face's own documented example for `qwen2.5-0.5b`'s exact repo
 * (see the transformers.js dtypes guide) — a live "std::bad_alloc" from `OrtRun()` reported against
 * it looks like device memory pressure (compounded by the forensics task models sharing the GPU,
 * same root cause as the Gemma note above), not a wrong dtype choice; see `isDeviceLostError` in
 * local-model.worker.ts, which now classifies this the same way as other out-of-memory failures.
 *
 * `qwen3-0.6b` points at `onnx-community/Qwen3-0.6B-ONNX`, not the `-Instruct-ONNX` repo from a
 * different (`minpeter`) source this used to point at: that repo's `apply_chat_template()` failed
 * with "tokenizer.chat_template is not set" — it ships a `chat_template.jinja` file, but not the
 * embedded `tokenizer_config.json` field this app's installed `@huggingface/transformers` version
 * reads. `onnx-community/Qwen3-0.6B-ONNX` (Qwen3's dense checkpoints are chat-capable without a
 * separate "-Instruct" release) has the template embedded directly and works the same way as the
 * already-working `qwen3-1.7b` entry, which uses the equivalent official `onnx-community` conversion.
 */
export const LOCAL_MODELS: LocalModelDescriptor[] = [
  {
    key: 'gemma-3-1b',
    label: 'Gemma 3 1B',
    hfRepoId: 'onnx-community/gemma-3-1b-it-ONNX',
    dtype: 'q4f16',
    modality: 'text',
    estimatedDownloadBytes: 763_000_000,
    contextWindowTokens: 8192,
  },
  {
    key: 'gemma-3-4b',
    label: 'Gemma 3 4B',
    hfRepoId: 'onnx-community/gemma-3-4b-it-ONNX',
    dtype: 'q4f16',
    modality: 'text+vision',
    estimatedDownloadBytes: 2_770_000_000,
    contextWindowTokens: 8192,
    caveat: 'Often produces unusable output — Gemma 3 1B is more reliable.',
    caveatDetail:
      'Live testing found it emits either a repeated placeholder token or an empty string. At 2.8–3.1 GB it can also exhaust GPU memory partway through a run.',
  },
  {
    key: 'gemma-4-e2b',
    label: 'Gemma 4 E2B',
    hfRepoId: 'onnx-community/gemma-4-E2B-it-ONNX',
    dtype: 'q4f16',
    modality: 'text+vision+audio',
    estimatedDownloadBytes: 3_110_000_000,
    contextWindowTokens: 8192,
    caveat: 'Often produces unusable output — Gemma 3 1B is more reliable.',
    caveatDetail:
      'Live testing found it emits either a repeated placeholder token or an empty string. At 2.8–3.1 GB it can also exhaust GPU memory partway through a run.',
  },
  {
    key: 'qwen2.5-0.5b',
    label: 'Qwen2.5 0.5B',
    hfRepoId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    dtype: 'q4',
    modality: 'text',
    estimatedDownloadBytes: 786_000_000,
    contextWindowTokens: 8192,
  },
  {
    key: 'qwen3-0.6b',
    label: 'Qwen3 0.6B',
    hfRepoId: 'onnx-community/Qwen3-0.6B-ONNX',
    dtype: 'q4',
    modality: 'text',
    estimatedDownloadBytes: 919_000_000,
    contextWindowTokens: 8192,
  },
  {
    key: 'qwen3-1.7b',
    label: 'Qwen3 1.7B',
    hfRepoId: 'onnx-community/Qwen3-1.7B-ONNX',
    dtype: 'q4',
    modality: 'text',
    estimatedDownloadBytes: 2_150_000_000,
    contextWindowTokens: 8192,
  },
  {
    key: 'qwen3.5-0.8b',
    label: 'Qwen3.5 0.8B',
    hfRepoId: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
    dtype: 'q4',
    modality: 'text+vision',
    estimatedDownloadBytes: 647_000_000,
    contextWindowTokens: 8192,
    caveat: 'Untested on this device path.',
    caveatDetail:
      "Downloads as q4 rather than the usual q4f16 — that variant hit a session-creation type error on this model family. It also loads through a forced text-only path because it is natively multimodal, and whether that causes the same generation problems as Gemma 3 4B has not been verified. Try Qwen3 1.7B or a Gemma model if output comes back empty or garbled.",
  },
  {
    key: 'qwen3.5-2b',
    label: 'Qwen3.5 2B',
    hfRepoId: 'onnx-community/Qwen3.5-2B-ONNX-OPT',
    dtype: 'q4',
    modality: 'text+vision',
    estimatedDownloadBytes: 1_533_000_000,
    contextWindowTokens: 8192,
    caveat: 'Untested on this device path.',
    caveatDetail:
      "Downloads as q4 rather than the usual q4f16 — that variant hit a session-creation type error on this model family. It also loads through a forced text-only path because it is natively multimodal, and whether that causes the same generation problems as Gemma 3 4B has not been verified. Try Qwen3 1.7B or a Gemma model if output comes back empty or garbled.",
  },
];

export function getLocalModel(key: string): LocalModelDescriptor | undefined {
  return LOCAL_MODELS.find((m) => m.key === key);
}
