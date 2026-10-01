import { useSyncExternalStore } from 'react';
import { asMode, type Mode } from '@/lib/writing/settings';
import { isDocType } from '@/lib/writing/doc-types';

// The notebook library is listed, filtered, sorted and counted on the server (GET /api/documents, UX 2). The page
// and the context sidebar share one URL vocabulary and one counts store, so a filter link, the list it opens and
// the number beside it always agree.
export type LibraryCounts = { all: number; pinned: number; trash: number; docTypes: Record<string, number>; modes: Record<string, number> };
export const LIBRARY_SORTS = ['updated', 'title', 'created'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export type LibraryFilter = { q?: string; mode?: Mode | null; docType?: string | null; sort?: LibrarySort; pinned?: boolean; trash?: boolean };

// A notebook's mode is the AI mode last used in it, not a type, so the filter is a "last used" marker.
export const libraryMode = (value: string | null | undefined): Mode | null => asMode(value);
export const librarySort = (value: string | null | undefined): LibrarySort => (LIBRARY_SORTS as readonly string[]).includes(value ?? '') ? value as LibrarySort : 'updated';
// A kind of writing, or "none" for notebooks without one; anything else is no filter.
export const libraryDocType = (value: string | null | undefined): string | null => (value === 'none' || isDocType(value) ? value : null);

// The page URL: ?view=trash, ?pinned=1, ?type=essay, ?mode=academic and ?sort=title. The search box stays local.
export function libraryFilter(params: { get: (key: string) => string | null }): LibraryFilter {
  if (params.get('view') === 'trash') return { trash: true };
  return { mode: libraryMode(params.get('mode')), docType: libraryDocType(params.get('type')), pinned: params.get('pinned') === '1', sort: librarySort(params.get('sort')) };
}

// The API query for a filter; empty values are left out.
export function libraryQuery(filter: LibraryFilter, extra: { limit?: number; cursor?: string | null; counts?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (extra.limit) params.set('limit', String(extra.limit));
  if (extra.cursor) params.set('cursor', extra.cursor);
  if (filter.trash) params.set('trash', '1');
  else {
    if (filter.pinned) params.set('pinned', '1');
    if (filter.mode) params.set('mode', filter.mode);
    if (filter.docType) params.set('docType', filter.docType);
    if (filter.sort && filter.sort !== 'updated') params.set('sort', filter.sort);
  }
  const q = filter.q?.trim();
  if (q) params.set('q', q.slice(0, 100));
  if (extra.counts) params.set('counts', '1');
  return params.toString();
}

// ── Counts shared by the page and the sidebar ────────────────────────────────────────────────────
let counts: LibraryCounts | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function publishLibraryCounts(next: LibraryCounts | null) { counts = next; for (const listener of listeners) listener(); }
export const useLibraryCounts = () => useSyncExternalStore(subscribe, () => counts, () => null);

// Fired after anything that changes what the library holds (rename, pin, trash, restore, duplicate), so the
// sidebar refreshes its numbers from the server instead of guessing.
export const LIBRARY_CHANGED_EVENT = 'tulis:library-changed';
export function notifyLibraryChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT)); }

// A title search for the pickers (Ganti notebook, Ctrl K): at most `limit` matches, newest edit first.
export const searchQuery = (q: string, limit: number) => libraryQuery({ q }, { limit });
// How long the pickers wait after the last keystroke before asking the server.
export const PICKER_SEARCH_DELAY_MS = 250;

// Counts per mode for the MODE TERAKHIR group; legacy "custom" is already folded into Parafrase by the server.
export function modeCount(value: LibraryCounts | null, mode: Mode): number | null {
  return value ? value.modes[mode] ?? 0 : null;
}
