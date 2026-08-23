import { Component, computed, input } from '@angular/core';
import { LeverageMetrics } from '../../../../core/models/forensics.model';
import { MeterEntry, MeterList } from '../../../../shared/ui/meter-list/meter-list';

interface LeverageRow {
  participantId: string;
  displayName: string;
  narcissismScore: string;
  selfAbsorption: string;
  hijackRate: string;
  doubleTextRate: string;
  initiationShare: string;
  responseRate: string;
  replyLatency: string;
  ghostingTendency: string;
}

@Component({
  selector: 'app-leverage-panel',
  imports: [MeterList],
  templateUrl: './leverage-panel.html',
  styleUrl: './leverage-panel.scss',
})
export class LeveragePanel {
  readonly metrics = input.required<LeverageMetrics[]>();
  readonly nameFor = input.required<(participantId: string) => string>();

  private readonly ranked = computed(() =>
    [...this.metrics()].sort((a, b) => b.narcissismScore - a.narcissismScore),
  );

  protected readonly meterEntries = computed<MeterEntry[]>(() =>
    this.ranked().map((m) => ({
      key: m.participantId,
      label: this.nameFor()(m.participantId),
      value: m.narcissismScore,
      display: `${m.narcissismScore.toFixed(1)}/10`,
    })),
  );

  protected readonly rows = computed<LeverageRow[]>(() =>
    this.ranked().map((m) => ({
      participantId: m.participantId,
      displayName: this.nameFor()(m.participantId),
      narcissismScore: `${m.narcissismScore.toFixed(1)}`,
      selfAbsorption: this.pct(m.selfAbsorptionRatio),
      hijackRate: this.pct(m.hijackRate),
      doubleTextRate: this.pct(m.doubleTextRate),
      initiationShare: this.pct(m.initiationShare),
      responseRate: this.pct(m.responseRate),
      replyLatency: this.latency(m.medianReplyLatencyMs),
      ghostingTendency: m.ghostingTendency,
    })),
  );

  /**
   * Ghosting is a bucketing of the "Answers" column, so it would be a redundant table column
   * (and the one that pushed the table past its container). It earns its place as a callout
   * naming only the people it actually applies to.
   */
  protected readonly ghosts = computed(() =>
    this.ranked()
      .filter((m) => m.ghostingTendency !== 'low')
      .map((m) => `${this.nameFor()(m.participantId)} (${m.ghostingTendency})`),
  );

  private pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  private latency(ms: number | null): string {
    if (ms === null) return '—';
    const minutes = ms / 60_000;
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    return `${(minutes / 60).toFixed(1)}h`;
  }
}
