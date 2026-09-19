import { Extension } from '@tiptap/core';
import { safeLength } from './paragraph-format';

// Bullet glyph per list; ordered lists already carry HTML's `type` (1, a, A, i, I) from TipTap.
export const BULLET_STYLES = ['disc', 'circle', 'square'] as const;
const valid = (value: unknown) => typeof value === 'string' && (BULLET_STYLES as readonly string[]).includes(value) ? value : null;

export const ListStyle = Extension.create({
  name: 'listStyle',
  addGlobalAttributes() {
    return [{
      types: ['bulletList', 'orderedList'],
      attributes: {
        // How far this level's text sits from the level around it; Word stores the same step per numbering level.
        indent: {
          default: null,
          parseHTML: (element: HTMLElement) => safeLength(element.style.paddingLeft),
          renderHTML: (attrs: Record<string, unknown>) => { const value = safeLength(attrs.indent); return value ? { style: `padding-left: ${value}` } : {}; },
        },
        listStyle: { default: null, parseHTML: (element: HTMLElement) => valid(element.style.listStyleType), renderHTML: (attrs: Record<string, unknown>) => { const value = valid(attrs.listStyle); return value ? { style: `list-style-type: ${value}` } : {}; } },
      },
    }];
  },
});
