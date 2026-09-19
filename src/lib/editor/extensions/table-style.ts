import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { BORDER_SIDES, borderAttr, cssBorder, parseCssBorder, type BorderLine, type BorderSide } from '../../docx/borders';

// Which sides of which cells a border command touches; "outer" and "inner" are relative to the selected block of cells.
export const BORDER_SCOPES = ['all', 'outer', 'inner', 'top', 'right', 'bottom', 'left'] as const;
export type BorderScope = (typeof BORDER_SCOPES)[number];

export const TABLE_ALIGNS = ['left', 'center', 'right'] as const;
export type TableAlign = (typeof TABLE_ALIGNS)[number];
const asAlign = (value: unknown): TableAlign | null => (value === 'center' || value === 'right' ? value : null);
const asWidth = (value: unknown): 'auto' | null => (value === 'auto' ? 'auto' : null);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableStyle: {
      // `whole` applies to every cell of the table instead of the selected ones.
      setCellBorders: (scope: BorderScope, line: BorderLine | null, whole?: boolean) => ReturnType;
      setTableAlign: (align: TableAlign) => ReturnType;
      setTableWidth: (width: 'full' | 'auto') => ReturnType;
    };
  }
}

// A pasted cell may carry the side as longhands, as a per-side shorthand, or only through `border`.
function readSide(element: HTMLElement, side: BorderSide): string | undefined {
  const style = element.style;
  const width = style.getPropertyValue(`border-${side}-width`);
  const kind = style.getPropertyValue(`border-${side}-style`);
  const color = style.getPropertyValue(`border-${side}-color`);
  if (width || kind) return `${width} ${kind} ${color}`.trim();
  return style.getPropertyValue(`border-${side}`) || style.getPropertyValue('border') || undefined;
}

const isCell = (node: PMNode) => node.type.name === 'tableCell' || node.type.name === 'tableHeader';

type Target = { table: PMNode; start: number; map: TableMap; rect: { left: number; top: number; right: number; bottom: number } };

// The table around the selection, with the block of cells the command applies to.
export function borderTarget(state: EditorState, whole = false): Target | null {
  const { selection } = state;
  const $from = selection.$from;
  let table: PMNode | null = null; let start = 0;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'table') { table = node; start = $from.before(depth) + 1; break; }
  }
  if (!table) return null;
  const map = TableMap.get(table);
  const full = { left: 0, top: 0, right: map.width, bottom: map.height };
  if (whole) return { table, start, map, rect: full };
  if (selection instanceof CellSelection) {
    const rect = map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start);
    return { table, start, map, rect };
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    if (isCell($from.node(depth))) return { table, start, map, rect: map.findCell($from.before(depth) - start) };
  }
  return { table, start, map, rect: full };
}

// The sides of one cell that a scope covers, given where the cell sits inside the selected block.
function sidesFor(scope: BorderScope, cell: { left: number; top: number; right: number; bottom: number }, rect: Target['rect']): BorderSide[] {
  const edge = { top: cell.top === rect.top, bottom: cell.bottom === rect.bottom, left: cell.left === rect.left, right: cell.right === rect.right };
  if (scope === 'all') return [...BORDER_SIDES];
  if (scope === 'outer') return BORDER_SIDES.filter((side) => edge[side]);
  if (scope === 'inner') return BORDER_SIDES.filter((side) => !edge[side]);
  return edge[scope] ? [scope] : [];
}

// Exported for the tests, which drive it with a plain state and transaction rather than a live editor.
export function applyCellBorders(state: EditorState, tr: Transaction, scope: BorderScope, line: BorderLine | null, whole = false): boolean {
  const target = borderTarget(state, whole);
  if (!target) return false;
  const value = cssBorder(line);
  let changed = false;
  for (const position of target.map.cellsInRect(target.rect)) {
    const node = target.table.nodeAt(position);
    if (!node) continue;
    const sides = sidesFor(scope, target.map.findCell(position), target.rect);
    if (!sides.length) continue;
    const attrs = { ...node.attrs };
    for (const side of sides) attrs[borderAttr(side)] = value;
    tr.setNodeMarkup(tr.mapping.map(target.start + position), undefined, attrs);
    changed = true;
  }
  return changed;
}

function setTableAttr(state: EditorState, tr: Transaction, attrs: Record<string, unknown>): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'table') { tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, ...attrs }); return true; }
  }
  return false;
}

// Per-cell borders plus the table's own placement, which is what Word stores in w:tcBorders and w:tblPr.
export const TableStyle = Extension.create({
  name: 'tableStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: Object.fromEntries(BORDER_SIDES.map((side) => [borderAttr(side), {
          default: null,
          parseHTML: (element: HTMLElement) => { const parsed = parseCssBorder(readSide(element, side)); return parsed === undefined ? null : cssBorder(parsed); },
          renderHTML: (attrs: Record<string, unknown>) => {
            const parsed = parseCssBorder(attrs[borderAttr(side)]);
            return parsed === undefined ? {} : { style: `border-${side}: ${cssBorder(parsed)}` };
          },
        }])),
      },
      {
        types: ['table'],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement) => asAlign(element.getAttribute('data-align')),
            renderHTML: (attrs: Record<string, unknown>) => {
              const align = asAlign(attrs.align);
              if (!align) return {};
              return { 'data-align': align, style: align === 'center' ? 'margin-left: auto; margin-right: auto' : 'margin-left: auto; margin-right: 0' };
            },
          },
          width: {
            default: null,
            parseHTML: (element: HTMLElement) => asWidth(element.getAttribute('data-width')),
            renderHTML: (attrs: Record<string, unknown>) => (asWidth(attrs.width) ? { 'data-width': 'auto', style: 'width: auto' } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setCellBorders: (scope, line, whole = false) => ({ state, tr, dispatch }) => {
        const changed = applyCellBorders(state, tr, scope, line, whole);
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
      setTableAlign: (align) => ({ state, tr, dispatch }) => {
        const changed = setTableAttr(state, tr, { align: asAlign(align) });
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
      setTableWidth: (width) => ({ state, tr, dispatch }) => {
        const changed = setTableAttr(state, tr, { width: width === 'auto' ? 'auto' : null });
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
    };
  },
});
