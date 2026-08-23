import { Signal, signal } from '@angular/core';

const QUERY = '(prefers-reduced-motion: reduce)';

/** A reactive signal that tracks the OS-level reduced-motion preference for the life of the component. */
export function prefersReducedMotion(): Signal<boolean> {
  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  const value = signal(mql?.matches ?? false);
  mql?.addEventListener('change', (event) => value.set(event.matches));
  return value.asReadonly();
}
