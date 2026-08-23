import { ProviderId, ProviderModelOption } from '../models/provider.model';
import { LlmProvider } from './llm-provider';
import { AnalyzeOutcome, AnalyzeRequest, TestConnectionOutcome } from './provider.types';
import { errorFromResponse, networkErrorFallback, readBodyText, readJsonBody } from './http-error-mapping';
import { ANALYSIS_JSON_SCHEMA } from './analysis-json-schema';
import { extractAnalysisResult } from './extract-analysis';

const API_BASE = 'https://api.x.ai/v1';

// Update this list as xAI revs the model lineup — see PRD FR-2.
const MODELS: ProviderModelOption[] = [
  { id: 'grok-4', label: 'Grok 4', contextWindowTokens: 256_000 },
  { id: 'grok-4-fast', label: 'Grok 4 Fast', contextWindowTokens: 2_000_000 },
  { id: 'grok-3', label: 'Grok 3', contextWindowTokens: 131_072 },
];

function headers(apiKey: string): HeadersInit {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

export class GrokProvider implements LlmProvider {
  readonly id: ProviderId = 'grok';
  readonly label = 'xAI (Grok)';
  readonly models = MODELS;

  async testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<TestConnectionOutcome> {
    // Hits the same chat/completions endpoint `analyze` uses (not a cheaper /models list) — a
    // browser CORS block is per-endpoint, so only testing the real call path predicts success.
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
      // xAI's browser-CORS support is unverified (unlike OpenAI's, which is confirmed blocked) —
      // report this as a generic network error rather than asserting a specific cause.
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

    const parsed = await readJsonBody<any>(res, 'Grok');
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const data = parsed.data;
    const choice = data.choices?.[0];

    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
      return {
        ok: false,
        error: { kind: 'content-refused', message: 'Grok declined this request — try a different provider.', raw: data },
      };
    }

    const rawText = choice?.message?.content ?? '';
    const extracted = extractAnalysisResult(rawText, request.knownParticipants);
    if (!extracted) {
      return { ok: false, error: { kind: 'unknown', message: "Could not parse Grok's response into a report.", raw: data } };
    }
    return { ok: true, value: extracted };
  }
}
