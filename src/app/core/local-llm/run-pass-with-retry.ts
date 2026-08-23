import { LocalModelError } from '../models/local-model.model';
import { LocalModelService } from './local-model.service';
import { LocalPassPrompt } from '../prompts/local/group-audit-prompt';

// The app-wide default temperature (0.8, in DEFAULT_ANALYSIS_SETTINGS) is tuned for remote
// frontier models; the local settings UI never exposes a temperature control, so this was never
// a deliberate choice for on-device generation. Verified empirically: 0.3 measurably improves a
// small model's JSON-format compliance and cuts rambling (which itself causes more malformed output).
export const LOCAL_GENERATION_TEMPERATURE = 0.3;

/**
 * Same story as the temperature above: `DEFAULT_ANALYSIS_SETTINGS.maxOutputTokens` is 8192, sized
 * for cloud models, while a local pass emits a small JSON object. This bounds the worst case
 * instead.
 *
 * The value is measured, not guessed. On gemma-3-1b over the same 3-participant fixture, counting
 * dossier passes (3 = no retries) and the longest output:
 *
 *   1024 → 7 passes, longest 2000 chars — i.e. cut off mid-JSON at the cap, failing validation
 *   2048 → 6 passes, longest 1324 chars — finished on its own
 *   4096 → 4 passes, longest 1097 chars — finished on its own
 *
 * Typical output is ~1100-1350 chars (~350 tokens), but the model intermittently rambles well past
 * that, and truncation costs a whole retry. 2048 clears the observed ceiling while staying 4x under
 * the cloud default. Note the real memory fix is releasing the forensics task models after each
 * pass (see `forensics.service.ts`) — this cap bounds a tail case rather than carrying the win.
 */
export const LOCAL_MAX_OUTPUT_TOKENS = 2048;

/**
 * Default ceiling on the INPUT side — a different and much harder limit than the models'
 * advertised 8192-token context window. This is the fallback default for LocalLimitsService,
 * which is what actually reaches the model; the user can raise it for a stronger device.
 *
 * **Be honest about what is known here, because the number is not derived from a measurement.**
 *
 * Measured:
 *  - Past roughly 8,000 input tokens, a large chat reliably fails mid-run with
 *      failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: .../safeint.h:17
 *      SafeIntExceptionHandler<...>::SafeIntOnOverflow() Integer overflow
 *  - The same setting succeeds on a small chat, whose evidence pack renders to a few hundred
 *    tokens. Same configuration, different prompt sizes, only the large one fails — so the
 *    failure tracks input token count, not chat size or model choice.
 *  - Unbounded packs (~9,850 tokens for 8 participants) always failed.
 *
 * Inferred, and NOT verified:
 *  - That the overflowing tensor is the prefill logits `[1, seq_len, vocab_size]`.
 *  - That Gemma 3's vocabulary is 262,144 (never read from its config.json).
 *  - That the ONNX export emits logits for every position rather than last-token-only.
 *  If all three hold, fp32 bytes ≈ 1 MB per input token for Gemma and the int32 limit
 *  (2,147,483,647) lands near ~2,048 tokens — consistent with the observations above, but that
 *  is agreement, not proof.
 *
 * So: the true ceiling is somewhere below ~8,000 and above a few hundred. 2000 is a conservative
 * default inside that bracket, not a discovered boundary. `local-model.worker.ts` logs the real
 * tokenized length of every pass — that log, on real hardware, is how the actual limit should be
 * found, rather than by refining the arithmetic above.
 */
export const LOCAL_MAX_INPUT_TOKENS = 2000;

/**
 * Default cap on how many of the most recent messages an on-device run looks at.
 *
 * This does not bound prompt size — LOCAL_MAX_INPUT_TOKENS and the evidence-pack budget do that.
 * What it bounds is the forensics passes, which embed up to 3,000 messages through MiniLM and
 * classify up to 1,200 through roberta; on a 19K-message export those are by far the slowest part
 * of a local run. Narrowing the window also concentrates the samplers, which spread evenly across
 * whatever history they are given.
 */
export const LOCAL_MAX_MESSAGES = 2000;

/**
 * What the surrounding prompt costs before any evidence is added: the system prompt, the
 * per-pass instructions, and the chat template's own control tokens. Subtracted from the input
 * ceiling to get the budget the evidence pack itself has to fit inside.
 */
export const LOCAL_PROMPT_OVERHEAD_TOKENS = 350;

export const LOCAL_MAX_EVIDENCE_TOKENS = LOCAL_MAX_INPUT_TOKENS - LOCAL_PROMPT_OVERHEAD_TOKENS;

/**
 * Retries a pass up to maxAttempts times — a fresh sample often succeeds where a prior one didn't.
 *
 * A lost GPU device is handled separately: once it happens the loaded model is permanently broken,
 * so re-running the same prompt against it can only fail identically. The model is reloaded once
 * onto a fresh device — plausible now that the forensics task models have been released — and the
 * attempt is retaken without counting against the sampling budget. If the device is lost a second
 * time, the error propagates rather than looping; there is no CPU fallback for these weights.
 */
export async function runLocalPassWithRetry<T>(
  localModel: LocalModelService,
  pass: string,
  prompt: LocalPassPrompt,
  genOpts: { temperature: number; maxOutputTokens: number; maxInputTokens?: number },
  validate: (text: string) => T | null,
  maxAttempts = 3,
): Promise<T | null> {
  let recovered = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let text: string;
    try {
      text = await localModel.runPass(pass, prompt.systemPrompt, prompt.userPrompt, genOpts);
    } catch (err) {
      const kind = (err as Partial<LocalModelError>)?.kind;
      if (kind === 'local-device-lost' && !recovered) {
        recovered = true;
        await localModel.reloadAfterDeviceLoss();
        attempt--; // the device failure wasn't a bad sample; don't spend an attempt on it
        continue;
      }
      throw err;
    }

    const result = validate(text);
    if (result) return result;
  }
  return null;
}
