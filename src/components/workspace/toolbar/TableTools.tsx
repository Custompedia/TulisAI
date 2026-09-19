'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import {
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowLeftRight, Ban, BetweenHorizontalEnd, BetweenHorizontalStart,
  BetweenVerticalEnd, BetweenVerticalStart, Check, Columns3, PanelLeft, PanelTop, Rows3, Table as TableIcon, TableCellsMerge, TableCellsSplit, Trash2, type LucideIcon,
} from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { PALETTE } from './ColorPicker';
import { normalizeColor } from './formatting';
import { ACTIVE, CONTROL, IDLE, keepSelection, PANEL, Popover } from './Popover';
import { cellAlign, cellBackground, distributeColumns, GRID_COLS, GRID_ROWS, hasHeaderColumn, hasHeaderRow, type CellAlign } from './table';
import { TableBorders } from './TableBorders';

type Item = { key: string; label: string; icon: LucideIcon; run: () => void; disabled?: boolean; checked?: boolean; danger?: boolean };

function ItemButton({ item, close }: { item: Item; close: () => void }) {
  const { label, icon: Icon, run, disabled, checked, danger } = item;
  return (
    <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} disabled={disabled}
      onMouseDown={keepSelection} onClick={() => { close(); run(); }}
      className={`flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : 'text-ink-800 hover:bg-paper-deep focus-visible:bg-paper-deep'}`}>
      <Icon size={15} aria-hidden="true" className={`shrink-0 ${danger ? '' : 'text-ink-500'}`} />
      <span className="min-w-0 flex-1 truncate py-1">{label}</span>
      {checked !== undefined && <Check size={14} aria-hidden="true" className={`shrink-0 text-brand-700 ${checked ? '' : 'invisible'}`} />}
    </button>
  );
}

const Separator = () => <div role="separator" className="my-1 h-px bg-line" />;
const Heading = ({ children }: { children: React.ReactNode }) => <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{children}</div>;

// Every table operation Google Docs offers for text tables; used by the toolbar menu and the right-click menu.
export function TableActions({ editor, close }: { editor: Editor; close: () => void }) {
  const { t } = useLocale();
  const chain = () => editor.chain().focus();
  const can = editor.can();
  const background = normalizeColor(cellBackground(editor));
  const align = cellAlign(editor);
  const groups: Item[][] = [
    [
      { key: 'row-above', label: t('Sisipkan baris di atas', 'Insert row above'), icon: BetweenHorizontalStart, run: () => chain().addRowBefore().run(), disabled: !can.addRowBefore() },
      { key: 'row-below', label: t('Sisipkan baris di bawah', 'Insert row below'), icon: BetweenHorizontalEnd, run: () => chain().addRowAfter().run(), disabled: !can.addRowAfter() },
      { key: 'col-left', label: t('Sisipkan kolom di kiri', 'Insert column left'), icon: BetweenVerticalStart, run: () => chain().addColumnBefore().run(), disabled: !can.addColumnBefore() },
      { key: 'col-right', label: t('Sisipkan kolom di kanan', 'Insert column right'), icon: BetweenVerticalEnd, run: () => chain().addColumnAfter().run(), disabled: !can.addColumnAfter() },
    ],
    [
      { key: 'merge', label: t('Gabungkan sel', 'Merge cells'), icon: TableCellsMerge, run: () => chain().mergeCells().run(), disabled: !can.mergeCells() },
      { key: 'split', label: t('Pisahkan sel', 'Unmerge cells'), icon: TableCellsSplit, run: () => chain().splitCell().run(), disabled: !can.splitCell() },
      { key: 'distribute', label: t('Samakan lebar kolom', 'Distribute columns'), icon: ArrowLeftRight, run: () => distributeColumns(editor) },
    ],
    [
      { key: 'header-row', label: t('Baris judul', 'Header row'), icon: PanelTop, run: () => chain().toggleHeaderRow().run(), checked: hasHeaderRow(editor), disabled: !can.toggleHeaderRow() },
      { key: 'header-col', label: t('Kolom judul', 'Header column'), icon: PanelLeft, run: () => chain().toggleHeaderColumn().run(), checked: hasHeaderColumn(editor), disabled: !can.toggleHeaderColumn() },
    ],
  ];
  const removals: Item[] = [
    { key: 'del-row', label: t('Hapus baris', 'Delete row'), icon: Rows3, run: () => chain().deleteRow().run(), disabled: !can.deleteRow(), danger: true },
    { key: 'del-col', label: t('Hapus kolom', 'Delete column'), icon: Columns3, run: () => chain().deleteColumn().run(), disabled: !can.deleteColumn(), danger: true },
    { key: 'del-table', label: t('Hapus tabel', 'Delete table'), icon: Trash2, run: () => chain().deleteTable().run(), disabled: !can.deleteTable(), danger: true },
  ];
  const aligns: Array<[CellAlign, LucideIcon, string]> = [
    ['top', AlignVerticalJustifyStart, t('Rata atas', 'Align top')],
    ['middle', AlignVerticalJustifyCenter, t('Rata tengah', 'Align middle')],
    ['bottom', AlignVerticalJustifyEnd, t('Rata bawah', 'Align bottom')],
  ];

  return (
    <div className="w-64">
      {groups.map((items, index) => (
        <div key={index}>{index > 0 && <Separator />}{items.map((item) => <ItemButton key={item.key} item={item} close={close} />)}</div>
      ))}
      <Separator />
      <Heading>{t('Perataan vertikal', 'Vertical alignment')}</Heading>
      <div role="group" aria-label={t('Perataan vertikal', 'Vertical alignment')} className="flex gap-0.5 px-1">
        {aligns.map(([value, Icon, label]) => (
          <button key={value} type="button" title={label} aria-label={label} aria-pressed={align === value}
            onMouseDown={keepSelection} onClick={() => { close(); chain().setCellAttribute('verticalAlign', value === 'top' ? null : value).run(); }}
            className={`${CONTROL} ${align === value ? ACTIVE : IDLE}`}><Icon size={15} aria-hidden="true" /></button>
        ))}
      </div>
      <Heading>{t('Warna latar sel', 'Cell background')}</Heading>
      <div className="px-1.5 pb-1">
        <button type="button" onMouseDown={keepSelection} onClick={() => { close(); chain().setCellAttribute('background', null).run(); }}
          className="mb-1.5 flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-[12px] font-medium text-ink-700 hover:bg-paper-deep">
          <Ban size={13} aria-hidden="true" />{t('Tanpa warna', 'No colour')}
        </button>
        <div role="group" aria-label={t('Palet warna sel', 'Cell colour palette')} className="grid grid-cols-10 gap-1">
          {PALETTE.slice(0, 4).flat().map((color) => (
            <button key={color} type="button" title={color} aria-label={color} aria-pressed={background === color}
              onMouseDown={keepSelection} onClick={() => { close(); chain().setCellAttribute('background', color).run(); }}
              className={`h-[1.1rem] w-[1.1rem] rounded-[3px] ring-1 ring-black/10 transition-transform hover:scale-110 ${background === color ? 'outline-2 outline-offset-1 outline-brand-600' : ''}`}
              style={{ background: color }} />
          ))}
        </div>
      </div>
      <Separator />
      <TableBorders editor={editor} close={close} />
      <Separator />
      {removals.map((item) => <ItemButton key={item.key} item={item} close={close} />)}
    </div>
  );
}

// Docs-style size picker: hover over the grid to choose rows × columns, click to insert.
function InsertGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const { t } = useLocale();
  const [size, setSize] = useState({ rows: 1, cols: 1 });
  return (
    <div className="p-1">
      <div role="grid" aria-label={t('Ukuran tabel', 'Table size')} className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1rem)` }} onMouseLeave={() => setSize({ rows: 1, cols: 1 })}>
        {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, index) => {
          const row = Math.floor(index / GRID_COLS) + 1; const col = (index % GRID_COLS) + 1;
          const on = row <= size.rows && col <= size.cols;
          return (
            <button key={index} type="button" aria-label={`${row} × ${col}`} onMouseDown={keepSelection}
              onMouseEnter={() => setSize({ rows: row, cols: col })} onFocus={() => setSize({ rows: row, cols: col })} onClick={() => onPick(row, col)}
              className={`h-4 w-4 rounded-[2px] border transition-colors ${on ? 'border-brand-400 bg-brand-100' : 'border-line-strong bg-white'}`} />
          );
        })}
      </div>
      <div aria-live="polite" className="mt-1.5 text-center text-[12px] font-medium tabular-nums text-ink-600">{size.cols} × {size.rows}</div>
    </div>
  );
}

export function TableButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useLocale();
  const inTable = editor.isActive('table');
  if (inTable) {
    return (
      <Popover label={t('Ubah tabel', 'Edit table')} disabled={disabled} active triggerClassName={CONTROL} trigger={<TableIcon size={15} aria-hidden="true" />}>
        {(close) => <TableActions editor={editor} close={close} />}
      </Popover>
    );
  }
  return (
    <Popover label={t('Sisipkan tabel', 'Insert table')} disabled={disabled} role="dialog" focusFirst={false} triggerClassName={CONTROL} trigger={<TableIcon size={15} aria-hidden="true" />}>
      {(close) => <InsertGrid onPick={(rows, cols) => { close(); editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run(); }} />}
    </Popover>
  );
}

// Right-click inside a table opens the same table actions at the pointer, like Google Docs.
export function TableContextMenu({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useLocale();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const open = (event: MouseEvent) => {
      const cell = (event.target as HTMLElement | null)?.closest('td, th');
      if (disabled || !editor.isEditable || !cell || !dom.contains(cell)) return;
      event.preventDefault();
      const { state, view } = editor;
      const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
      // A cell selection survives only when the click lands on one of its cells; its from/to span also covers unselected cells.
      const inside = state.selection instanceof CellSelection ? cell.classList.contains('selectedCell') : hit && hit.pos >= state.selection.from && hit.pos <= state.selection.to;
      if (hit && !inside) view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(hit.pos))));
      view.focus();
      setAt({ x: event.clientX, y: event.clientY });
    };
    dom.addEventListener('contextmenu', open);
    return () => dom.removeEventListener('contextmenu', open);
  }, [editor, disabled]);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [at]);

  // Kept inside the viewport: shifted left or up when the pointer is near an edge, scrolling when taller than the screen.
  useLayoutEffect(() => {
    if (!at || !panel.current) { setPlace(null); return; }
    const gutter = 8; const box = panel.current.getBoundingClientRect(); const height = panel.current.scrollHeight;
    const left = Math.max(gutter, Math.min(at.x, window.innerWidth - box.width - gutter));
    const top = Math.max(gutter, Math.min(at.y, window.innerHeight - height - gutter));
    setPlace({ left, top, maxHeight: window.innerHeight - top - gutter });
  }, [at]);

  if (!at) return null;
  return (
    <div ref={panel} role="menu" aria-label={t('Menu tabel', 'Table menu')}
      style={{ position: 'fixed', zIndex: 50, left: place?.left ?? at.x, top: place?.top ?? at.y, maxHeight: place?.maxHeight, visibility: place ? 'visible' : 'hidden' }}
      className={`${PANEL} scrollbar-thin overflow-y-auto`}>
      <TableActions editor={editor} close={() => setAt(null)} />
    </div>
  );
}
