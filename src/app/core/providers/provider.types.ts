import { AnalysisResult } from '../models/report.model';

export type ProviderErrorKind =
  | 'invalid-key'
  | 'rate-limit'
  | 'gemini-input-token-quota'
  | 'context-length'
  | 'content-refused'
  | 'cors-blocked'
  | 'network'
  | 'unknown'
  | 'webgpu-unavailable'
  | 'local-download-failed'
  | 'local-out-of-memory'
  /** WebGPU device was lost mid-generation; the model is dropped and reloaded on CPU. */
  | 'local-device-lost'
  /**
   * The prompt was too long for the on-device runtime's tensor size math — distinct from
   * `context-length`, which is about a cloud model's advertised window. See
   * LOCAL_MAX_INPUT_TOKENS for why the real on-device ceiling is far lower than 8192.
   */
  | 'local-context-overflow'
  | 'local-generation-failed';

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  /**
   * The underlying runtime message when `message` is a friendlier summary. Surfaced in the UI for
   * on-device failures: nothing leaves the browser, so the user is the only person who can see
   * what actually went wrong.
   */
  detail?: string;
  raw?: unknown;
  /** Populated only when a provider reports a hard numeric input-token limit for the failed request (currently Gemini only). */
  suggestedMaxInputTokens?: number;
}

/**
 * Pre-rendered on-device evidence, narrowed ahead of time because the provider has only the
 * rendered text and cannot re-scope it. `byParticipant` is what lets an 8-person group fit a
 * small model's context: each dossier pass carries one person's evidence, not the group's.
 */
export interface EvidencePack {
  /** Whole-group evidence, for the group-level pass. */
  group: string;
  /** Participant id → evidence for that person alone, plus a roster of everyone else. */
  byParticipant: Record<string, string>;
}

export interface AnalyzeRequest {
  systemPrompt: string;
  transcript: string;
  /**
   * On-device evidence covering the whole chat. LocalProvider uses this INSTEAD of
   * `transcript` when present; cloud adapters ignore it (the orchestrator appends the brief
   * to their transcript instead).
   */
  evidencePack?: EvidencePack;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  /** Used to cross-reference the markdown fallback parser's section headings against real participants. */
  knownParticipants: { id: string; displayName: string }[];
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  analysis: AnalysisResult;
  usedFallbackParser: boolean;
}

export type AnalyzeOutcome = { ok: true; value: AnalyzeResult } | { ok: false; error: ProviderError };

export type TestConnectionOutcome = { ok: true } | { ok: false; error: ProviderError };
