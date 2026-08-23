import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { InstallBanner } from './shared/ui/install-banner/install-banner';
import { UpdateBanner } from './shared/ui/update-banner/update-banner';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, InstallBanner, UpdateBanner],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
