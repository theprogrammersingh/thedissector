import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { LOCAL_MODELS } from '../../../core/local-llm/local-model-catalog';
import { LocalModelService } from '../../../core/local-llm/local-model.service';
import { SessionStore } from '../../../core/state/session.store';
import { AppButton } from '../../../shared/ui/app-button/app-button';

const FLAVOR_LINES = [
  'The Dissector will visit soon…',
  'Summoning The Dissector…',
  'Sharpening the scalpel…',
  'Reviewing the case file…',
  'Booting up the evidence room…',
];

const FLAVOR_ROTATE_MS = 2200; // matches analysis-loading-page.ts's STATUS_ROTATE_MS

function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

@Component({
  selector: 'app-local-model-picker',
  imports: [AppButton],
  templateUrl: './local-model-picker.html',
  styleUrl: './local-model-picker.scss',
})
export class LocalModelPicker implements OnInit, OnDestroy {
  protected readonly localModel = inject(LocalModelService);
  private readonly store = inject(SessionStore);

  ngOnInit(): void {
    // Cache Storage outlives the tab, so ask what is genuinely on disk rather than trusting an
    // in-memory flag that resets on every reload.
    void this.localModel.syncCachedModel();
  }

  protected readonly models = LOCAL_MODELS;
  protected readonly formatBytes = formatBytes;

  protected readonly selectedDescriptor = computed(() => {
    const key = this.localModel.selectedModelKey();
    return this.models.find((m) => m.key === key) ?? null;
  });

  protected readonly flavorIndex = signal(0);
  private flavorHandle: ReturnType<typeof setInterval> | null = null;

  protected get flavorLine(): string {
    return FLAVOR_LINES[this.flavorIndex() % FLAVOR_LINES.length];
  }

  protected get progressPercent(): number {
    const p = this.localModel.downloadProgress();
    if (!p || p.totalBytes <= 0) return 0;
    return Math.min(100, Math.round((p.loadedBytes / p.totalBytes) * 100));
  }

  private startFlavorRotation(): void {
    if (this.flavorHandle) return;
    this.flavorHandle = setInterval(() => {
      this.flavorIndex.update((i) => (i + 1) % FLAVOR_LINES.length);
    }, FLAVOR_ROTATE_MS);
  }

  private stopFlavorRotation(): void {
    if (this.flavorHandle) {
      clearInterval(this.flavorHandle);
      this.flavorHandle = null;
    }
  }

  ngOnDestroy(): void {
    this.stopFlavorRotation();
  }

  selectModel(key: (typeof LOCAL_MODELS)[number]['key']): void {
    this.localModel.selectModel(key);
    this.store.setSettings({ modelId: key });
  }

  confirmDownload(): void {
    this.startFlavorRotation();
    void this.localModel.confirmDownload().finally(() => this.stopFlavorRotation());
  }

  cancelDownload(): void {
    this.localModel.cancelDownload();
  }

  changeModel(): void {
    this.localModel.selectedModelKey.set(null);
    this.localModel.status.set('idle');
    this.store.setSettings({ modelId: null });
  }

  retry(): void {
    this.localModel.status.set(this.localModel.selectedModelKey() ? 'awaiting-confirmation' : 'idle');
  }
}
