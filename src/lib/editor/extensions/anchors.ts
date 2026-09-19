import { Extension } from '@tiptap/core';

// A bookmark name Word accepts and a URL fragment can address; Word's own TOC bookmarks look like _Toc123.
const ANCHOR = /^[A-Za-z_][\w.-]{0,38}$/u;
export const safeAnchor = (value: unknown): string | null =>
  typeof value === 'string' && ANCHOR.test(value.trim()) ? value.trim() : null;

// A stable anchor for a heading, from its text, so a table of contents can link to it and DOCX can bookmark it.
export function anchorFromText(text: string, taken: Set<string>): string {
  const base = `_${text.toLowerCase().normalize('NFKD').replace(/[^\w]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 30) || 'heading'}`;
  let name = base; let counter = 2;
  while (taken.has(name)) name = `${base}_${counter++}`.slice(0, 39);
  taken.add(name);
  return name;
}

// Headings carry an id so internal links and the table of contents keep working across save, export and import.
export const HeadingAnchor = Extension.create({
  name: 'headingAnchor',
  addGlobalAttributes() {
    return [{
      types: ['heading'],
      attributes: {
        id: {
          default: null,
          parseHTML: (element: HTMLElement) => safeAnchor(element.getAttribute('id')),
          renderHTML: (attrs: Record<string, unknown>) => { const id = safeAnchor(attrs.id); return id ? { id } : {}; },
        },
      },
    }];
  },
});
