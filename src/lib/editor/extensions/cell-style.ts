import { Extension } from '@tiptap/core';

const COLOR = /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/iu;
const ALIGN = new Set(['top', 'middle', 'bottom']);
export const safeColor = (value: unknown): string | null => typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : null;

// Cell shading and vertical alignment, carried over from DOCX tables and pasted HTML tables.
export const CellStyle = Extension.create({
  name: 'cellStyle',
  addGlobalAttributes() {
    return [{
      types: ['tableCell', 'tableHeader'],
      attributes: {
        background: { default: null, parseHTML: (element: HTMLElement) => safeColor(element.style.backgroundColor), renderHTML: (attrs: Record<string, unknown>) => { const value = safeColor(attrs.background); return value ? { style: `background-color: ${value}` } : {}; } },
        verticalAlign: { default: null, parseHTML: (element: HTMLElement) => ALIGN.has(element.style.verticalAlign) ? element.style.verticalAlign : null, renderHTML: (attrs: Record<string, unknown>) => typeof attrs.verticalAlign === 'string' && ALIGN.has(attrs.verticalAlign) ? { style: `vertical-align: ${attrs.verticalAlign}` } : {} },
      },
    }];
  },
});
