import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppButton } from '../../shared/ui/app-button/app-button';
import { StampBadge } from '../../shared/ui/stamp-badge/stamp-badge';

@Component({
  selector: 'app-landing-page',
  imports: [AppButton, StampBadge],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.scss',
})
export class LandingPage {
  private readonly router = inject(Router);

  start(): void {
    this.router.navigate(['/upload']);
  }

  /**
   * Carries the choice as a query param rather than writing it to the store here, because
   * `setParsedChat` performs a full settings wipe on parse — a provider set before upload would
   * simply be erased. UploadPage re-applies it afterwards. It also makes the on-device entry
   * point a linkable URL.
   */
  startLocal(): void {
    this.router.navigate(['/upload'], { queryParams: { provider: 'local' } });
  }
}
