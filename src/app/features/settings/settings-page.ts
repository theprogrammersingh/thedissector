import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { LocalLimitsService } from '../../core/local-llm/local-limits.service';
import { SessionStore } from '../../core/state/session.store';
import { ProviderRegistry } from '../../core/providers/provider-registry';
import { ProviderId } from '../../core/models/provider.model';
import { AppButton } from '../../shared/ui/app-button/app-button';
import { MaskedInput } from '../../shared/ui/masked-input/masked-input';
import { LocalModelPicker } from './local-model-picker/local-model-picker';

type TestStatus = 'idle' | 'testing' | 'success' | 'failure';

@Component({
  selector: 'app-settings-page',
  imports: [AppButton, MaskedInput, LocalModelPicker, DecimalPipe],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly store = inject(SessionStore);
  private readonly registry = inject(ProviderRegistry);
  private readonly router = inject(Router);

  protected readonly providers = this.registry.list();
  protected readonly settings = this.store.settings;
  protected readonly hasSettings = this.store.hasSettings;

  protected readonly selectedProvider = computed(
    () => this.providers.find((p) => p.id === this.settings().providerId) ?? null,
  );
  protected readonly availableModels = computed(() => this.selectedProvider()?.models ?? []);

  protected readonly testStatus = signal<TestStatus>('idle');
  protected readonly testError = signal<string | null>(null);

  private readonly limits = inject(LocalLimitsService);
  protected readonly maxMessages = this.limits.maxMessages;
  protected readonly maxInputTokens = this.limits.maxInputTokens;
  protected readonly lastMeasuredInputTokens = this.limits.lastMeasuredInputTokens;

  /**
   * Changes which messages the forensics passes read, so existing findings become wrong — but
   * only the findings. Provider, model, key and the chat itself all stay put.
   *
   * Compared before and after because `setMaxMessages` clamps: retyping the same number, or one
   * outside the allowed range, must not throw away a completed run for nothing.
   */
  onMaxMessagesChange(event: Event): void {
    const before = this.limits.maxMessages();
    this.limits.setMaxMessages(parseInt((event.target as HTMLInputElement).value, 10));
    if (this.limits.maxMessages() !== before) this.store.invalidateForensics();
  }

  /**
   * Deliberately does NOT invalidate the findings: this budget governs how much of the case file
   * is handed to the model at analysis time and has no effect on what the passes compute, so
   * re-running them would spend minutes reproducing identical numbers. What it does invalidate is
   * the report that was written under the old budget.
   */
  onMaxInputTokensChange(event: Event): void {
    const before = this.limits.maxInputTokens();
    this.limits.setMaxInputTokens(parseInt((event.target as HTMLInputElement).value, 10));
    if (this.limits.maxInputTokens() !== before) this.store.clearAnalysisResult();
  }

  selectProvider(event: Event): void {
    const providerId = (event.target as HTMLSelectElement).value as ProviderId;
    const provider = this.providers.find((p) => p.id === providerId);
    this.store.setSettings({ providerId, modelId: provider?.models[0]?.id ?? null });
    this.testStatus.set('idle');
  }

  selectModel(event: Event): void {
    this.store.setSettings({ modelId: (event.target as HTMLSelectElement).value });
    this.testStatus.set('idle');
  }

  setApiKey(value: string): void {
    this.store.setSettings({ apiKey: value });
    this.testStatus.set('idle');
  }

  onTemperatureChange(event: Event): void {
    this.store.setSettings({ temperature: parseFloat((event.target as HTMLInputElement).value) });
  }

  onMaxTokensChange(event: Event): void {
    this.store.setSettings({ maxOutputTokens: parseInt((event.target as HTMLInputElement).value, 10) });
  }

  async testConnection(): Promise<void> {
    const s = this.settings();
    if (!s.providerId || !s.modelId || !s.apiKey) return;
    this.testStatus.set('testing');
    this.testError.set(null);
    const provider = this.registry.get(s.providerId);
    try {
      const outcome = await provider.testConnection(s.apiKey, s.modelId);
      if (outcome.ok) {
        this.testStatus.set('success');
      } else {
        this.testStatus.set('failure');
        this.testError.set(outcome.error.message);
      }
    } catch (err) {
      // Without this the status stayed on 'testing' forever, and the button disables itself
      // while testing — so one unexpected throw left the control permanently dead.
      this.testStatus.set('failure');
      this.testError.set(err instanceof Error ? err.message : 'The connection test failed unexpectedly.');
    }
  }

  continue(): void {
    this.router.navigate(['/forensics']);
  }

  back(): void {
    this.router.navigate(['/participants']);
  }
}
