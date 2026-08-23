import { Injectable, inject } from '@angular/core';
import { ProviderDescriptor, ProviderId } from '../models/provider.model';
import { LocalModelService } from '../local-llm/local-model.service';
import { LocalLimitsService } from '../local-llm/local-limits.service';
import { LlmProvider } from './llm-provider';
import { ClaudeProvider } from './claude-provider';
import { GeminiProvider } from './gemini-provider';
import { OpenAiProvider } from './openai-provider';
import { GrokProvider } from './grok-provider';
import { DeepSeekProvider } from './deepseek-provider';
import { LocalProvider } from './local-provider';

@Injectable({ providedIn: 'root' })
export class ProviderRegistry {
  private readonly providers: LlmProvider[] = [
    new ClaudeProvider(),
    new GeminiProvider(),
    new OpenAiProvider(),
    new GrokProvider(),
    new DeepSeekProvider(),
    new LocalProvider(inject(LocalModelService), inject(LocalLimitsService)),
  ];

  list(): ProviderDescriptor[] {
    return this.providers.map((p) => ({ id: p.id, label: p.label, models: p.models }));
  }

  get(id: ProviderId): LlmProvider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new Error(`Unknown provider: ${id}`);
    return provider;
  }
}
