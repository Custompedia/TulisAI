import { Node, mergeAttributes } from '@tiptap/core';

export const MAX_FOOTNOTE_CHARS = 2000;
export const footnoteText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, MAX_FOOTNOTE_CHARS) : '';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: { setFootnote: (text: string) => ReturnType; updateFootnote: (text: string) => ReturnType };
  }
}

// A real footnote: an inline marker in the text whose note travels with it. The number is drawn by a CSS
// counter, so inserting or deleting one renumbers the rest without touching the document.
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { text: { default: '', parseHTML: (element: HTMLElement) => footnoteText(element.getAttribute('data-footnote')), renderHTML: (attrs: Record<string, unknown>) => ({ 'data-footnote': footnoteText(attrs.text) }) } };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { class: 'ww-footnote', contenteditable: 'false' })];
  },
  addCommands() {
    return {
      setFootnote: (text) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { text: footnoteText(text) } }),
      updateFootnote: (text) => ({ commands }) => commands.updateAttributes(this.name, { text: footnoteText(text) }),
    };
  },
});
