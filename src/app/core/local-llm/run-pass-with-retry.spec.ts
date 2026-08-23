import { describe, expect, it, vi } from 'vitest';
import { LocalModelService } from './local-model.service';
import { LOCAL_MAX_OUTPUT_TOKENS, runLocalPassWithRetry } from './run-pass-with-retry';

const PROMPT = { systemPrompt: 'sys', userPrompt: 'user' };
const GEN_OPTS = { temperature: 0.3, maxOutputTokens: LOCAL_MAX_OUTPUT_TOKENS };

function fakeService(
  runPass: ReturnType<typeof vi.fn>,
  reloadAfterDeviceLoss: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): LocalModelService {
  return { runPass, reloadAfterDeviceLoss } as unknown as LocalModelService;
}

/** Accepts any text that parses as JSON, so tests can drive success/failure by content. */
const validate = (text: string) => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const deviceLost = { kind: 'local-device-lost', message: 'GPU dropped the model' };

describe('runLocalPassWithRetry — sampling retries', () => {
  it('returns the first result that validates', async () => {
    const runPass = vi.fn().mockResolvedValue('{"ok":1}');

    const result = await runLocalPassWithRetry(fakeService(runPass), 'group', PROMPT, GEN_OPTS, validate);

    expect(result).toEqual({ ok: 1 });
    expect(runPass).toHaveBeenCalledTimes(1);
  });

  it('retries a bad sample up to three times', async () => {
    const runPass = vi
      .fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('still not json')
      .mockResolvedValueOnce('{"ok":1}');

    const result = await runLocalPassWithRetry(fakeService(runPass), 'group', PROMPT, GEN_OPTS, validate);

    expect(result).toEqual({ ok: 1 });
    expect(runPass).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt budget', async () => {
    const runPass = vi.fn().mockResolvedValue('not json');

    const result = await runLocalPassWithRetry(fakeService(runPass), 'group', PROMPT, GEN_OPTS, validate);

    expect(result).toBeNull();
    expect(runPass).toHaveBeenCalledTimes(3);
  });
});

describe('runLocalPassWithRetry — lost GPU device', () => {
  it('reloads the model onto a fresh device and re-runs the pass', async () => {
    const runPass = vi.fn().mockRejectedValueOnce(deviceLost).mockResolvedValueOnce('{"ok":1}');
    const reloadAfterDeviceLoss = vi.fn().mockResolvedValue(undefined);

    const result = await runLocalPassWithRetry(
      fakeService(runPass, reloadAfterDeviceLoss),
      'group',
      PROMPT,
      GEN_OPTS,
      validate,
    );

    expect(reloadAfterDeviceLoss).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: 1 });
  });

  it('does not spend a sampling attempt on the device failure', async () => {
    // Device loss, then three genuinely bad samples — the budget must still allow all three.
    const runPass = vi
      .fn()
      .mockRejectedValueOnce(deviceLost)
      .mockResolvedValueOnce('bad')
      .mockResolvedValueOnce('bad')
      .mockResolvedValueOnce('{"ok":1}');

    const result = await runLocalPassWithRetry(fakeService(runPass), 'group', PROMPT, GEN_OPTS, validate);

    expect(result).toEqual({ ok: 1 });
    expect(runPass).toHaveBeenCalledTimes(4);
  });

  it('only recovers once — a second device loss propagates instead of looping', async () => {
    // If a freshly reloaded device is lost too, the model genuinely does not fit this GPU and
    // there is no CPU fallback for q4f16 weights — retrying forever would just hang the run.
    const runPass = vi.fn().mockRejectedValue(deviceLost);
    const reloadAfterDeviceLoss = vi.fn().mockResolvedValue(undefined);

    await expect(
      runLocalPassWithRetry(fakeService(runPass, reloadAfterDeviceLoss), 'group', PROMPT, GEN_OPTS, validate),
    ).rejects.toMatchObject({ kind: 'local-device-lost' });

    expect(reloadAfterDeviceLoss).toHaveBeenCalledTimes(1);
    expect(runPass).toHaveBeenCalledTimes(2);
  });

  it('propagates an unrelated error without attempting recovery', async () => {
    const runPass = vi.fn().mockRejectedValue({ kind: 'local-generation-failed', message: 'boom' });
    const reloadAfterDeviceLoss = vi.fn();

    await expect(
      runLocalPassWithRetry(fakeService(runPass, reloadAfterDeviceLoss), 'group', PROMPT, GEN_OPTS, validate),
    ).rejects.toMatchObject({ kind: 'local-generation-failed' });

    expect(reloadAfterDeviceLoss).not.toHaveBeenCalled();
    expect(runPass).toHaveBeenCalledTimes(1);
  });
});

describe('LOCAL_MAX_OUTPUT_TOKENS', () => {
  it('bounds the worst case without truncating ordinary output', () => {
    // Measured: 1024 cut gemma-3-1b off mid-JSON (2000-char outputs) and nearly doubled the
    // retry count. Anything at or below that regresses the fix it was meant to support.
    expect(LOCAL_MAX_OUTPUT_TOKENS).toBeGreaterThan(1024);
    // Still well under the 8192 cloud default this exists to replace.
    expect(LOCAL_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(4096);
  });
});
