import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from './claude-provider';
import { GeminiProvider } from './gemini-provider';
import { OpenAiProvider } from './openai-provider';
import { GrokProvider } from './grok-provider';
import { DeepSeekProvider } from './deepseek-provider';
import { LlmProvider } from './llm-provider';
import { AnalyzeRequest } from './provider.types';

/**
 * These five adapters had no coverage at all, which is how `await res.json()` sat outside the
 * try block in every one of them: a response body that failed to parse became an unhandled
 * rejection, and because `analyze()` is called as `void runAnalysis()`, the UI simply span
 * forever with no error and no way back.
 */

const ANALYSIS = {
  groupAudit: { title: 'T', summary: 'S', verdictQuote: 'Q' },
  dossiers: [
    {
      participantId: 'alice',
      displayName: 'Alice',
      archetype: 'The Lurker',
      verdictQuote: 'Q',
      behavioralSummary: 'S',
      strengths: ['x'],
      redFlags: ['y'],
    },
  ],
  superlatives: [{ title: 'Most Absent', participantId: 'alice', blurb: 'B' }],
};

function request(): AnalyzeRequest {
  return {
    systemPrompt: 'sys',
    transcript: '[2024-05-01 09:00] Alice: hi',
    modelId: 'test-model',
    temperature: 0.7,
    maxOutputTokens: 512,
    knownParticipants: [{ id: 'alice', displayName: 'Alice' }],
  };
}

/** Each provider paired with a body that its own extraction path accepts. */
const PROVIDERS: { name: string; make: () => LlmProvider; okBody: unknown }[] = [
  {
    name: 'OpenAI',
    make: () => new OpenAiProvider(),
    okBody: { choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] },
  },
  {
    name: 'Grok',
    make: () => new GrokProvider(),
    okBody: { choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] },
  },
  {
    name: 'DeepSeek',
    make: () => new DeepSeekProvider(),
    okBody: { choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] },
  },
  {
    name: 'Claude',
    make: () => new ClaudeProvider(),
    okBody: { content: [{ type: 'tool_use', name: 'submit_dissection_report', input: ANALYSIS }] },
  },
  {
    name: 'Gemini',
    make: () => new GeminiProvider(),
    okBody: { candidates: [{ content: { parts: [{ text: JSON.stringify(ANALYSIS) }] } }] },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A 200 whose body is not JSON — a proxy interstitial, or a connection cut mid-body. */
function truncatedResponse(): Response {
  return new Response('{"choices": [{"mess', { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('cloud provider adapters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const { name, make, okBody } of PROVIDERS) {
    describe(name, () => {
      it('returns a parsed analysis on success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(okBody)));

        const outcome = await make().analyze('key', request());

        expect(outcome.ok).toBe(true);
        if (outcome.ok) {
          expect(outcome.value.analysis.groupAudit.title).toBe('T');
          expect(outcome.value.analysis.dossiers).toHaveLength(1);
        }
      });

      it('reports an unparseable body as an error instead of rejecting', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(truncatedResponse()));

        // The assertion that matters: this resolves. It used to reject, unhandled.
        const outcome = await make().analyze('key', request());

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.error.kind).toBe('unknown');
          expect(outcome.error.message).toContain('could not be read');
        }
      });

      it('maps a 401 to an invalid-key error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 401)));

        const outcome = await make().analyze('bad-key', request());

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.error.kind).toBe('invalid-key');
      });

      it('maps a 429 to a rate-limit error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'slow down' }, 429)));

        const outcome = await make().analyze('key', request());

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.error.kind).toBe('rate-limit');
      });

      it('survives an error body that cannot be read', async () => {
        const unreadable = new Response(null, { status: 500 });
        vi.spyOn(unreadable, 'text').mockRejectedValue(new Error('stream closed'));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unreadable));

        const outcome = await make().analyze('key', request());

        expect(outcome.ok).toBe(false);
      });

      it('reports a network failure rather than throwing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

        const outcome = await make().analyze('key', request());

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(['network', 'cors-blocked']).toContain(outcome.error.kind);
      });

      it('reports an unusable but well-formed body as a parse failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })));

        const outcome = await make().analyze('key', request());

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.error.kind).toBe('unknown');
      });

      it('sends the key and the chosen model', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okBody));
        vi.stubGlobal('fetch', fetchMock);

        await make().analyze('secret-key', { ...request(), modelId: 'chosen-model' });

        const [url, init] = fetchMock.mock.calls[0];
        const serialized = `${url} ${JSON.stringify(init.headers ?? {})} ${init.body}`;
        expect(serialized).toContain('secret-key');
        expect(serialized).toContain('chosen-model');
      });

      it('surfaces a failed connection test as an error, not a rejection', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 401)));

        const outcome = await make().testConnection('bad-key', 'test-model');

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.error.kind).toBe('invalid-key');
      });
    });
  }

  describe('refusals are a handled outcome, not a crash', () => {
    it('flags an OpenAI content filter as content-refused', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ choices: [{ finish_reason: 'content_filter', message: {} }] })),
      );

      const outcome = await new OpenAiProvider().analyze('key', request());

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.kind).toBe('content-refused');
    });

    it('flags a Claude refusal stop reason as content-refused', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ stop_reason: 'refusal', content: [] })));

      const outcome = await new ClaudeProvider().analyze('key', request());

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.kind).toBe('content-refused');
    });
  });
});
