'use client';
import { Ban, RotateCcw, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { normalizeColor } from './formatting';
import { CONTROL, keepSelection, Popover } from './Popover';

// Google Docs' palette: a grey ramp, ten saturated hues, then three light and three dark shades of each.
export const PALETTE: string[][] = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
  ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'],
];

type Props = { icon: LucideIcon; label: string; value: string | null; fallback: string; resetLabel: string; resetIcon?: 'reset' | 'none'; disabled?: boolean; onPick: (color: string) => void; onReset: () => void };

export function ColorPicker({ icon: Icon, label, value, fallback, resetLabel, resetIcon = 'reset', disabled, onPick, onReset }: Props) {
  const { t } = useLocale();
  const current = normalizeColor(value);
  const Reset = resetIcon === 'none' ? Ban : RotateCcw;
  return (
    <Popover label={label} disabled={disabled} role="dialog" focusFirst={false} triggerClassName={CONTROL} panelClassName="w-[15.5rem] p-2"
      trigger={<span className="flex flex-col items-center"><Icon size={15} aria-hidden="true" /><span aria-hidden="true" className="mt-0.5 h-[3px] w-4 rounded-sm ring-1 ring-black/10" style={{ background: current ?? fallback }} /></span>}>
      {(close) => (
        <>
          <button type="button" onMouseDown={keepSelection} onClick={() => { close(); onReset(); }}
            className="mb-2 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-ink-700 hover:bg-paper-deep">
            <Reset size={14} aria-hidden="true" />{resetLabel}
          </button>
          <div role="group" aria-label={t('Palet warna', 'Colour palette')} className="grid grid-cols-10 gap-1">
            {PALETTE.map((row, index) => row.map((color) => (
              <button key={`${index}-${color}`} type="button" title={color} aria-label={color} aria-pressed={current === color}
                onMouseDown={keepSelection} onClick={() => { close(); onPick(color); }}
                className={`h-[1.15rem] w-[1.15rem] rounded-[3px] ring-1 ring-black/10 transition-transform hover:scale-110 focus-visible:outline-2 ${index < 2 ? 'mb-1.5' : ''} ${current === color ? 'outline-2 outline-offset-1 outline-brand-600' : ''}`}
                style={{ background: color }} />
            )))}
          </div>
        </>
      )}
    </Popover>
  );
}
