import { ProviderError, ProviderErrorKind } from './provider.types';

function mapStatusToErrorKind(status: number, bodyText: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'invalid-key';
  if (status === 429) return 'rate-limit';
  if (status === 400 && /context|too long|token limit|maximum context/i.test(bodyText)) return 'context-length';
  return 'unknown';
}

export const MESSAGES: Record<ProviderErrorKind, string> = {
  'invalid-key': 'This API key was rejected — double check it was copied correctly and has access to this model.',
  'rate-limit': "This provider's rate limit was hit — wait a moment and try again, or switch providers.",
  'gemini-input-token-quota':
    "Gemini's free-tier input token quota was exceeded for this request — try trimming the chat further, or switch providers.",
  'context-length': "The chat is too long for this model's context window even after trimming — try a shorter date range.",
  'content-refused': 'This provider declined the request — try a different provider.',
  'cors-blocked': "This provider blocks direct browser requests to its API — it can't be used without a backend proxy, which this app doesn't have. Try a different provider.",
  network: 'Could not reach the provider — check your connection and try again.',
  unknown: 'Unexpected error from the provider.',
  'webgpu-unavailable': "This browser doesn't support WebGPU, which the on-device model needs — try a recent version of Chrome or Edge.",
  'local-download-failed': 'Downloading the on-device model failed — check your connection and try again.',
  'local-out-of-memory': 'The on-device model ran out of memory on this device — try a smaller local model.',
  'local-device-lost':
    "The GPU ran out of memory and dropped the on-device model. Reloading it didn't help — this model is too large for this device's GPU, so try a smaller local model or a cloud provider.",
  'local-context-overflow':
    "The case file built from this chat was too large for the on-device model to read in one go — on-device models have far less usable input room than their headline context window suggests. Narrow the date range, or switch to a cloud provider for a chat this size.",
  'local-generation-failed': "The on-device model couldn't produce a usable report — try again, or switch to a different model or provider.",
};

/**
 * Reading a response body can throw as readily as the request can — a truncated payload, a
 * connection dropped mid-body, a proxy interstitial. These two helpers exist because that throw
 * used to happen OUTSIDE every adapter's try block: `analyze()` is invoked as `void
 * runAnalysis()`, so the rejection went unhandled while `analysisStatus` stayed `'running'`,
 * leaving the user on an animation that never resolved and offered no way out.
 */
export async function readBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    // The status line is the useful part here; an unreadable body just means no extra detail.
    return '';
  }
}

export async function readJsonBody<T>(
  res: Response,
  providerLabel: string,
): Promise<{ ok: true; data: T } | { ok: false; error: ProviderError }> {
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: `${providerLabel} returned a response that could not be read — it may have been cut off. Try again.`,
        raw: err,
      },
    };
  }
}

/** Maps a non-2xx HTTP response to a typed ProviderError. */
export function errorFromResponse(status: number, bodyText: string): ProviderError {
  const kind = mapStatusToErrorKind(status, bodyText);
  const suffix = kind === 'unknown' ? ` (status ${status})` : '';
  return { kind, message: MESSAGES[kind] + suffix, raw: { status, bodyText } };
}

/**
 * Maps a bare `fetch` failure (no response at all) to a typed ProviderError. `corsKnownBlocked`
 * should only be true for providers we've confirmed block direct browser requests (currently
 * OpenAI) — everywhere else this is reported as a generic network error, not a guess.
 */
export function networkErrorFallback(err: unknown, corsKnownBlocked: boolean): ProviderError {
  if (corsKnownBlocked) {
    return {
      kind: 'cors-blocked',
      message:
        "This provider blocks direct browser requests to its API (a confirmed CORS restriction) — it can't be used without a backend proxy, which this app doesn't have. Try a different provider.",
      raw: err,
    };
  }
  return {
    kind: 'network',
    message:
      'Could not reach the provider — this may be a network issue, or the provider may block direct browser requests (CORS). Try a different provider.',
    raw: err,
  };
}
