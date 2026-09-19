import { Extension } from '@tiptap/core';
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import type { Command, EditorState, Transaction } from '@tiptap/pm/state';

// Word and Docs both move a paragraph by half an inch per press.
export const INDENT_STEP_POINTS = 36;
const INDENTABLE = ['paragraph', 'heading'];
const LENGTH = /^(-?[\d.]+)(pt|px|in|cm|mm)?$/u;
const POINTS_PER_UNIT: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 7.2 / 2.54 };

export function indentPoints(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const match = LENGTH.exec(value.trim());
  const amount = match ? Number(match[1]) * (POINTS_PER_UNIT[match[2] ?? 'px'] ?? 1) : NaN;
  return Number.isFinite(amount) ? amount : 0;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: { indentBlock: () => ReturnType; outdentBlock: () => ReturnType };
  }
}

const listItem = (state: EditorState): string | null => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'taskItem' || name === 'listItem') return name;
  }
  return null;
};

// True when the caret sits before any text in its block, which is where Word indents instead of inserting a tab.
const atBlockStart = (state: EditorState) => {
  const { $from, empty } = state.selection;
  return empty && $from.parentOffset === 0;
};

function shift(state: EditorState, tr: Transaction, direction: 1 | -1): boolean {
  const { from, to } = state.selection;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!INDENTABLE.includes(node.type.name)) return true;
    const next = Math.max(0, Math.round((indentPoints(node.attrs.indentLeft) + INDENT_STEP_POINTS * direction) * 100) / 100);
    if (next === indentPoints(node.attrs.indentLeft)) return false;
    tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, indentLeft: next > 0 ? `${next}pt` : null });
    changed = true;
    return false;
  });
  return changed;
}

// A plain ProseMirror command, so it writes to the transaction it is handed instead of dispatching its own.
// Calling another TipTap command from inside one desynchronises the chain ("applying a mismatched transaction").
export const indentCommand = (direction: 1 | -1): Command => (state, dispatch) => {
  const item = listItem(state);
  if (item) {
    const type = state.schema.nodes[item];
    return type ? (direction > 0 ? sinkListItem : liftListItem)(type)(state, dispatch) : false;
  }
  const tr = state.tr;
  const changed = shift(state, tr, direction);
  if (changed && dispatch) dispatch(tr);
  return changed;
};

// Tab moves the paragraph, or the list item, to the right — it never leaves the editor for the page behind it.
export const Indent = Extension.create({
  name: 'indent',
  addCommands() {
    return {
      // The list branch runs ProseMirror's own command against the shared transaction; calling another
      // TipTap command from in here would dispatch a second transaction and desynchronise the chain.
      indentBlock: () => ({ state, dispatch }) => indentCommand(1)(state, dispatch),
      outdentBlock: () => ({ state, dispatch }) => indentCommand(-1)(state, dispatch),
    };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // A table owns Tab for moving between cells, unless the caret is in a list inside one.
        if (this.editor.isActive('table') && !listItem(this.editor.state)) return false;
        if (listItem(this.editor.state) || atBlockStart(this.editor.state)) this.editor.commands.indentBlock();
        // Mid-paragraph, Tab is a tab character, which the ruler's stops then position.
        else this.editor.commands.insertContent('\t');
        // Always handled: a Tab that fell through would move focus out of the text and into the page furniture.
        return true;
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table') && !listItem(this.editor.state)) return false;
        this.editor.commands.outdentBlock();
        return true;
      },
    };
  },
});
