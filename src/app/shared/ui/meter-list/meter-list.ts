import { Component, computed, input } from '@angular/core';

export interface MeterEntry {
  key: string;
  label: string;
  /** Raw magnitude driving the bar length. */
  value: number;
  /** Pre-formatted value shown at the end of the row. */
  display: string;
}

/**
 * A labelled horizontal meter list — the app's one chart form for comparing magnitudes.
 *
 * The design system allows exactly one accent color, so identity is always carried by the
 * text label and magnitude by bar length; nothing here is encoded in color alone. That also
 * makes it legible in print and to colorblind readers without any extra work.
 */
@Component({
  selector: 'app-meter-list',
  templateUrl: './meter-list.html',
  styleUrl: './meter-list.scss',
})
export class MeterList {
  readonly entries = input.required<MeterEntry[]>();
  /** Fixes the bar scale (e.g. 1 for shares, 10 for scores). Omit to scale to the largest entry. */
  readonly max = input<number | null>(null);
  readonly compact = input(false);

  protected readonly scale = computed(() => {
    const explicit = this.max();
    if (explicit !== null && explicit > 0) return explicit;
    return Math.max(...this.entries().map((e) => e.value), Number.EPSILON);
  });

  protected barWidth(value: number): number {
    return Math.max(0, Math.min(100, (value / this.scale()) * 100));
  }
}
