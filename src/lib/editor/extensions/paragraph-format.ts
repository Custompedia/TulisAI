import { Extension } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

// Block-level spacing and indents as CSS lengths, so pasted Docs/Word paragraphs and DOCX imports keep their layout.
const STYLE: Record<string, string> = { lineHeight: 'line-height', spaceBefore: 'margin-top', spaceAfter: 'margin-bottom', indentLeft: 'margin-left', indentRight: 'margin-right', indentFirstLine: 'text-indent' };
const SAFE = /^-?[\d.]+(?:pt|px|em|rem|in|cm|mm|%)?$/u;
export const PARAGRAPH_FORMAT_KEYS = [...Object.keys(STYLE), 'tabStops'];
// Tab stops as "36pt:left,180pt:right"; the canvas renders the default half-inch grid, Word uses the real stops.
export const TAB_ALIGNS = ['left', 'center', 'right', 'decimal'] as const;
const TAB_STOPS = /^\d+(?:\.\d+)?pt:(?:left|center|right|decimal)(?:,\d+(?:\.\d+)?pt:(?:left|center|right|decimal)){0,19}$/u;
export const safeTabStops = (value: unknown): string | null => typeof value === 'string' && TAB_STOPS.test(value.trim()) ? value.trim() : null;
export type TabStop = { position: number; align: (typeof TAB_ALIGNS)[number] };
export const parseTabStops = (value: unknown): TabStop[] => {
  const clean = safeTabStops(value);
  return clean ? clean.split(',').map((stop) => { const [at, align] = stop.split(':'); return { position: Number.parseFloat(at!), align: align as TabStop['align'] }; }) : [];
};
export const formatTabStops = (stops: TabStop[]): string | null => {
  const unique = [...new Map(stops.filter((stop) => stop.position > 0).map((stop) => [Math.round(stop.position * 2) / 2, stop])).values()]
    .sort((a, b) => a.position - b.position).slice(0, 20);
  return unique.length ? unique.map((stop) => `${Math.round(stop.position * 2) / 2}pt:${stop.align}`).join(',') : null;
};
export const safeLength = (value: unknown): string | null => typeof value === 'string' && SAFE.test(value.trim()) ? value.trim() : null;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphFormat: (attrs: Partial<Record<'lineHeight' | 'spaceBefore' | 'spaceAfter' | 'indentLeft' | 'indentRight' | 'indentFirstLine' | 'tabStops', string | null>>) => ReturnType;
      unsetParagraphFormat: () => ReturnType;
    };
  }
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        ...Object.fromEntries(Object.entries(STYLE).map(([key, css]) => [key, {
          default: null,
          parseHTML: (element: HTMLElement) => safeLength(element.style.getPropertyValue(css)),
          renderHTML: (attrs: Record<string, unknown>) => { const value = safeLength(attrs[key]); return value ? { style: `${css}: ${value}` } : {}; },
        }])),
        tabStops: {
          default: null,
          parseHTML: (element: HTMLElement) => safeTabStops(element.getAttribute('data-tab-stops')),
          renderHTML: (attrs: Record<string, unknown>) => { const value = safeTabStops(attrs.tabStops); return value ? { 'data-tab-stops': value } : {}; },
        },
      },
    }];
  },
  addCommands() {
    const apply = (attrs: Record<string, string | null>) => ({ tr, state }: { tr: Transaction; state: EditorState }) => {
      const { from, to } = state.selection; let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }); changed = true; return false;
      });
      return changed;
    };
    return {
      setParagraphFormat: (attrs) => apply(attrs as Record<string, string | null>),
      unsetParagraphFormat: () => apply(Object.fromEntries(PARAGRAPH_FORMAT_KEYS.map((key) => [key, null]))),
    };
  },
});
