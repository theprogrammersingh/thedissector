import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { ParticipantActivity } from '../../../../core/parsing/activity-stats';

@Component({
  selector: 'app-activity-chart',
  imports: [DecimalPipe],
  templateUrl: './activity-chart.html',
  styleUrl: './activity-chart.scss',
})
export class ActivityChart {
  readonly entries = input.required<ParticipantActivity[]>();

  protected readonly sortedEntries = computed(() =>
    [...this.entries()].sort((a, b) => b.messagesPerDay - a.messagesPerDay),
  );

  protected readonly maxValue = computed(() =>
    Math.max(1, ...this.sortedEntries().map((e) => e.messagesPerDay)),
  );

  barWidth(value: number): number {
    return (value / this.maxValue()) * 100;
  }
}
