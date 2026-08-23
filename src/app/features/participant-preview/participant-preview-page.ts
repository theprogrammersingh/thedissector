import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { SessionStore } from '../../core/state/session.store';
import { LocalLimitsService } from '../../core/local-llm/local-limits.service';
import { AppButton } from '../../shared/ui/app-button/app-button';

@Component({
  selector: 'app-participant-preview-page',
  imports: [AppButton, DecimalPipe],
  templateUrl: './participant-preview-page.html',
  styleUrl: './participant-preview-page.scss',
})
export class ParticipantPreviewPage {
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);

  protected readonly chat = computed(() => this.store.parsedChat());
  protected readonly participants = computed(() => this.chat()?.participants ?? []);
  protected readonly stats = computed(() => this.chat()?.stats ?? null);

  protected readonly maxMessagesInput = signal<string>('');
  protected readonly startDateInput = signal<string>('');
  protected readonly endDateInput = signal<string>('');
  protected readonly pendingRemovalId = signal<string | null>(null);

  private readonly limits = inject(LocalLimitsService);

  /**
   * Only meaningful once an on-device model is chosen, and only worth saying when the cap
   * actually bites — a chat already under the limit loses nothing.
   */
  protected readonly localCapNotice = computed(() => {
    if (this.store.settings().providerId !== 'local') return null;
    const total = this.chat()?.stats.messageCount ?? 0;
    const limit = this.limits.maxMessages();
    return total > limit ? { total, limit } : null;
  });

  rename(participantId: string, event: Event): void {
    this.store.renameParticipant(participantId, (event.target as HTMLInputElement).value);
  }

  merge(fromId: string, event: Event): void {
    const intoId = (event.target as HTMLSelectElement).value;
    if (intoId) this.store.mergeParticipants(fromId, intoId);
  }

  requestRemove(participantId: string): void {
    this.pendingRemovalId.set(participantId);
  }

  cancelRemove(): void {
    this.pendingRemovalId.set(null);
  }

  confirmRemove(participantId: string): void {
    this.store.removeParticipant(participantId);
    this.pendingRemovalId.set(null);
  }

  onStartDateChange(event: Event): void {
    this.startDateInput.set((event.target as HTMLInputElement).value);
  }

  onEndDateChange(event: Event): void {
    this.endDateInput.set((event.target as HTMLInputElement).value);
  }

  onMaxMessagesChange(event: Event): void {
    this.maxMessagesInput.set((event.target as HTMLInputElement).value);
  }

  formatDate(ms: number | null): string {
    return ms === null ? '—' : new Date(ms).toLocaleDateString();
  }

  formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    const hours = Math.round(ms / (1000 * 60 * 60));
    return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  }

  continue(): void {
    const maxMessages = this.maxMessagesInput() ? parseInt(this.maxMessagesInput(), 10) : undefined;
    const startMs = this.startDateInput() ? new Date(this.startDateInput()).getTime() : undefined;
    const endMs = this.endDateInput() ? new Date(this.endDateInput()).getTime() : undefined;
    this.store.setTrimOptions({ startMs, endMs, maxMessages });
    this.router.navigate(['/settings']);
  }

  back(): void {
    this.router.navigate(['/upload']);
  }
}
