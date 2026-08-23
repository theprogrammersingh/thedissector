import { ProviderId, ProviderModelOption } from '../models/provider.model';
import { LlmProvider } from './llm-provider';
import { AnalyzeOutcome, AnalyzeRequest, TestConnectionOutcome } from './provider.types';
import { errorFromResponse, networkErrorFallback, readBodyText, readJsonBody } from './http-error-mapping';
import { parseGeminiInputTokenQuotaError } from './gemini-quota-error';
import { ANALYSIS_GEMINI_SCHEMA } from './analysis-json-schema';
import { extractAnalysisResult } from './extract-analysis';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Update this list as Google revs the Gemini model lineup — see PRD FR-2.
const MODELS: ProviderModelOption[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextWindowTokens: 1_000_000 },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', contextWindowTokens: 1_000_000 },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', contextWindowTokens: 1_000_000 },
  // Gemini 3.x — confirmed against ai.google.dev directly (text/JSON models only; the 3.x
  // image-generation variants are deliberately excluded, incompatible with this app's flow).
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)', contextWindowTokens: 1_000_000 },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)', contextWindowTokens: 1_000_000 },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', contextWindowTokens: 1_000_000 },
  // Seen only in secondary sources, not independently confirmed against an official page —
  // verify these model IDs still exist before relying on them.
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', contextWindowTokens: 1_000_000 },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', contextWindowTokens: 1_000_000 },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B (A4B)', contextWindowTokens: 128_000 },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B', contextWindowTokens: 128_000 },
];

export class GeminiProvider implements LlmProvider {
  readonly id: ProviderId = 'gemini';
  readonly label = 'Google (Gemini)';
  readonly models = MODELS;

  async testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<TestConnectionOutcome> {
    // Hits the same generateContent endpoint `analyze` uses (not a cheaper /models list) — a
    // browser CORS block is per-endpoint, so only testing the real call path predicts success.
    try {
      const res = await fetch(
        `${API_BASE}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
          signal,
        },
      );
      if (!res.ok) return { ok: false, error: errorFromResponse(res.status, await readBodyText(res)) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: networkErrorFallback(err, false) };
    }
  }

  async analyze(apiKey: string, request: AnalyzeRequest): Promise<AnalyzeOutcome> {
    const body = {
      system_instruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: request.transcript }] }],
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_GEMINI_SCHEMA,
      },
    };

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/models/${encodeURIComponent(request.modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      return { ok: false, error: networkErrorFallback(err, false) };
    }

    if (!res.ok) {
      const bodyText = await readBodyText(res);
      return { ok: false, error: parseGeminiInputTokenQuotaError(res.status, bodyText) ?? errorFromResponse(res.status, bodyText) };
    }

    const parsed = await readJsonBody<any>(res, 'Gemini');
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const data = parsed.data;

    if (data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason === 'SAFETY') {
      return {
        ok: false,
        error: { kind: 'content-refused', message: 'Gemini declined this request — try a different provider.', raw: data },
      };
    }

    const rawText = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
    const extracted = extractAnalysisResult(rawText, request.knownParticipants);
    if (!extracted) {
      return { ok: false, error: { kind: 'unknown', message: "Could not parse Gemini's response into a report.", raw: data } };
    }
    return { ok: true, value: extracted };
  }
}
