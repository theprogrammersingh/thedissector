import { Component, input, output } from '@angular/core';

export type AppButtonVariant = 'primary' | 'secondary' | 'ghost';

@Component({
  selector: 'app-button',
  templateUrl: './app-button.html',
  styleUrl: './app-button.scss',
})
export class AppButton {
  readonly variant = input<AppButtonVariant>('primary');
  readonly disabled = input(false);
  readonly type = input<'button' | 'submit'>('button');
  readonly pressed = output<void>();

  onClick(): void {
    if (!this.disabled()) this.pressed.emit();
  }
}
