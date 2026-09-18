import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';

export type CellAlign = 'top' | 'middle' | 'bottom';
export const GRID_ROWS = 8;
export const GRID_COLS = 10;

// The table around the caret (or the cell selection), with its document position.
export function tableAt(editor: Editor): { node: PMNode; pos: number } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return { node, pos: $from.before(depth) };
  }
  return null;
}

export function hasHeaderRow(editor: Editor): boolean {
  const first = tableAt(editor)?.node.firstChild;
  return !!first && first.childCount > 0 && Array.from({ length: first.childCount }, (_, index) => first.child(index)).every((cell) => cell.type.name === 'tableHeader');
}

export function hasHeaderColumn(editor: Editor): boolean {
  const table = tableAt(editor)?.node;
  return !!table && table.childCount > 0 && Array.from({ length: table.childCount }, (_, index) => table.child(index).firstChild?.type.name === 'tableHeader').every(Boolean);
}

const cellAttr = (editor: Editor, name: string): unknown => editor.getAttributes('tableCell')[name] ?? editor.getAttributes('tableHeader')[name];
export const cellBackground = (editor: Editor) => (cellAttr(editor, 'background') as string | null | undefined) ?? null;
export const cellAlign = (editor: Editor): CellAlign => (cellAttr(editor, 'verticalAlign') as CellAlign | null | undefined) ?? 'top';

// Clears every stored column width, so the columns share the table width equally again.
export function distributeColumns(editor: Editor): boolean {
  const found = tableAt(editor);
  if (!found) return false;
  const { tr } = editor.state;
  found.node.descendants((node, offset) => {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') return true;
    if (node.attrs.colwidth) tr.setNodeMarkup(found.pos + 1 + offset, undefined, { ...node.attrs, colwidth: null });
    return false;
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}
