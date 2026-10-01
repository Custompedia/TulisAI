import { useSyncExternalStore } from 'react';
import { asMode, type Mode } from '@/lib/writing/settings';

// The notebook library as the page has loaded it, shared with the context sidebar so the "MODE TERAKHIR"
// filters can show counts. `complete` is true only once the last page is in (nextCursor null): before
// that any count would be a guess, so none is shown.
export type LibraryEntry = { id: string; mode: string | null };
type LibraryState = { entries: LibraryEntry[] | null; complete: boolean };

const EMPTY: LibraryState = { entries: null, complete: false };
let state: LibraryState = EMPTY;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function publishLibrary(entries: LibraryEntry[] | null, complete: boolean) {
  state = { entries, complete };
  for (const listener of listeners) listener();
}

export const useLibrary = () => useSyncExternalStore(subscribe, () => state, () => EMPTY);

// A notebook's mode is the AI mode last used in it, not a type, so the filter is a "last used" marker.
export const libraryMode = (value: string | null | undefined): Mode | null => asMode(value);

export function filterByMode<T extends LibraryEntry>(entries: T[], mode: Mode | null): T[] {
  return mode ? entries.filter((entry) => libraryMode(entry.mode) === mode) : entries;
}

// Counts per mode, or null while there are more pages to load. Never an estimate.
export function modeCounts(entries: LibraryEntry[] | null, complete: boolean): Record<Mode, number> | null {
  if (!entries || !complete) return null;
  const counts: Record<Mode, number> = { humanize: 0, standard: 0, academic: 0, professional: 0, creative: 0, simplify: 0 };
  for (const entry of entries) { const mode = libraryMode(entry.mode); if (mode) counts[mode] += 1; }
  return counts;
}
