import { DatePipe } from '@angular/common';
import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionStore } from '../../core/state/session.store';
import { ProviderRegistry } from '../../core/providers/provider-registry';
import { AnalysisMetadata } from '../../core/models/report.model';
import { Receipt } from '../../core/models/forensics.model';
import { computeParticipantActivity } from '../../core/parsing/activity-stats';
import { buildDisplayNameMap } from '../../core/parsing/transcript-builder';
import { AppButton } from '../../shared/ui/app-button/app-button';
import { ActivityChart } from './components/activity-chart/activity-chart';
import { CaseFileCard } from './components/case-file-card/case-file-card';
import { DossierCard } from './components/dossier-card/dossier-card';
import { LeveragePanel } from './components/leverage-panel/leverage-panel';
import { SuperlativeBadge } from './components/superlative-badge/superlative-badge';
import { VerdictQuote } from './components/verdict-quote/verdict-quote';
import { VibePanel } from './components/vibe-panel/vibe-panel';

/** Long enough that a slow print dialog isn't cut short, short enough not to strand the button. */
const PRINT_RESTORE_FALLBACK_MS = 60_000;

@Component({
  selector: 'app-report-page',
  imports: [
    AppButton,
    ActivityChart,
    CaseFileCard,
    DossierCard,
    LeveragePanel,
    SuperlativeBadge,
    VerdictQuote,
    VibePanel,
    DatePipe,
  ],
  templateUrl: './report-page.html',
  styleUrl: './report-page.scss',
})
export class ReportPage {
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly registry = inject(ProviderRegistry);
  private readonly injector = inject(Injector);

  protected readonly result = this.store.analysisResult;
  protected readonly metadata = this.store.analysisMetadata;
  protected readonly usedFallbackParser = this.store.usedFallbackParser;

  protected readonly providerLabel = computed(() => {
    const id = this.metadata()?.providerId;
    return id ? this.registry.get(id).label : '';
  });

  protected readonly printing = signal(false);

  /**
   * Starts from the anonymization-aware map so participants the LLM never wrote a dossier for
   * (they still appear in the forensics metrics) get the right label, then overlays the names
   * the model actually used so both halves of the report agree.
   */
  protected readonly participantNameById = computed(() => {
    const chat = this.store.parsedChat();
    const map = chat ? buildDisplayNameMap(chat.participants, this.metadata()?.anonymized ?? false) : new Map();
    for (const d of this.result()?.dossiers ?? []) map.set(d.participantId, d.displayName);
    return map;
  });

  protected readonly activityEntries = computed(() => {
    const chat = this.store.parsedChat();
    return chat ? computeParticipantActivity(chat) : [];
  });

  protected readonly leverage = computed(() => this.store.forensicPayload()?.leverage ?? []);
  protected readonly emotionProfiles = computed(() => this.store.forensicPayload()?.emotionProfiles ?? []);
  protected readonly emotionTimeline = computed(() => this.store.forensicPayload()?.emotionTimeline ?? []);
  protected readonly peakTensionLabel = computed(() => this.store.forensicPayload()?.peakTensionLabel ?? null);
  protected readonly emotionsWereSampled = computed(
    () => this.store.forensicPayload()?.emotionsWereSampled ?? false,
  );

  protected readonly receiptsByParticipant = computed(() => {
    const map = new Map<string, Receipt[]>();
    for (const receipt of this.store.forensicPayload()?.receipts ?? []) {
      const list = map.get(receipt.participantId) ?? [];
      list.push(receipt);
      map.set(receipt.participantId, list);
    }
    return map;
  });

  receiptsFor(participantId: string): Receipt[] {
    return this.receiptsByParticipant().get(participantId) ?? [];
  }

  /** Passed into LeveragePanel, which only has participant IDs to work with. */
  protected readonly nameLookup = computed(() => (id: string) => this.nameFor(id));

  nameFor(participantId: string): string {
    return this.participantNameById().get(participantId) ?? participantId;
  }

  print(): void {
    const metadata = this.metadata();
    if (!metadata) return;

    const originalTitle = document.title;
    document.title = this.fileName(metadata);
    this.printing.set(true);

    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      this.printing.set(false);
      document.title = originalTitle;
    };

    window.addEventListener('afterprint', restore, { once: true });
    // Safari and iOS don't reliably fire `afterprint`. Without a fallback the Export button
    // stayed disabled on "Preparing…" for the rest of the session and the tab kept the
    // print filename as its title.
    setTimeout(restore, PRINT_RESTORE_FALLBACK_MS);

    // `printing` gates `[forceExpanded]`, which is what opens every dossier for the PDF. This app
    // is zoneless, so the signal write only schedules a render — calling window.print() in the
    // same tick would capture the cards still collapsed. Wait for the DOM to actually reflect it.
    afterNextRender(
      () => {
        window.print();
      },
      { injector: this.injector },
    );
  }

  private fileName(metadata: AnalysisMetadata): string {
    const safeName =
      metadata.chatName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'chat';
    return `the-dissector-${safeName}`;
  }

  startOver(): void {
    this.store.reset();
    this.router.navigate(['/upload']);
  }
}
