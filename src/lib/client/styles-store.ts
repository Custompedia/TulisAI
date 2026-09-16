'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { newKey, request } from './api';
import type { StyleInput, StylePatch, WritingStyle } from '@/lib/writing/styles';

type StylesState = { styles: WritingStyle[]; loading: boolean; error: unknown };

const EMPTY: StylesState = { styles: [], loading: true, error: null };
const listeners = new Set<() => void>();
let state: StylesState = { styles: [], loading: true, error: null };
let loaded = false;
let inFlight: Promise<void> | null = null;

const emit = (next: StylesState) => { state = next; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const setStyles = (styles: WritingStyle[]) => { loaded = true; emit({ styles, loading: false, error: null }); };

// One shared fetch of GET /api/styles; every reader sees the same list.
export function loadStyles(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (loaded && !force) return Promise.resolve();
  emit({ ...state, loading: true, error: null });
  inFlight = request<WritingStyle[]>('/api/styles')
    .then((styles) => setStyles(styles))
    .catch((error: unknown) => emit({ ...state, loading: false, error }))
    .finally(() => { inFlight = null; });
  return inFlight;
}

export async function createStyle(input: StyleInput): Promise<WritingStyle> {
  const style = await request<WritingStyle>('/api/styles', 'POST', input, newKey());
  setStyles([...state.styles, style]);
  return style;
}

export async function saveStyle(id: string, patch: StylePatch): Promise<WritingStyle> {
  const style = await request<WritingStyle>(`/api/styles/${id}`, 'PATCH', patch, newKey());
  setStyles(state.styles.map((item) => (item.id === id ? style : item)));
  return style;
}

export async function removeStyle(id: string): Promise<void> {
  await request(`/api/styles/${id}`, 'DELETE', {}, newKey());
  setStyles(state.styles.filter((item) => item.id !== id));
}

export function useWritingStyles() {
  const value = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => { void loadStyles(); }, []);
  const reload = useCallback(() => { void loadStyles(true); }, []);
  return { ...value, reload };
}
