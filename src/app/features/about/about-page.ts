import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppButton } from '../../shared/ui/app-button/app-button';

@Component({
  selector: 'app-about-page',
  imports: [AppButton],
  templateUrl: './about-page.html',
  styleUrl: './about-page.scss',
})
export class AboutPage {
  private readonly router = inject(Router);

  start(): void {
    this.router.navigate(['/upload']);
  }
}
