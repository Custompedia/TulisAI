'use client';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight, Ban, Grid2x2, Grid3x3, MoveHorizontal, PanelBottom, PanelLeft, PanelRight, PanelTop, Square, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { BORDER_STYLES, BORDER_WIDTHS, DEFAULT_BORDER, type BorderLine, type BorderStyle } from '@/lib/docx/borders';
import type { BorderScope, TableAlign } from '@/lib/editor/extensions/table-style';
import { PALETTE } from './ColorPicker';
import { ACTIVE, CONTROL, IDLE, keepSelection } from './Popover';
import { tableAt } from './table';

// Docs keeps one "pen" — width, style and colour — and applies it to whichever sides you press.
type Pen = { width: number; style: BorderStyle; color: string };

const SCOPES: Array<[BorderScope | 'clear', LucideIcon, string, string]> = [
  ['all', Grid3x3, 'Semua garis', 'All borders'],
  ['outer', Square, 'Garis luar', 'Outer borders'],
  ['inner', Grid2x2, 'Garis dalam', 'Inner borders'],
  ['top', PanelTop, 'Garis atas', 'Top border'],
  ['bottom', PanelBottom, 'Garis bawah', 'Bottom border'],
  ['left', PanelLeft, 'Garis kiri', 'Left border'],
  ['right', PanelRight, 'Garis kanan', 'Right border'],
  ['clear', Ban, 'Tanpa garis', 'No border'],
];

const Heading = ({ children }: { children: React.ReactNode }) => <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{children}</div>;

export function TableBorders({ editor, close }: { editor: Editor; close: () => void }) {
  const { t } = useLocale();
  const [pen, setPen] = useState<Pen>({ width: DEFAULT_BORDER.width, style: DEFAULT_BORDER.style, color: DEFAULT_BORDER.color });
  const [whole, setWhole] = useState(false);
  const table = tableAt(editor);
  const align = ((table?.node.attrs.align as TableAlign | null) ?? 'left');
  const fullWidth = table?.node.attrs.width !== 'auto';

  const apply = (scope: BorderScope | 'clear') => {
    const line: BorderLine | null = scope === 'clear' ? null : { width: pen.width, style: pen.style, color: pen.color };
    editor.chain().focus().setCellBorders(scope === 'clear' ? 'all' : scope, line, whole).run();
  };

  return (
    <div>
      <Heading>{t('Garis tabel', 'Table borders')}</Heading>
      <div role="group" aria-label={t('Garis tabel', 'Table borders')} className="grid grid-cols-8 gap-0.5 px-1">
        {SCOPES.map(([scope, Icon, id, en]) => (
          <button key={scope} type="button" title={t(id, en)} aria-label={t(id, en)} onMouseDown={keepSelection} onClick={() => apply(scope)}
            className={`${CONTROL} ${IDLE}`}><Icon size={15} aria-hidden="true" /></button>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 px-1.5">
        <label className="sr-only" htmlFor="border-width">{t('Tebal garis', 'Border weight')}</label>
        <select id="border-width" value={pen.width} onChange={(event) => setPen({ ...pen, width: Number(event.target.value) })}
          className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink-800 focus:border-brand-400 focus:outline-none">
          {BORDER_WIDTHS.map((width) => <option key={width} value={width}>{width} pt</option>)}
        </select>
        <label className="sr-only" htmlFor="border-style">{t('Gaya garis', 'Border style')}</label>
        <select id="border-style" value={pen.style} onChange={(event) => setPen({ ...pen, style: event.target.value as BorderStyle })}
          className="h-7 flex-1 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink-800 focus:border-brand-400 focus:outline-none">
          {BORDER_STYLES.map((style) => <option key={style} value={style}>{{ solid: t('Lurus', 'Solid'), dashed: t('Putus-putus', 'Dashed'), dotted: t('Titik', 'Dotted'), double: t('Ganda', 'Double') }[style]}</option>)}
        </select>
      </div>
      <div role="group" aria-label={t('Warna garis', 'Border colour')} className="mt-1.5 grid grid-cols-10 gap-1 px-1.5">
        {PALETTE.slice(0, 2).flat().map((color) => (
          <button key={color} type="button" title={color} aria-label={color} aria-pressed={pen.color === color} onMouseDown={keepSelection} onClick={() => setPen({ ...pen, color })}
            className={`h-[1.1rem] w-[1.1rem] rounded-[3px] ring-1 ring-black/10 transition-transform hover:scale-110 ${pen.color === color ? 'outline-2 outline-offset-1 outline-brand-600' : ''}`}
            style={{ background: color }} />
        ))}
      </div>
      <label className="mt-1.5 flex items-center gap-2 px-2 py-1 text-[12.5px] text-ink-700">
        <input type="checkbox" checked={whole} onChange={(event) => setWhole(event.target.checked)} className="h-3.5 w-3.5 accent-brand-700" />
        {t('Terapkan ke seluruh tabel', 'Apply to the whole table')}
      </label>

      <Heading>{t('Posisi tabel', 'Table placement')}</Heading>
      <div role="group" aria-label={t('Perataan tabel', 'Table alignment')} className="flex gap-0.5 px-1">
        {(['left', 'center', 'right'] as const).map((value) => {
          const Icon = { left: AlignLeft, center: AlignCenter, right: AlignRight }[value];
          const label = { left: t('Tabel rata kiri', 'Align table left'), center: t('Tabel rata tengah', 'Align table centre'), right: t('Tabel rata kanan', 'Align table right') }[value];
          return (
            <button key={value} type="button" title={label} aria-label={label} aria-pressed={align === value} onMouseDown={keepSelection}
              onClick={() => { close(); editor.chain().focus().setTableAlign(value).run(); }}
              className={`${CONTROL} ${align === value ? ACTIVE : IDLE}`}><Icon size={15} aria-hidden="true" /></button>
          );
        })}
        <button type="button" title={t('Lebar tabel: penuh atau seukuran isi', 'Table width: full or fit to contents')}
          aria-label={t('Lebar tabel', 'Table width')} aria-pressed={!fullWidth} onMouseDown={keepSelection}
          onClick={() => { close(); editor.chain().focus().setTableWidth(fullWidth ? 'auto' : 'full').run(); }}
          className={`${CONTROL} ${!fullWidth ? ACTIVE : IDLE}`}><MoveHorizontal size={15} aria-hidden="true" /></button>
      </div>
      <p className="px-2 pb-1 pt-1 text-[11.5px] text-ink-400">
        {fullWidth ? t('Lebar penuh — perataan terlihat setelah lebar diubah ke seukuran isi.', 'Full width — alignment shows once the width fits the contents.') : t('Seukuran isi.', 'Fits the contents.')}
      </p>
    </div>
  );
}
