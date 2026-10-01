'use client';
import { useSyncExternalStore } from 'react';

// Settings and Admin keep their sub-pages in the URL hash. The page and the context sidebar both read it,
// so every change goes through here and both stay in step.
const HASH_EVENT = 'tulis:hash';

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener); window.addEventListener('popstate', listener); window.addEventListener(HASH_EVENT, listener);
  return () => { window.removeEventListener('hashchange', listener); window.removeEventListener('popstate', listener); window.removeEventListener(HASH_EVENT, listener); };
};

export const useHash = () => useSyncExternalStore(subscribe, () => window.location.hash, () => '');

// Replaces the hash without a history entry or a scroll jump, then tells every reader.
export function setHash(next: string) {
  const hash = next.startsWith('#') ? next : `#${next}`;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  window.dispatchEvent(new Event(HASH_EVENT));
}
