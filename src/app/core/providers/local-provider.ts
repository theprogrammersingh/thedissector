import { ProviderId, ProviderModelOption } from '../models/provider.model';
import { ParticipantDossier, Superlative } from '../models/report.model';
import { LOCAL_MODELS } from '../local-llm/local-model-catalog';
import {
  LOCAL_GENERATION_TEMPERATURE,
  LOCAL_MAX_OUTPUT_TOKENS,
  runLocalPassWithRetry,
} from '../local-llm/run-pass-with-retry';
import { LocalModelService } from '../local-llm/local-model.service';
import { LocalLimitsService } from '../local-llm/local-limits.service';
import {
  buildParticipantStats,
  parseTranscriptLines,
  renderLeanTranscript,
} from '../parsing/local-transcript';
import { LocalPassContext, buildGroupAuditPrompt } from '../prompts/local/group-audit-prompt';
import { buildDossierBatchPrompt } from '../prompts/local/dossier-batch-prompt';
import { buildSuperlativesPrompt } from '../prompts/local/superlatives-prompt';
import { LlmProvider } from './llm-provider';
import { MESSAGES } from './http-error-mapping';
import {
  AnalyzeOutcome,
  AnalyzeRequest,
  ProviderError,
  TestConnectionOutcome,
} from './provider.types';
import {
  mergeLocalPasses,
  validateDossierBatchPart,
  validateGroupAuditPart,
  validateSuperlativesPart,
} from './local-pass-parser';

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * The on-device provider: runs entirely client-side via LocalModelService's Worker, no API key,
 * no network calls beyond the one-time model download. `analyze()` fully encapsulates a 3-pass
 * map-reduce (group audit → per-participant dossier batches → superlatives) internally, since
 * LlmProvider is a single-call-in/single-result-out interface with no room for the orchestrator
 * to see intermediate passes.
 *
 * Two input paths:
 *
 *  - **Evidence** (`request.evidencePack` present) — the normal route. On-device findings
 *    covering 100% of the chat, narrowed per dossier batch so an 8-person group still fits.
 *  - **Transcript** (no pack) — the fallback for when no forensics payload exists. Raw chat
 *    text that `buildTrimmedTranscript` has already cut to a recent tail to fit 8K.
 *
 * The 3-pass structure is about output reliability, not input size: a 1-4B model loses the
 * JSON shape when asked for everything at once. It stays on both paths.
 */
export class LocalProvider implements LlmProvider {
  readonly id: ProviderId = 'local';
  readonly label = 'On-device (offline)';
  readonly models: ProviderModelOption[] = LOCAL_MODELS.map((m) => ({
    id: m.key,
    label: m.label,
    contextWindowTokens: m.contextWindowTokens,
  }));

  constructor(
    private readonly localModel: LocalModelService,
    private readonly limits: LocalLimitsService,
  ) {}

  async testConnection(_apiKey: string, modelId: string): Promise<TestConnectionOutcome> {
    if (this.localModel.isReady() && this.localModel.selectedModelKey() === modelId) {
      return { ok: true };
    }
    return {
      ok: false,
      error: { kind: 'unknown', message: 'Download and load a local model first.' },
    };
  }

  async analyze(_apiKey: string, request: AnalyzeRequest): Promise<AnalyzeOutcome> {
    try {
      const pack = request.evidencePack;

      // On the evidence path nothing parses the transcript at all — which is what keeps a
      // non-transcript block from being swallowed as message continuations by
      // `parseTranscriptLines`.
      let statsBlock = '';
      let leanTranscript = '';
      if (!pack) {
        const lines = parseTranscriptLines(request.transcript);
        statsBlock = buildParticipantStats(lines, request.knownParticipants);
        leanTranscript = renderLeanTranscript(lines);
      }

      const groupContext: LocalPassContext = pack
        ? { evidencePack: pack.group }
        : { statsBlock, leanTranscript };

      // `request.maxOutputTokens` is the cloud-tuned default (8192) and is deliberately ignored
      // here — see LOCAL_MAX_OUTPUT_TOKENS for why an 8K budget per pass is actively harmful
      // on a GPU that is already holding the model.
      const genOpts = {
        temperature: LOCAL_GENERATION_TEMPERATURE,
        maxOutputTokens: LOCAL_MAX_OUTPUT_TOKENS,
        // From the device-scoped limit, not the module default — the user can raise it.
        maxInputTokens: this.limits.maxInputTokens(),
      };
      const groupAudit = await runLocalPassWithRetry(
        this.localModel,
        'group',
        buildGroupAuditPrompt(groupContext),
        genOpts,
        validateGroupAuditPart,
      );
      if (!groupAudit) {
        return {
          ok: false,
          error: {
            kind: 'local-generation-failed',
            message: "The on-device model's group summary couldn't be parsed.",
          },
        };
      }

      // One participant per pass on the evidence path: each pack is already narrow, so there
      // is nothing to amortize by batching, and single-person passes parsed more reliably than
      // two-person ones in earlier testing. The transcript path keeps batches of 2, where
      // re-sending the whole transcript per pass is the dominant cost.
      const batches = pack
        ? request.knownParticipants.map((p) => [p])
        : chunk(request.knownParticipants, 2);

      const dossiers: ParticipantDossier[] = [];
      for (const batch of batches) {
        const batchIds = batch.map((p) => p.id);
        const context: LocalPassContext = pack
          ? { evidencePack: pack.byParticipant[batchIds[0]] ?? pack.group }
          : { statsBlock, leanTranscript };
        const parsed = await runLocalPassWithRetry(
          this.localModel,
          'dossier',
          buildDossierBatchPrompt(batch, context),
          genOpts,
          (text) => validateDossierBatchPart(text, batchIds),
        );
        if (parsed) dossiers.push(...parsed);
      }
      if (dossiers.length === 0) {
        return {
          ok: false,
          error: {
            kind: 'local-generation-failed',
            message: "The on-device model couldn't produce any usable participant dossiers.",
          },
        };
      }

      const dossierIds = dossiers.map((d) => d.participantId);
      const superlatives =
        (await runLocalPassWithRetry(
          this.localModel,
          'superlatives',
          buildSuperlativesPrompt(
            pack ? 'These dossiers were written from an on-device case file of the chat.' : `Message counts per participant:\n${statsBlock}`,
            dossiers,
          ),
          genOpts,
          (text) => validateSuperlativesPart(text, dossierIds),
        )) ?? [];

      const analysis = mergeLocalPasses(groupAudit, dossiers, superlatives);
      return { ok: true, value: { analysis, usedFallbackParser: false } };
    } catch (err) {
      const localError = err as Partial<ProviderError>;
      const kind = localError.kind ?? 'local-generation-failed';
      return {
        ok: false,
        error: {
          kind,
          // A friendly summary replaces the runtime text for known kinds; keep the original so
          // the user can still see what actually failed.
          message: (kind !== 'local-generation-failed' && MESSAGES[kind]) || localError.message ||
            'The on-device model failed unexpectedly.',
          detail: localError.detail ?? localError.message,
        },
      };
    }
  }
}
