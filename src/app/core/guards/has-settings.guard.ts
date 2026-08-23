import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from '../state/session.store';

export const hasSettingsGuard: CanActivateFn = () => {
  const store = inject(SessionStore);
  return store.hasSettings() ? true : inject(Router).createUrlTree(['/settings']);
};
