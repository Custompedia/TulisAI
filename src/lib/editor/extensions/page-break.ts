import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> { pageBreak: { setPageBreak: () => ReturnType } }
}

const PAGE_STYLE = /page-break-(?:before|after):\s*always|break-(?:before|after):\s*page/iu;

// A hard page break, as Word's <w:br w:type="page"/>; the paged canvas starts a new sheet after it.
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }, { tag: 'hr[data-page-break]', priority: 60 }, ...['br', 'hr'].map((tag) => ({ tag, priority: 60, getAttrs: (element: HTMLElement) => PAGE_STYLE.test(element.getAttribute('style') ?? '') ? null : false }))];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'ww-page-break', style: 'break-after: page; page-break-after: always' })];
  },
  addCommands() {
    return { setPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});
