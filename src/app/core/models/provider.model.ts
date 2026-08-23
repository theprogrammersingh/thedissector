export type ProviderId = 'anthropic' | 'gemini' | 'openai' | 'grok' | 'deepseek' | 'local';

export interface ProviderModelOption {
  id: string;
  label: string;
  contextWindowTokens: number;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  models: ProviderModelOption[];
}

export interface AnalysisSettings {
  providerId: ProviderId | null;
  modelId: string | null;
  apiKey: string;
  temperature: number;
  maxOutputTokens: number;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  providerId: null,
  modelId: null,
  apiKey: '',
  temperature: 0.8,
  maxOutputTokens: 8192,
};
