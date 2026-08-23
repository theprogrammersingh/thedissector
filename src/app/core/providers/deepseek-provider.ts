import { ProviderId, ProviderModelOption } from '../models/provider.model';
import { LlmProvider } from './llm-provider';
import { AnalyzeOutcome, AnalyzeRequest, TestConnectionOutcome } from './provider.types';
import { errorFromResponse, networkErrorFallback, readBodyText, readJsonBody } from './http-error-mapping';
import { ANALYSIS_JSON_SCHEMA } from './analysis-json-schema';
import { extractAnalysisResult } from './extract-analysis';

const API_BASE = 'https://api.deepseek.com';

// Update this list as DeepSeek revs the model lineup — see PRD FR-2. Context windows below are
// from secondary sources, not DeepSeek's own docs directly — verify before relying on them.
const MODELS: ProviderModelOption[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextWindowTokens: 1_000_000 },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindowTokens: 1_000_000 },
];

function headers(apiKey: string): HeadersInit {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

export class DeepSeekProvider implements LlmProvider {
  readonly id: ProviderId = 'deepseek';
  readonly label = 'DeepSeek';
  readonly models = MODELS;

  async testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<TestConnectionOutcome> {
    // Hits the same chat/completions endpoint `analyze` uses (not a cheaper /models list) — a
    // browser CORS block is per-endpoint, so only testing the real call path predicts success.
    // Confirmed working from a browser against the live API (got a real 401 for a bad key, not
    // a bare network failure) — unlike OpenAI, which is confirmed CORS-blocked on this endpoint.
    try {
      const res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({ model: modelId, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal,
      });
      if (!res.ok) return { ok: false, error: errorFromResponse(res.status, await readBodyText(res)) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: networkErrorFallback(err, false) };
    }
  }

  async analyze(apiKey: string, request: AnalyzeRequest): Promise<AnalyzeOutcome> {
    const body = {
      model: request.modelId,
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.transcript },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'dissection_report', schema: ANALYSIS_JSON_SCHEMA },
      },
    };

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      return { ok: false, error: networkErrorFallback(err, false) };
    }

    if (!res.ok) {
      return { ok: false, error: errorFromResponse(res.status, await readBodyText(res)) };
    }

    const parsed = await readJsonBody<any>(res, 'DeepSeek');
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const data = parsed.data;
    const choice = data.choices?.[0];

    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
      return {
        ok: false,
        error: { kind: 'content-refused', message: 'DeepSeek declined this request — try a different provider.', raw: data },
      };
    }

    const rawText = choice?.message?.content ?? '';
    const extracted = extractAnalysisResult(rawText, request.knownParticipants);
    if (!extracted) {
      return {
        ok: false,
        error: { kind: 'unknown', message: "Could not parse DeepSeek's response into a report.", raw: data },
      };
    }
    return { ok: true, value: extracted };
  }
}
