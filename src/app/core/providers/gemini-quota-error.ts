import { ProviderError } from './provider.types';

/**
 * Gemini-specific: detects a free-tier per-minute *input token* quota failure, which is
 * distinct from (and much smaller than) the model's advertised context window — trimming
 * a transcript to fit the context window doesn't guarantee it fits this quota. Only Gemini
 * reports this exact `QuotaFailure` shape, so this stays out of the shared http-error-mapping
 * used by the other providers.
 */
export function parseGeminiInputTokenQuotaError(status: number, bodyText: string): ProviderError | null {
  if (status !== 429) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }

  const details: any[] = parsed?.error?.details ?? [];
  for (const detail of details) {
    const violations: any[] = detail?.violations ?? [];
    for (const violation of violations) {
      const quotaId: string = violation?.quotaId ?? '';
      const quotaMetric: string = violation?.quotaMetric ?? '';
      if (/input.?token/i.test(quotaId) || /input.?token/i.test(quotaMetric)) {
        const suggestedMaxInputTokens = Number(violation?.quotaValue);
        const limitText = Number.isFinite(suggestedMaxInputTokens)
          ? suggestedMaxInputTokens.toLocaleString('en-US')
          : 'the free-tier';
        return {
          kind: 'gemini-input-token-quota',
          message: `Gemini's free-tier limit is ~${limitText} input tokens/minute — this request exceeded that even after trimming. You can automatically reduce how much of the chat gets sent and retry.`,
          suggestedMaxInputTokens: Number.isFinite(suggestedMaxInputTokens) ? suggestedMaxInputTokens : undefined,
          raw: parsed,
        };
      }
    }
  }

  return null;
}
