import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { SessionStore } from '../../core/state/session.store';
import { emptyForensicPayload } from '../../core/models/forensics.model';
import { computeLeverageMetrics } from '../../core/forensics/leverage-metrics';
import { ForensicsPassStatus, ForensicsService } from '../../core/forensics/forensics.service';
import { FORENSICS_MODELS, formatBytes } from '../../core/forensics/forensics-model-catalog';
import { getLocalModel } from '../../core/local-llm/local-model-catalog';
import { licenceForRepo } from '../../core/models/model-licence';
import { LocalModelService } from '../../core/local-llm/local-model.service';
import { LocalLimitsService } from '../../core/local-llm/local-limits.service';
import { ParsedChat } from '../../core/models/chat-message.model';
import { capRecentMessages } from '../../core/parsing/cap-messages';
import { AppButton } from '../../shared/ui/app-button/app-button';

/**
 * The on-device pre-analysis step, between settings and the consent gate.
 *
 * It sits before consent deliberately: everything it produces is appended to what gets sent,
 * so the consent screen can only be honest about the payload once these passes have run.
 */
@Component({
  selector: 'app-forensics-page',
  imports: [AppButton, DecimalPipe],
  templateUrl: './forensics-page.html',
  styleUrl: './forensics-page.scss',
})
export class ForensicsPage implements OnInit {
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly forensics = inject(ForensicsService);
  private readonly localModel = inject(LocalModelService);
  private readonly limits = inject(LocalLimitsService);

  protected readonly payload = this.store.forensicPayload;
  protected readonly running = signal(false);

  /** Inline confirmation before abandoning a pass that is still working. */
  protected readonly pendingBack = signal(false);

  protected readonly participantCount = computed(() => this.store.parsedChat()?.participants.length ?? 0);
  protected readonly totalMessageCount = computed(() => this.store.parsedChat()?.stats.messageCount ?? 0);
  /** How many messages these passes actually read — capped on the on-device path. */
  protected readonly messageCount = computed(() => this.analysisChat()?.stats.messageCount ?? 0);
  protected readonly wasCapped = computed(() => this.messageCount() < this.totalMessageCount());
  protected readonly leverageCount = computed(() => this.payload()?.leverage.length ?? 0);

  protected readonly receiptsStatus = this.forensics.receiptsStatus;
  protected readonly emotionsStatus = this.forensics.emotionsStatus;
  protected readonly progress = this.forensics.progress;
  protected readonly forensicsError = this.forensics.error;
  protected readonly receiptCount = computed(() => this.payload()?.receipts.length ?? 0);
  protected readonly emotionCount = computed(() => this.payload()?.emotionProfiles.length ?? 0);
  protected readonly peakTension = computed(() => this.payload()?.peakTensionLabel ?? null);
  protected readonly receiptsBusy = computed(
    () => this.receiptsStatus() === 'downloading' || this.receiptsStatus() === 'running',
  );
  protected readonly emotionsBusy = computed(
    () => this.emotionsStatus() === 'downloading' || this.emotionsStatus() === 'running',
  );
  /** Only one pass may run at a time — they share the worker and would contend for the GPU. */
  protected readonly anyBusy = computed(() => this.receiptsBusy() || this.emotionsBusy());
  /**
   * A download in flight genuinely cannot be stopped — the cancellation checks sit after the
   * load resolves, and the worker is never sent an abort — so the confirmation says so instead
   * of promising something the user would watch not happen.
   */
  protected readonly anyDownloading = computed(
    () => this.receiptsStatus() === 'downloading' || this.emotionsStatus() === 'downloading',
  );
  protected readonly progressPercent = computed(() => {
    const fraction = this.progress()?.fraction;
    return fraction === null || fraction === undefined ? null : Math.round(fraction * 100);
  });

  /**
   * With a local model, this page's output *is* the report's source material — no transcript
   * is sent. So the quote-bearing pass runs by default there, where the embedder's download is
   * trivial next to the generation model already on disk (647 MB–3.1 GB, depending on choice).
   */
  protected readonly isLocal = computed(() => this.store.settings().providerId === 'local');

  /**
   * Every model that runs on this device for this report, so it is clear what was downloaded
   * and what each one is actually for. The generation model only appears when the report
   * itself is being written on-device.
   */
  protected readonly onDeviceModels = computed(() => {
    const statusFor = (s: ForensicsPassStatus): string =>
      s === 'ready' ? 'Loaded' : s === 'downloading' ? 'Downloading' : s === 'running' ? 'Running' : s === 'error' ? 'Failed' : 'Not downloaded';

    const rows = [
      {
        label: FORENSICS_MODELS.embedder.label,
        repo: FORENSICS_MODELS.embedder.hfRepoId,
        size: formatBytes(FORENSICS_MODELS.embedder.downloadBytes),
        pass: FORENSICS_MODELS.embedder.poweredPass,
        role: FORENSICS_MODELS.embedder.role,
        status: statusFor(this.receiptsStatus()),
        licence: licenceForRepo(FORENSICS_MODELS.embedder.hfRepoId),
      },
      {
        label: FORENSICS_MODELS.classifier.label,
        repo: FORENSICS_MODELS.classifier.hfRepoId,
        size: formatBytes(FORENSICS_MODELS.classifier.downloadBytes),
        pass: FORENSICS_MODELS.classifier.poweredPass,
        role: FORENSICS_MODELS.classifier.role,
        status: statusFor(this.emotionsStatus()),
        licence: licenceForRepo(FORENSICS_MODELS.classifier.hfRepoId),
      },
    ];

    const key = this.localModel.selectedModelKey();
    const generation = this.isLocal() && key ? getLocalModel(key) : undefined;
    if (generation) {
      rows.unshift({
        label: generation.label,
        repo: generation.hfRepoId,
        size: formatBytes(generation.estimatedDownloadBytes),
        pass: 'Writing the report',
        role: 'Turns the findings below into the group audit, the dossiers and the awards.',
        status: this.localModel.isReady() ? 'Loaded' : 'Not downloaded',
        licence: licenceForRepo(generation.hfRepoId),
      });
    }

    return rows;
  });

  ngOnInit(): void {
    if (!this.payload()) this.runDeterministicPass();
    if (this.isLocal() && this.receiptsStatus() === 'idle') void this.runReceipts();
  }

  /**
   * The chat these passes actually work on. On-device runs are capped to the most recent N
   * messages — the model passes are the slow part of a local run — while cloud runs keep the
   * whole history, since nothing about them is bound by this device's GPU.
   */
  private analysisChat(): ParsedChat | null {
    const chat = this.store.parsedChat();
    if (!chat || !this.isLocal()) return chat;
    return capRecentMessages(chat, this.limits.maxMessages());
  }

  /** Free, instant, no download — so it just runs, with no toggle to opt into. */
  private runDeterministicPass(): void {
    const chat = this.analysisChat();
    if (!chat) return;
    this.running.set(true);
    this.store.setForensicPayload({
      ...emptyForensicPayload(),
      leverage: computeLeverageMetrics(chat),
    });
    this.running.set(false);
  }

  async runReceipts(): Promise<void> {
    const chat = this.analysisChat();
    const current = this.payload();
    if (!chat || !current) return;

    const receipts = await this.forensics.runReceipts(chat);
    // A cancelled or failed run leaves the rest of the payload untouched rather than
    // clobbering it with an empty list.
    if (this.forensics.receiptsStatus() !== 'ready') return;
    this.store.setForensicPayload({ ...this.payload()!, receipts });
  }

  async runEmotions(): Promise<void> {
    const chat = this.analysisChat();
    if (!chat || !this.payload()) return;

    const result = await this.forensics.runEmotions(chat);
    if (this.forensics.emotionsStatus() !== 'ready' || !result) return;
    this.store.setForensicPayload({
      ...this.payload()!,
      emotionProfiles: result.profiles,
      emotionTimeline: result.timeline,
      peakTensionLabel: result.peakTensionLabel,
      emotionsWereSampled: result.wasSampled,
    });
  }

  cancel(): void {
    this.forensics.cancel();
  }

  continue(): void {
    this.router.navigate(['/consent']);
  }

  back(): void {
    // Leaving mid-pass used to abandon it running: the work carried on, and its status stayed
    // 'running', which then suppressed the auto-run on the way back in.
    if (this.anyBusy()) {
      this.pendingBack.set(true);
      return;
    }
    this.router.navigate(['/settings']);
  }

  /**
   * `resetPasses()` rather than `cancel()` is what makes returning work: cancel leaves the status
   * at 'cancelled', which also fails the `=== 'idle'` auto-run guard, so the screen would come
   * back inert. This stops the work and puts the passes back to un-run.
   */
  confirmBack(): void {
    this.forensics.resetPasses();
    this.pendingBack.set(false);
    this.router.navigate(['/settings']);
  }

  cancelBack(): void {
    this.pendingBack.set(false);
  }
}
