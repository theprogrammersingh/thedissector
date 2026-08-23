import { Component, input } from '@angular/core';

@Component({
  selector: 'app-verdict-quote',
  templateUrl: './verdict-quote.html',
  styleUrl: './verdict-quote.scss',
})
export class VerdictQuote {
  readonly quote = input.required<string>();
}
