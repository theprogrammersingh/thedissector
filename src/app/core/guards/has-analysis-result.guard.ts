import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from '../state/session.store';

export const hasAnalysisResultGuard: CanActivateFn = () => {
  const store = inject(SessionStore);
  return store.hasResult() ? true : inject(Router).createUrlTree(['/analysis']);
};
