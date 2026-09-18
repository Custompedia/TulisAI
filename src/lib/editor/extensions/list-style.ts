import { Extension } from '@tiptap/core';

// Bullet glyph per list; ordered lists already carry HTML's `type` (1, a, A, i, I) from TipTap.
export const BULLET_STYLES = ['disc', 'circle', 'square'] as const;
const valid = (value: unknown) => typeof value === 'string' && (BULLET_STYLES as readonly string[]).includes(value) ? value : null;

export const ListStyle = Extension.create({
  name: 'listStyle',
  addGlobalAttributes() {
    return [{
      types: ['bulletList'],
      attributes: { listStyle: { default: null, parseHTML: (element: HTMLElement) => valid(element.style.listStyleType), renderHTML: (attrs: Record<string, unknown>) => { const value = valid(attrs.listStyle); return value ? { style: `list-style-type: ${value}` } : {}; } } },
    }];
  },
});
