import { Component, input, model, signal } from '@angular/core';

@Component({
  selector: 'app-masked-input',
  templateUrl: './masked-input.html',
  styleUrl: './masked-input.scss',
})
export class MaskedInput {
  readonly label = input.required<string>();
  readonly placeholder = input<string>('');
  readonly value = model<string>('');

  protected readonly revealed = signal(false);

  onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }

  toggleReveal(): void {
    this.revealed.update((v) => !v);
  }
}
