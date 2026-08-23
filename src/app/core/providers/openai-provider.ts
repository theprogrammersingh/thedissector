import { ProviderId, ProviderModelOption } from '../models/provider.model';
import { LlmProvider } from './llm-provider';
import { AnalyzeOutcome, AnalyzeRequest, TestConnectionOutcome } from './provider.types';
import { errorFromResponse, networkErrorFallback, readBodyText, readJsonBody } from './http-error-mapping';
import { ANALYSIS_JSON_SCHEMA } from './analysis-json-schema';
import { extractAnalysisResult } from './extract-analysis';

const API_BASE = 'https://api.openai.com/v1';

// Update this list as OpenAI revs the model lineup — see PRD FR-2.
const MODELS: ProviderModelOption[] = [
  { id: 'gpt-5.1', label: 'GPT-5.1', contextWindowTokens: 400_000 },
  { id: 'gpt-5.1-mini', label: 'GPT-5.1 Mini', contextWindowTokens: 400_000 },
  { id: 'gpt-4.1', label: 'GPT-4.1', contextWindowTokens: 128_000 },
];

function headers(apiKey: string): HeadersInit {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

export class OpenAiProvider implements LlmProvider {
  readonly id: ProviderId = 'openai';
  readonly label = 'OpenAI (GPT)';
  readonly models = MODELS;

  async testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<TestConnectionOutcome> {
    // Hits the same chat/completions endpoint `analyze` uses. This matters here specifically:
    // GET /v1/models allows browser CORS, but POST /v1/chat/completions does not (verified
    // directly against the live API) — testing the cheaper endpoint would report false success.
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
      // Confirmed: api.openai.com does not send CORS headers on this endpoint, so a browser
      // fetch here always fails as a bare network error — report that honestly, not generically.
      return { ok: false, error: networkErrorFallback(err, true) };
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
      return { ok: false, error: networkErrorFallback(err, true) };
    }

    if (!res.ok) {
      return { ok: false, error: errorFromResponse(res.status, await readBodyText(res)) };
    }

    const parsed = await readJsonBody<any>(res, 'OpenAI');
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const data = parsed.data;
    const choice = data.choices?.[0];

    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
      return {
        ok: false,
        error: { kind: 'content-refused', message: 'OpenAI declined this request — try a different provider.', raw: data },
      };
    }

    const rawText = choice?.message?.content ?? '';
    const extracted = extractAnalysisResult(rawText, request.knownParticipants);
    if (!extracted) {
      return { ok: false, error: { kind: 'unknown', message: "Could not parse OpenAI's response into a report.", raw: data } };
    }
    return { ok: true, value: extracted };
  }
}
