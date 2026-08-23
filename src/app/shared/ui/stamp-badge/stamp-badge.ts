import { Component, input } from '@angular/core';

@Component({
  selector: 'app-stamp-badge',
  templateUrl: './stamp-badge.html',
  styleUrl: './stamp-badge.scss',
})
export class StampBadge {
  readonly text = input.required<string>();
}
