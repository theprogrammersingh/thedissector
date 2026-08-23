import { ProviderId, ProviderModelOption } from '../models/provider.model';
import { AnalyzeOutcome, AnalyzeRequest, TestConnectionOutcome } from './provider.types';

/**
 * One interface every provider adapter implements, so the orchestrator and UI never
 * depend on a specific provider's request/response shape (model lineups shift fast).
 */
export interface LlmProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly models: ProviderModelOption[];
  testConnection(apiKey: string, modelId: string, signal?: AbortSignal): Promise<TestConnectionOutcome>;
  analyze(apiKey: string, request: AnalyzeRequest): Promise<AnalyzeOutcome>;
}
