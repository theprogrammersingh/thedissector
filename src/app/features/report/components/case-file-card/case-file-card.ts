import { Component, input } from '@angular/core';

export type CaseFileCardKind = 'group' | 'superlatives';

@Component({
  selector: 'app-case-file-card',
  templateUrl: './case-file-card.html',
  styleUrl: './case-file-card.scss',
})
export class CaseFileCard {
  readonly kind = input<CaseFileCardKind>('group');
  readonly title = input.required<string>();
}
