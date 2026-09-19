import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { anchorFromText, safeAnchor } from './anchors';

export const TOC_LEVELS = 3;
const INDENT_PER_LEVEL = 18;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: { insertTableOfContents: () => ReturnType; refreshTableOfContents: () => ReturnType };
  }
}

export type TocEntry = { level: number; text: string; anchor: string };

// Every heading down to level 3, with a bookmark name each, which is what Word's TOC field links to.
export function tocEntries(doc: PMNode, tr?: Transaction): TocEntry[] {
  const taken = new Set<string>();
  const entries: TocEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    const level = Number(node.attrs.level) || 1;
    const text = node.textContent.trim();
    if (level > TOC_LEVELS || !text) return false;
    let anchor = safeAnchor(node.attrs.id);
    if (!anchor || taken.has(anchor)) {
      anchor = anchorFromText(text, taken);
      if (tr) tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, id: anchor });
    } else taken.add(anchor);
    entries.push({ level, text, anchor });
    return false;
  });
  return entries;
}

function build(state: EditorState, entries: TocEntry[]): PMNode {
  const paragraph = state.schema.nodes.paragraph!;
  const children = entries.length
    ? entries.map((entry) => paragraph.create(
      { indentLeft: entry.level > 1 ? `${(entry.level - 1) * INDENT_PER_LEVEL}pt` : null, spaceAfter: '0pt' },
      state.schema.text(entry.text),
    ))
    : [paragraph.create()];
  return state.schema.nodes.tableOfContents!.create(null, children);
}

// The position of the table of contents nearest the caret, or of the only one in the document.
function existing(doc: PMNode): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => { if (node.type.name === 'tableOfContents' && !found) { found = { pos, node }; return false; } return !found; });
  return found;
}

// A generated list of headings. Exported as a real Word TOC field, so Word can refresh it with page numbers.
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'ww-toc' }), 0];
  },
  addCommands() {
    return {
      insertTableOfContents: () => ({ state, tr, dispatch }) => {
        const entries = tocEntries(state.doc, tr);
        const node = build(state, entries);
        const at = existing(tr.doc);
        if (at) tr.replaceWith(tr.mapping.map(at.pos), tr.mapping.map(at.pos + at.node.nodeSize), node);
        else tr.replaceSelectionWith(node);
        if (dispatch) dispatch(tr.scrollIntoView());
        return true;
      },
      refreshTableOfContents: () => ({ state, tr, dispatch }) => {
        const at = existing(state.doc);
        if (!at) return false;
        const entries = tocEntries(state.doc, tr);
        tr.replaceWith(tr.mapping.map(at.pos), tr.mapping.map(at.pos + at.node.nodeSize), build(state, entries));
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});
