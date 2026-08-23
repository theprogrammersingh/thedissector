import { Component, inject, signal } from '@angular/core';
import { InstallPromptService } from '../../../core/pwa/install-prompt.service';
import { AppButton } from '../app-button/app-button';

const DISMISS_KEY = 'dissector.install-banner.dismissed';

@Component({
  selector: 'app-install-banner',
  imports: [AppButton],
  templateUrl: './install-banner.html',
  styleUrl: './install-banner.scss',
})
export class InstallBanner {
  protected readonly install = inject(InstallPromptService);
  protected readonly dismissed = signal(localStorage.getItem(DISMISS_KEY) === '1');

  dismiss(): void {
    localStorage.setItem(DISMISS_KEY, '1');
    this.dismissed.set(true);
  }

  async installNow(): Promise<void> {
    await this.install.promptInstall();
  }
}
