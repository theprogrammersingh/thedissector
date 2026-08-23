import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from '../state/session.store';

export const hasConsentGuard: CanActivateFn = () => {
  const store = inject(SessionStore);
  return store.hasConsent() ? true : inject(Router).createUrlTree(['/consent']);
};
