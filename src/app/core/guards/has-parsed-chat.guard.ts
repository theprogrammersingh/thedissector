import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from '../state/session.store';

export const hasParsedChatGuard: CanActivateFn = () => {
  const store = inject(SessionStore);
  return store.hasParsedChat() ? true : inject(Router).createUrlTree(['/upload']);
};
