'use client';
import { useCallback, useEffect, useState, type RefObject } from 'react';

export const ZOOM_LEVELS = [50, 75, 90, 100, 125, 150, 200] as const;
export type Zoom = number | 'fit';
const STORAGE_KEY = 'editor-page-zoom';
const FIT_PADDING = 32;

export const parseZoom = (value: string | null): Zoom => value === 'fit' ? 'fit' : (ZOOM_LEVELS as readonly number[]).includes(Number(value)) ? Number(value) : 100;

// Per-viewer page zoom for the paged canvas; "fit" tracks the canvas width so the sheet always fills it.
export function usePageZoom(scroller: RefObject<HTMLElement | null>, active: boolean) {
  const [zoom, setZoomState] = useState<Zoom>(100);
  const [fit, setFit] = useState(1);
  useEffect(() => { try { setZoomState(parseZoom(window.localStorage.getItem(STORAGE_KEY))); } catch { /* storage unavailable */ } }, []);
  useEffect(() => {
    const element = scroller.current;
    if (!active || zoom !== 'fit' || !element) return;
    const measure = () => {
      const page = Number.parseFloat(getComputedStyle(element).getPropertyValue('--page-width'));
      if (page > 0 && element.clientWidth > 0) setFit(Math.min(3, Math.max(0.25, (element.clientWidth - FIT_PADDING) / page)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller, active, zoom]);
  const setZoom = useCallback((value: Zoom) => {
    setZoomState(value);
    try { window.localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* storage unavailable */ }
  }, []);
  return { zoom, setZoom, scale: zoom === 'fit' ? fit : zoom / 100 };
}
