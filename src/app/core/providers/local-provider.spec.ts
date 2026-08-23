import { describe, expect, it, vi } from 'vitest';
import { LocalProvider } from './local-provider';
import { AnalyzeRequest } from './provider.types';
import { LocalModelService } from '../local-llm/local-model.service';
import { LocalLimitsService } from '../local-llm/local-limits.service';

const GROUP_JSON = JSON.stringify({ groupAudit: { title: 'T', summary: 'S', verdictQuote: 'Q' } });

function dossierJson(ids: string[]) {
  return JSON.stringify({
    dossiers: ids.map((id) => ({
      participantId: id,
      displayName: id,
      archetype: 'A',
      verdictQuote: 'Q',
      behavioralSummary: 'S',
      strengths: ['x'],
      redFlags: ['y'],
    })),
  });
}

const SUPERLATIVES_JSON = JSON.stringify({ superlatives: [{ title: 'T', participantId: 'alice', blurb: 'B' }] });

function baseRequest(): AnalyzeRequest {
  return {
    systemPrompt: 'unused for local provider',
    transcript: ['[2024-05-01 09:00] Alice: hi', '[2024-05-01 09:01] Bob: hey'].join('\n'),
    modelId: 'gemma-3-1b',
    temperature: 0.7,
    maxOutputTokens: 512,
    knownParticipants: [
      { id: 'alice', displayName: 'Alice' },
      { id: 'bob', displayName: 'Bob' },
    ],
  };
}

function fakeService(runPass: ReturnType<typeof vi.fn>): LocalModelService {
  return { runPass } as unknown as LocalModelService;
}

/** Only `maxInputTokens` is read by analyze(); the value is irrelevant to these assertions. */
function fakeLimits(): LocalLimitsService {
  return { maxInputTokens: () => 2000 } as unknown as LocalLimitsService;
}

describe('LocalProvider.analyze', () => {
  it('runs group, dossier-batch, and superlatives passes and merges them into one AnalysisResult', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice', 'bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    const provider = new LocalProvider(fakeService(runPass), fakeLimits());
    const outcome = await provider.analyze('', baseRequest());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.analysis.groupAudit).toEqual({ title: 'T', summary: 'S', verdictQuote: 'Q' });
      expect(outcome.value.analysis.dossiers).toHaveLength(2);
      expect(outcome.value.analysis.dossiers.map((d) => d.participantId)).toEqual(['alice', 'bob']);
      expect(outcome.value.analysis.superlatives).toHaveLength(1);
      expect(outcome.value.usedFallbackParser).toBe(false);
    }
    expect(runPass).toHaveBeenCalledTimes(3);
    expect(runPass.mock.calls[0][0]).toBe('group');
    expect(runPass.mock.calls[1][0]).toBe('dossier');
    expect(runPass.mock.calls[2][0]).toBe('superlatives');
  });

  it('batches participants in groups of up to 2 across multiple dossier passes', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice', 'bob']))
      .mockResolvedValueOnce(dossierJson(['carol']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    const request: AnalyzeRequest = {
      ...baseRequest(),
      knownParticipants: [
        { id: 'alice', displayName: 'Alice' },
        { id: 'bob', displayName: 'Bob' },
        { id: 'carol', displayName: 'Carol' },
      ],
    };

    const provider = new LocalProvider(fakeService(runPass), fakeLimits());
    const outcome = await provider.analyze('', request);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.analysis.dossiers.map((d) => d.participantId)).toEqual(['alice', 'bob', 'carol']);
    }
    expect(runPass).toHaveBeenCalledTimes(4);
  });

  it('retries a pass up to 3 times, succeeding once a fresh sample parses', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce('still not json')
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice', 'bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    const provider = new LocalProvider(fakeService(runPass), fakeLimits());
    const outcome = await provider.analyze('', baseRequest());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.analysis.groupAudit.title).toBe('T');
    expect(runPass).toHaveBeenCalledTimes(5); // 2 failed group attempts + 1 successful, then dossier + superlatives
  });

  it('fails when the group-audit pass never parses after 3 attempts', async () => {
    const runPass = vi.fn().mockResolvedValue('not json at all');
    const provider = new LocalProvider(fakeService(runPass), fakeLimits());
    const outcome = await provider.analyze('', baseRequest());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe('local-generation-failed');
    expect(runPass).toHaveBeenCalledTimes(3);
  });

  it('fails when every dossier batch fails to parse after retries', async () => {
    const runPass = vi.fn().mockResolvedValueOnce(GROUP_JSON).mockResolvedValue('not json at all');
    const provider = new LocalProvider(fakeService(runPass), fakeLimits());
    const outcome = await provider.analyze('', baseRequest());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe('local-generation-failed');
    expect(runPass).toHaveBeenCalledTimes(4); // 1 group + 3 dossier attempts
  });

  it('still succeeds with empty superlatives if that pass never parses after retries', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice', 'bob']))
      .mockResolvedValue('not json at all');

    const provider = new LocalProvider(fakeService(runPass), fakeLimits());
    const outcome = await provider.analyze('', baseRequest());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.analysis.superlatives).toEqual([]);
    expect(runPass).toHaveBeenCalledTimes(5); // 1 group + 1 dossier + 3 superlatives attempts
  });

  it('returns a typed error if runPass throws', async () => {
    const runPass = vi.fn().mockRejectedValueOnce({ kind: 'local-download-failed', message: 'boom' });
    const provider = new LocalProvider(fakeService(runPass), fakeLimits());
    const outcome = await provider.analyze('', baseRequest());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('local-download-failed');
      // The user gets the readable summary for the kind…
      expect(outcome.error.message).toContain('Downloading the on-device model failed');
      // …and the runtime text survives, so a misclassification stays diagnosable.
      expect(outcome.error.detail).toBe('boom');
    }
  });

  it('keeps the runtime text as the message when there is no friendlier summary', async () => {
    const runPass = vi
      .fn()
      .mockRejectedValueOnce({ kind: 'local-generation-failed', message: 'Invalid rank for input' });
    const provider = new LocalProvider(fakeService(runPass), fakeLimits());

    const outcome = await provider.analyze('', baseRequest());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toBe('Invalid rank for input');
      expect(outcome.error.detail).toBe('Invalid rank for input');
    }
  });
});

describe('LocalProvider.analyze — evidence path', () => {
  const PACK = {
    group: '=== CASE FILE ===\nwhole-group findings\n=== END CASE FILE ===',
    byParticipant: {
      alice: '=== CASE FILE ===\nalice findings only\n=== END CASE FILE ===',
      bob: '=== CASE FILE ===\nbob findings only\n=== END CASE FILE ===',
    },
  };

  function evidenceRequest(): AnalyzeRequest {
    // No transcript at all — the whole point of this path.
    return { ...baseRequest(), transcript: '', evidencePack: PACK };
  }

  it('produces a full report from evidence alone, with no transcript present', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice']))
      .mockResolvedValueOnce(dossierJson(['bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    const outcome = await new LocalProvider(fakeService(runPass), fakeLimits()).analyze('', evidenceRequest());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.analysis.dossiers.map((d) => d.participantId)).toEqual(['alice', 'bob']);
    }
  });

  it('runs one dossier pass per participant rather than batching two', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice']))
      .mockResolvedValueOnce(dossierJson(['bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    await new LocalProvider(fakeService(runPass), fakeLimits()).analyze('', evidenceRequest());

    const dossierCalls = runPass.mock.calls.filter((c) => c[0] === 'dossier');
    expect(dossierCalls).toHaveLength(2);
  });

  it('gives each dossier pass only that participant\'s narrowed pack', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice']))
      .mockResolvedValueOnce(dossierJson(['bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    await new LocalProvider(fakeService(runPass), fakeLimits()).analyze('', evidenceRequest());

    const [, aliceUser] = runPass.mock.calls[1].slice(1);
    const [, bobUser] = runPass.mock.calls[2].slice(1);

    expect(aliceUser).toContain('alice findings only');
    expect(aliceUser).not.toContain('bob findings only');
    expect(bobUser).toContain('bob findings only');
    expect(bobUser).not.toContain('alice findings only');
  });

  it('feeds the whole-group pack to the group pass', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice']))
      .mockResolvedValueOnce(dossierJson(['bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    await new LocalProvider(fakeService(runPass), fakeLimits()).analyze('', evidenceRequest());

    expect(runPass.mock.calls[0][2]).toContain('whole-group findings');
  });

  it('tells the model the case file is findings, not the chat, so it cannot invent quotes', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice']))
      .mockResolvedValueOnce(dossierJson(['bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    await new LocalProvider(fakeService(runPass), fakeLimits()).analyze('', evidenceRequest());

    expect(runPass.mock.calls[0][1]).toContain('Never invent a quote');
    expect(runPass.mock.calls[1][1]).toContain('Never invent a quote');
  });

  it('never leaks a raw transcript heading onto the evidence path', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['alice']))
      .mockResolvedValueOnce(dossierJson(['bob']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    // A transcript is supplied but a pack is too — the pack must win outright, and nothing
    // may fall through to parseTranscriptLines (whose continuation branch silently glues
    // non-transcript text onto the last message).
    const request: AnalyzeRequest = { ...baseRequest(), evidencePack: PACK };
    await new LocalProvider(fakeService(runPass), fakeLimits()).analyze('', request);

    for (const call of runPass.mock.calls) {
      expect(call[2]).not.toContain('Alice: hi');
      expect(call[2]).not.toContain('Transcript:');
    }
  });

  it('falls back to the group pack when a participant has no narrowed entry', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce(GROUP_JSON)
      .mockResolvedValueOnce(dossierJson(['carol']))
      .mockResolvedValueOnce(SUPERLATIVES_JSON);

    const request: AnalyzeRequest = {
      ...baseRequest(),
      transcript: '',
      evidencePack: { group: PACK.group, byParticipant: {} },
      knownParticipants: [{ id: 'carol', displayName: 'Carol' }],
    };

    const outcome = await new LocalProvider(fakeService(runPass), fakeLimits()).analyze('', request);

    expect(outcome.ok).toBe(true);
    expect(runPass.mock.calls[1][2]).toContain('whole-group findings');
  });
});
