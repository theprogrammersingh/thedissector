import { LocalModelDescriptor, LocalModelError } from '../models/local-model.model';

export type WorkerRequest =
  | { type: 'load'; requestId: string; model: LocalModelDescriptor }
  | {
      type: 'generate';
      requestId: string;
      pass: string;
      systemPrompt: string;
      userPrompt: string;
      temperature: number;
      maxOutputTokens: number;
      /**
       * Refuse the pass rather than let onnxruntime overflow on an oversized prompt. Checked
       * against the real tokenized length, which the upstream character-based estimate can miss.
       */
      maxInputTokens?: number;
    }
  /**
   * `repoIds` deletes only those repos' files, leaving everything else cached. Omit it to drop
   * the whole store (the explicit "clear cache" action).
   */
  | { type: 'clear-cache'; requestId: string; repoIds?: string[] }
  /** Which model repos currently have files on disk — Cache Storage outlives the tab. */
  | { type: 'list-cached'; requestId: string }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'load-progress'; requestId: string; loadedBytes: number; totalBytes: number; file?: string }
  | { type: 'load-complete'; requestId: string }
  | { type: 'load-error'; requestId: string; error: LocalModelError }
  /** `inputTokens` is the real tokenized prompt length — the number to tune the budget against. */
  | { type: 'generate-result'; requestId: string; pass: string; text: string; inputTokens: number }
  | { type: 'generate-error'; requestId: string; pass: string; error: LocalModelError }
  | { type: 'clear-cache-complete'; requestId: string }
  | { type: 'cached-models'; requestId: string; repoIds: string[] }
  | { type: 'cache-error'; requestId: string; error: LocalModelError };
