import { Extension } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

// Block-level spacing and indents as CSS lengths, so pasted Docs/Word paragraphs and DOCX imports keep their layout.
const STYLE: Record<string, string> = { lineHeight: 'line-height', spaceBefore: 'margin-top', spaceAfter: 'margin-bottom', indentLeft: 'margin-left', indentRight: 'margin-right', indentFirstLine: 'text-indent' };
const SAFE = /^-?[\d.]+(?:pt|px|em|rem|in|cm|mm|%)?$/u;
export const PARAGRAPH_FORMAT_KEYS = Object.keys(STYLE);
export const safeLength = (value: unknown): string | null => typeof value === 'string' && SAFE.test(value.trim()) ? value.trim() : null;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphFormat: (attrs: Partial<Record<'lineHeight' | 'spaceBefore' | 'spaceAfter' | 'indentLeft' | 'indentRight' | 'indentFirstLine', string | null>>) => ReturnType;
      unsetParagraphFormat: () => ReturnType;
    };
  }
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: Object.fromEntries(Object.entries(STYLE).map(([key, css]) => [key, {
        default: null,
        parseHTML: (element: HTMLElement) => safeLength(element.style.getPropertyValue(css)),
        renderHTML: (attrs: Record<string, unknown>) => { const value = safeLength(attrs[key]); return value ? { style: `${css}: ${value}` } : {}; },
      }])),
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
