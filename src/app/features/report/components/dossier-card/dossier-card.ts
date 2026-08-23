import { DatePipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { Receipt } from '../../../../core/models/forensics.model';
import { ParticipantDossier } from '../../../../core/models/report.model';
import { RECEIPT_CATEGORY_LABELS } from '../../../../core/forensics/receipt-queries';
import { StampBadge } from '../../../../shared/ui/stamp-badge/stamp-badge';
import { VerdictQuote } from '../verdict-quote/verdict-quote';

@Component({
  selector: 'app-dossier-card',
  imports: [VerdictQuote, StampBadge, DatePipe],
  templateUrl: './dossier-card.html',
  styleUrl: './dossier-card.scss',
})
export class DossierCard {
  readonly dossier = input.required<ParticipantDossier>();
  readonly forceExpanded = input(false);
  readonly receipts = input<Receipt[]>([]);

  protected readonly expanded = signal(true);

  protected readonly exhibits = computed(() =>
    this.receipts().map((receipt, i) => ({
      id: `${receipt.timestampMs}-${i}`,
      label: `Exhibit ${String.fromCharCode(65 + i)}`,
      category: RECEIPT_CATEGORY_LABELS[receipt.category] ?? receipt.category,
      quote: receipt.quote,
      timestampMs: receipt.timestampMs,
    })),
  );

  toggle(): void {
    this.expanded.update((v) => !v);
  }
}
