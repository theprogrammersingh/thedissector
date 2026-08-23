import { describe, expect, it } from 'vitest';
import { isContextOverflowError, isDeviceLostError } from './local-model.worker';

/**
 * Real messages, copied verbatim from failures seen in this app. The classifier decides whether
 * to tell the user "the GPU ran out of memory" and to drop a multi-gigabyte model for a reload,
 * so a false positive is both a lie and an expensive one.
 */

const REAL_DEVICE_LOSS =
  "failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: /mnt/vss/_work/1/s/onnxruntime/core/providers/webgpu/buffer_manager.cc:553 auto onnxruntime::webgpu::BufferManager::Download(WGPUBuffer, void *, size_t)::(lambda)::operator()(wgpu::MapAsyncStatus, wgpu::StringView) const status == wgpu::MapAsyncStatus::Success was false. Failed to download data from buffer: Failed to execute 'mapAsync' on 'GPUBuffer': [Invalid Buffer (unlabeled)] is invalid due to a previous error.";

const MISSING_KERNEL =
  "Can't create a session. ERROR_CODE: 9, ERROR_MESSAGE: Failed to find kernel for com.microsoft.GatherBlockQuantized(1) (node:'/model/embed_tokens/Gather_Quant' ep:'CPUExecutionProvider'). Kernel not found";

const REAL_BAD_ALLOC =
  'failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc';

describe('isDeviceLostError — genuine memory and device failures', () => {
  it('matches the reported WebGPU buffer cascade', () => {
    expect(isDeviceLostError(new Error(REAL_DEVICE_LOSS))).toBe(true);
  });

  it('matches an explicit out-of-memory message', () => {
    expect(isDeviceLostError(new Error('failed to call OrtRun(). ERROR_MESSAGE: out of memory'))).toBe(true);
  });

  it('matches an allocation failure and a lost device', () => {
    expect(isDeviceLostError(new Error('Failed to allocate buffer of size 1073741824'))).toBe(true);
    expect(isDeviceLostError(new Error('GPU device was lost: Device destroyed'))).toBe(true);
  });

  it('accepts a bare string as well as an Error', () => {
    expect(isDeviceLostError(REAL_DEVICE_LOSS)).toBe(true);
  });

  it('matches a std::bad_alloc host-allocation failure', () => {
    expect(isDeviceLostError(new Error(REAL_BAD_ALLOC))).toBe(true);
  });
});

describe('isDeviceLostError — must NOT claim OOM for unrelated failures', () => {
  it('does not match an ordinary OrtRun failure', () => {
    // onnxruntime-web wraps EVERY inference error this way. Matching on "OrtRun" reported
    // unrelated failures as "the GPU ran out of memory" for even the smallest model.
    const shapeError =
      'failed to call OrtRun(). ERROR_CODE: 2, ERROR_MESSAGE: Invalid rank for input: input_ids Got: 2 Expected: 3';

    expect(isDeviceLostError(new Error(shapeError))).toBe(false);
  });

  it('does not match a missing-kernel session failure', () => {
    expect(isDeviceLostError(new Error(MISSING_KERNEL))).toBe(false);
  });

  it('does not match a parse or network failure', () => {
    expect(isDeviceLostError(new Error('Unexpected token < in JSON at position 0'))).toBe(false);
    expect(isDeviceLostError(new Error('Failed to fetch'))).toBe(false);
  });

  it('does not match an unsupported-operator error', () => {
    const opError =
      "failed to call OrtRun(). ERROR_CODE: 9, ERROR_MESSAGE: Could not find an implementation for Trilu(14) node with name ''";

    expect(isDeviceLostError(new Error(opError))).toBe(false);
  });

  it('does not claim a device loss for an oversized-prompt overflow', () => {
    // The remedy for this one is a shorter prompt, not dropping and reloading the model — so
    // misfiling it as OOM would send the recovery path off doing something useless and slow.
    expect(isDeviceLostError(new Error(REAL_INTEGER_OVERFLOW))).toBe(false);
  });
});

/**
 * The prompt-too-long case, verbatim from a user report. Every local model produced this once
 * the evidence pack outgrew the input ceiling — see LOCAL_MAX_INPUT_TOKENS.
 */
const REAL_INTEGER_OVERFLOW =
  'failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: /mnt/vss/_work/1/s/onnxruntime/core/common/safeint.h:17 static void SafeIntExceptionHandler<onnxruntime::OnnxRuntimeException>::SafeIntOnOverflow() Integer overflow';

describe('isContextOverflowError', () => {
  it('matches the reported integer-overflow failure', () => {
    expect(isContextOverflowError(new Error(REAL_INTEGER_OVERFLOW))).toBe(true);
  });

  it('accepts a bare string as well as an Error', () => {
    expect(isContextOverflowError(REAL_INTEGER_OVERFLOW)).toBe(true);
  });

  it('does not match genuine memory or device failures', () => {
    expect(isContextOverflowError(new Error(REAL_DEVICE_LOSS))).toBe(false);
    expect(isContextOverflowError(new Error(REAL_BAD_ALLOC))).toBe(false);
  });

  it('does not match unrelated runtime failures', () => {
    expect(isContextOverflowError(new Error(MISSING_KERNEL))).toBe(false);
    expect(
      isContextOverflowError(
        new Error('failed to call OrtRun(). ERROR_CODE: 2, ERROR_MESSAGE: Invalid rank for input: input_ids'),
      ),
    ).toBe(false);
  });
});
