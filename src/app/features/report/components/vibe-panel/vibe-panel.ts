import { Component, computed, input } from '@angular/core';
import {
  EmotionProfile,
  EmotionTimelineBucket,
  TrackedEmotion,
} from '../../../../core/models/forensics.model';
import { TRACKED_EMOTIONS } from '../../../../core/forensics/emotion-analysis';
import { MeterEntry, MeterList } from '../../../../shared/ui/meter-list/meter-list';

interface ProfileView {
  participantId: string;
  displayName: string;
  headline: string;
  entries: MeterEntry[];
  sampledMessageCount: number;
}

interface TimelineCell {
  label: string;
  tension: number;
  /** Opacity for the single-hue ramp — magnitude, not identity. */
  intensity: number;
  tensionText: string;
  messageCount: number;
  isPeak: boolean;
  /** True once the fill is dark enough that charcoal text would drop below WCAG AA. */
  onDark: boolean;
}

/**
 * Charcoal ink stays readable up to roughly this fill opacity; past it the cell needs cream
 * text instead (crimson/cream is a verified 5.9:1 pair — see `_tokens.scss`).
 */
const DARK_FILL_THRESHOLD = 0.55;

/** Emotions the headline stat leads with, if present. */
const HEADLINE_LIMIT = 2;

@Component({
  selector: 'app-vibe-panel',
  imports: [MeterList],
  templateUrl: './vibe-panel.html',
  styleUrl: './vibe-panel.scss',
})
export class VibePanel {
  readonly profiles = input.required<EmotionProfile[]>();
  readonly timeline = input.required<EmotionTimelineBucket[]>();
  readonly peakTensionLabel = input<string | null>(null);
  readonly wasSampled = input(false);
  readonly nameFor = input.required<(participantId: string) => string>();

  protected readonly profileViews = computed<ProfileView[]>(() =>
    this.profiles().map((profile) => {
      const ranked = TRACKED_EMOTIONS.map((emotion) => ({ emotion, share: profile.shares[emotion] ?? 0 })).sort(
        (a, b) => b.share - a.share,
      );
      return {
        participantId: profile.participantId,
        displayName: this.nameFor()(profile.participantId),
        headline: ranked
          .slice(0, HEADLINE_LIMIT)
          .map((r) => `${this.pct(r.share)} ${r.emotion}`)
          .join(' · '),
        entries: ranked.map((r) => ({
          key: r.emotion,
          label: this.titleCase(r.emotion),
          value: r.share,
          display: this.pct(r.share),
        })),
        sampledMessageCount: profile.sampledMessageCount,
      };
    }),
  );

  protected readonly cells = computed<TimelineCell[]>(() => {
    const buckets = this.timeline();
    const peak = Math.max(...buckets.map((b) => b.tensionScore), Number.EPSILON);
    return buckets.map((bucket) => {
      // Floored at 0.08 so a calm month still reads as a filled cell rather than a gap.
      const intensity = Math.max(0.08, bucket.tensionScore / peak);
      return {
        label: bucket.label,
        tension: bucket.tensionScore,
        intensity,
        tensionText: this.pct(bucket.tensionScore),
        messageCount: bucket.messageCount,
        isPeak: bucket.label === this.peakTensionLabel(),
        onDark: intensity >= DARK_FILL_THRESHOLD,
      };
    });
  });

  private pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  private titleCase(emotion: TrackedEmotion): string {
    return emotion.charAt(0).toUpperCase() + emotion.slice(1);
  }
}
