import { ProviderErrorKind } from '../providers/provider.types';

export type LocalModelKey =
  | 'gemma-3-1b'
  | 'gemma-3-4b'
  | 'gemma-4-e2b'
  | 'qwen2.5-0.5b'
  | 'qwen3-0.6b'
  | 'qwen3-1.7b'
  | 'qwen3.5-0.8b'
  | 'qwen3.5-2b';

export type LocalModelModality = 'text' | 'text+vision' | 'text+vision+audio';

export interface LocalModelDescriptor {
  key: LocalModelKey;
  label: string;
  /** Hugging Face Hub repo id, e.g. 'onnx-community/gemma-3-1b-it-ONNX'. */
  hfRepoId: string;
  dtype: string;
  modality: LocalModelModality;
  /** Best-effort; verified against live HF file listings at plan time, but the UI must caveat it as approximate. */
  estimatedDownloadBytes: number;
  /**
   * A conservative practical figure, not the model's advertised max — a 1-4B on-device model has
   * nowhere near datacenter throughput at its theoretical window. Tune after real on-device timing.
   */
  contextWindowTokens: number;
  /**
   * One short line, shown inline in the picker list. Kept deliberately terse: a paragraph of red
   * text under every other row reads as noise and stops being read at all.
   */
  caveat?: string;
  /**
   * The reasoning behind the caveat, shown behind a "Why?" toggle in the list and inline on the
   * download-confirmation screen — the point at which the user is committing to hundreds of
   * megabytes and actually wants the detail.
   */
  caveatDetail?: string;
}

export type LocalModelStatus =
  | 'idle'
  | 'awaiting-confirmation'
  | 'clearing-cache'
  | 'downloading'
  | 'initializing'
  | 'ready'
  | 'error';

export interface LocalModelDownloadProgress {
  loadedBytes: number;
  totalBytes: number;
}

export interface LocalModelError {
  kind: ProviderErrorKind;
  message: string;
  /**
   * The untouched runtime message. `kind`/`message` are a best-effort classification of
   * onnxruntime output, so keeping the original is what makes a misclassification diagnosable
   * instead of invisible.
   */
  detail?: string;
}
