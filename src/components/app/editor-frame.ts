'use client';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DocPanelPreferences } from '@/lib/navigation/doc-panel';

// What the frame hands the editor: the Dokumen panel cookie the server read (null when never set).
// A separate module so AppShell never imports AppFrame (Vite HMR would duplicate the shell context).
export const DocPanelContext = createContext<DocPanelPreferences | null>(null);
export const useInitialDocPanel = () => useContext(DocPanelContext);

// Mode fokus (Ctrl+.): the editor hides its panels, and the frame hides the rail.
let focus = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setFocusMode(next: boolean) { if (focus === next) return; focus = next; for (const listener of listeners) listener(); }
export const useFocusMode = () => useSyncExternalStore(subscribe, () => focus, () => false);
