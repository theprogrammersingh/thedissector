/**
 * The two task models behind the forensics passes. Kept in one place so the worker, the
 * service and the UI all agree on repo ids, sizes and labels — the sizes below are the real
 * `onnx/model_quantized.onnx` byte counts from the Hugging Face file listings, not estimates.
 */

export type ForensicsModelKey = 'embedder' | 'classifier';

export interface ForensicsModelDescriptor {
  key: ForensicsModelKey;
  label: string;
  hfRepoId: string;
  task: 'feature-extraction' | 'text-classification';
  /** transformers.js dtype; `q8` resolves to each repo's `onnx/model_quantized.onnx`. */
  dtype: 'q8';
  downloadBytes: number;
  /** Which pass this model powers, in the user's terms. */
  poweredPass: string;
  /** One line on what it actually does, for the model-details panel. */
  role: string;
}

export const FORENSICS_MODELS: Record<ForensicsModelKey, ForensicsModelDescriptor> = {
  embedder: {
    key: 'embedder',
    label: 'all-MiniLM-L6-v2',
    hfRepoId: 'Xenova/all-MiniLM-L6-v2',
    task: 'feature-extraction',
    dtype: 'q8',
    downloadBytes: 22_972_370,
    poweredPass: 'The Receipts',
    role: 'Turns every message into a vector so the chat can be searched by meaning rather than keywords.',
  },
  classifier: {
    key: 'classifier',
    label: 'roberta-base-go_emotions',
    hfRepoId: 'SamLowe/roberta-base-go_emotions-onnx',
    task: 'text-classification',
    dtype: 'q8',
    downloadBytes: 125_397_543,
    poweredPass: 'The Vibe Timeline',
    role: 'Scores each message across 28 emotions, which become the per-person profiles and the monthly tension line.',
  },
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}
