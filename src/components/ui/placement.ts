'use client';
import { useLayoutEffect, useState, type RefObject } from 'react';

export const VIEWPORT_GUTTER = 16;
export type Side = 'top' | 'bottom';
export type Placement = { side: Side; maxHeight: number };

// Space around an anchor, minus the viewport gutter; both sides floor at one row so a panel never collapses.
export function spaceAround(anchor: DOMRect): { above: number; below: number } {
  return { above: Math.max(48, anchor.top - VIEWPORT_GUTTER), below: Math.max(48, window.innerHeight - anchor.bottom - VIEWPORT_GUTTER) };
}

// Picks the side with room for the panel; falls back to the roomier side and caps height so the panel scrolls instead of clipping.
export function resolveSide(anchor: DOMRect, panelHeight: number, preferred: Side): Placement {
  const { above, below } = spaceAround(anchor);
  const fits = preferred === 'bottom' ? panelHeight <= below : panelHeight <= above;
  const side: Side = fits ? preferred : above > below ? 'top' : 'bottom';
  return { side, maxHeight: side === 'top' ? above : below };
}

// Absolute-positioned dropdowns: measure once opened (and on resize) and flip when the viewport would clip them.
export function useAutoSide(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, preferred: Side = 'bottom'): Placement {
  const [placement, setPlacement] = useState<Placement>({ side: preferred, maxHeight: Number.POSITIVE_INFINITY });
  useLayoutEffect(() => {
    if (!open) { setPlacement({ side: preferred, maxHeight: Number.POSITIVE_INFINITY }); return; }
    const place = () => { const box = anchor.current?.getBoundingClientRect(); const height = panel.current?.scrollHeight ?? 0; if (box) setPlacement(resolveSide(box, height + 8, preferred)); };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, preferred, anchor, panel]);
  return placement;
}
