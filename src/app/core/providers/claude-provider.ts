import { ProviderId, ProviderModelOption } from '../models/provider.model';
import { LlmProvider } from './llm-provider';
import { AnalyzeOutcome, AnalyzeRequest, TestConnectionOutcome } from './provider.types';
import { errorFromResponse, networkErrorFallback, readBodyText, readJsonBody } from './http-error-mapping';
import { ANALYSIS_JSON_SCHEMA } from './analysis-json-schema';
import { extractAnalysisResult } from './extract-analysis';

const API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const TOOL_NAME = 'submit_dissection_report';

const MODELS: ProviderModelOption[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', contextWindowTokens: 200_000 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', contextWindowTokens: 200_000 },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', contextWindowTokens: 200_000 },
];

function headers(apiKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    // Anthropic blocks direct browser calls unless this is explicitly set; the key is exposed
    // client-side either way in a BYOK app, so this is the documented opt-in, not a workaround.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export class ClaudeProvider implements LlmProvider {
  readonly id: ProviderId = 'anthropic';
  readonly label = 'Anthropic (Claude)';
  readonly models = MODELS;

  async testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<TestConnectionOutcome> {
    // Hits the same endpoint `analyze` uses (not a cheaper /models list) — a browser CORS
    // block is per-endpoint, so only testing the real call path predicts whether it'll work.
    try {
      const res = await fetch(`${API_BASE}/messages`, {
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
      max_tokens: request.maxOutputTokens,
      temperature: request.temperature,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.transcript }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Submit the completed group and per-participant analysis.',
          input_schema: ANALYSIS_JSON_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    };

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/messages`, {
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

    const parsed = await readJsonBody<any>(res, 'Claude');
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const data = parsed.data;

    if (data.stop_reason === 'refusal') {
      return {
        ok: false,
        error: { kind: 'content-refused', message: 'Claude declined this request — try a different provider.', raw: data },
      };
    }

    const toolUseBlock = Array.isArray(data.content)
      ? data.content.find((block: any) => block.type === 'tool_use' && block.name === TOOL_NAME)
      : null;
    const rawText = toolUseBlock ? JSON.stringify(toolUseBlock.input) : (data.content?.[0]?.text ?? '');

    const extracted = extractAnalysisResult(rawText, request.knownParticipants);
    if (!extracted) {
      return { ok: false, error: { kind: 'unknown', message: "Could not parse Claude's response into a report.", raw: data } };
    }
    return { ok: true, value: extracted };
  }
}
