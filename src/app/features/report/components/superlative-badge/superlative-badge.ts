import { Component, input } from '@angular/core';
import { Superlative } from '../../../../core/models/report.model';

@Component({
  selector: 'app-superlative-badge',
  templateUrl: './superlative-badge.html',
  styleUrl: './superlative-badge.scss',
})
export class SuperlativeBadge {
  readonly superlative = input.required<Superlative>();
  readonly participantName = input.required<string>();
}
