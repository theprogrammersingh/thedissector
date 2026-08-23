import { Component, inject } from '@angular/core';
import { UpdateService } from '../../../core/pwa/update.service';

@Component({
  selector: 'app-update-banner',
  templateUrl: './update-banner.html',
  styleUrl: './update-banner.scss',
})
export class UpdateBanner {
  protected readonly updates = inject(UpdateService);

  refresh(): void {
    void this.updates.activateUpdate();
  }
}
