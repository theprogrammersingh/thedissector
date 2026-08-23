import { describe, expect, it } from 'vitest';
import { parseGeminiInputTokenQuotaError } from './gemini-quota-error';

const INPUT_TOKEN_QUOTA_BODY = JSON.stringify({
  error: {
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000, model: gemini-3.7-flash\nPlease retry in 7.937594768s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.Help',
        links: [{ description: 'Learn more about Gemini API quotas', url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }],
      },
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count',
            quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier',
            quotaDimensions: { location: 'global', model: 'gemini-3.7-flash' },
            quotaValue: '250000',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' },
    ],
  },
});

describe('parseGeminiInputTokenQuotaError', () => {
  it('detects an input-token quota failure and extracts the limit', () => {
    const error = parseGeminiInputTokenQuotaError(429, INPUT_TOKEN_QUOTA_BODY);
    expect(error).not.toBeNull();
    expect(error?.kind).toBe('gemini-input-token-quota');
    expect(error?.suggestedMaxInputTokens).toBe(250000);
    expect(error?.message).toContain('250,000');
  });

  it('returns null for a 429 without a QuotaFailure input-token violation', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '15' }],
          },
        ],
      },
    });
    expect(parseGeminiInputTokenQuotaError(429, body)).toBeNull();
  });

  it('returns null for a non-429 status', () => {
    expect(parseGeminiInputTokenQuotaError(400, INPUT_TOKEN_QUOTA_BODY)).toBeNull();
  });

  it('returns null for unparseable body text', () => {
    expect(parseGeminiInputTokenQuotaError(429, 'not json')).toBeNull();
  });
});
