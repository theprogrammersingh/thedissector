import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionStore } from '../../core/state/session.store';
import { ProviderRegistry } from '../../core/providers/provider-registry';
import { parseWhatsAppExport } from '../../core/parsing/whatsapp-parser';
import { AppButton } from '../../shared/ui/app-button/app-button';

/**
 * A media-free WhatsApp export is plain text — even a multi-year group chat lands in the low tens
 * of megabytes. Well past that means the user exported *with* media, or picked the wrong file, and
 * reading it would freeze the tab before the parser ever rejects it.
 */
const MAX_UPLOAD_BYTES = 50_000_000;

@Component({
  selector: 'app-upload-page',
  imports: [AppButton],
  templateUrl: './upload-page.html',
  styleUrl: './upload-page.scss',
})
export class UploadPage {
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly registry = inject(ProviderRegistry);

  protected readonly chatName = signal('');
  protected readonly rawText = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly isDragging = signal(false);

  onChatNameInput(event: Event): void {
    this.chatName.set((event.target as HTMLInputElement).value);
  }

  onRawTextInput(event: Event): void {
    this.rawText.set((event.target as HTMLTextAreaElement).value);
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.readFile(file);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.readFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(): void {
    this.isDragging.set(false);
  }

  private readFile(file: File): void {
    // The picker is constrained by `accept=".txt"`, but a drop is not — anything can land here.
    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
      this.error.set(`"${file.name}" isn't a .txt file. Export the chat from WhatsApp without media and drop that.`);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.error.set(
        `That file is ${(file.size / 1_000_000).toFixed(0)} MB. A WhatsApp export without media is rarely over ` +
          `${MAX_UPLOAD_BYTES / 1_000_000} MB — check you exported "Without Media".`,
      );
      return;
    }

    if (!this.chatName().trim()) {
      this.chatName.set(file.name.replace(/\.txt$/i, ''));
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.error.set(null);
      this.rawText.set(String(reader.result ?? ''));
    };
    // Without this a failed read left the textarea empty with no explanation at all.
    reader.onerror = () => this.error.set("Couldn't read that file — it may be unreadable or still downloading.");
    reader.readAsText(file);
  }

  submit(): void {
    const text = this.rawText().trim();
    if (!text) {
      this.error.set('Paste or drop a WhatsApp .txt export first.');
      return;
    }
    const parsed = parseWhatsAppExport(text);
    if (parsed.stats.messageCount === 0) {
      this.error.set("Couldn't find any messages in that file — make sure it's an unmodified WhatsApp chat export.");
      return;
    }
    this.error.set(null);
    this.store.setParsedChat(parsed, this.chatName().trim() || 'Untitled Chat');
    this.applyPreselectedProvider();
    this.router.navigate(['/participants']);
  }

  /**
   * Honours `?provider=` from the landing page's on-device entry point.
   *
   * Must run AFTER `setParsedChat`, which wipes settings — applying it earlier would silently
   * discard the choice. Validated against the registry rather than cast, so a hand-edited URL
   * can't put an unknown id into the store and strand the user at the analysis step.
   */
  private applyPreselectedProvider(): void {
    const requested = this.route.snapshot.queryParamMap.get('provider');
    if (!requested) return;
    const provider = this.registry.list().find((p) => p.id === requested);
    if (provider) this.store.setSettings({ providerId: provider.id, modelId: null });
  }
}
