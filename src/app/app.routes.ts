import { Routes } from '@angular/router';
import { hasParsedChatGuard } from './core/guards/has-parsed-chat.guard';
import { hasSettingsGuard } from './core/guards/has-settings.guard';
import { hasConsentGuard } from './core/guards/has-consent.guard';
import { hasAnalysisResultGuard } from './core/guards/has-analysis-result.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/landing/landing-page').then((m) => m.LandingPage),
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about-page').then((m) => m.AboutPage),
  },
  {
    path: 'upload',
    loadComponent: () => import('./features/upload/upload-page').then((m) => m.UploadPage),
  },
  {
    path: 'participants',
    canActivate: [hasParsedChatGuard],
    loadComponent: () =>
      import('./features/participant-preview/participant-preview-page').then((m) => m.ParticipantPreviewPage),
  },
  {
    path: 'settings',
    canActivate: [hasParsedChatGuard],
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'forensics',
    canActivate: [hasParsedChatGuard, hasSettingsGuard],
    loadComponent: () => import('./features/forensics/forensics-page').then((m) => m.ForensicsPage),
  },
  {
    path: 'consent',
    canActivate: [hasParsedChatGuard, hasSettingsGuard],
    loadComponent: () => import('./features/consent/consent-page').then((m) => m.ConsentPage),
  },
  {
    path: 'analysis',
    canActivate: [hasParsedChatGuard, hasSettingsGuard, hasConsentGuard],
    loadComponent: () => import('./features/analysis/analysis-loading-page').then((m) => m.AnalysisLoadingPage),
  },
  {
    path: 'report',
    canActivate: [hasParsedChatGuard, hasSettingsGuard, hasConsentGuard, hasAnalysisResultGuard],
    loadComponent: () => import('./features/report/report-page').then((m) => m.ReportPage),
  },
  { path: '**', redirectTo: '' },
];
