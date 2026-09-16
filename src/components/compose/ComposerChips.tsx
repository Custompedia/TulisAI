'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';

export const CHIP = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-white px-3 text-[12.5px] text-ink-800 transition-colors hover:border-ink-300 hover:text-ink-900 disabled:opacity-50';
const PANEL = 'absolute top-full z-40 mt-1.5 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-12px_rgb(31_32_29/0.22)] animate-fade-up';

type Option<T extends string> = { value: T; label: string; disabled?: boolean };

export function ChipPopover({ label, value, disabled, width = 'w-60', align = 'start', ghost = false, children }: { label: string; value?: string; disabled?: boolean; width?: string; align?: 'start' | 'end'; ghost?: boolean; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const close = () => { setOpen(false); button.current?.focus(); };
  return (
    <div ref={root} className="relative">
      <button ref={button} type="button" aria-haspopup="true" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(!open)}
        className={ghost ? `inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-ink-600 transition-colors hover:bg-paper-deep hover:text-ink-900 disabled:opacity-50 ${open ? 'bg-paper-deep text-ink-900' : ''}` : `${CHIP} ${open ? 'border-ink-300 text-ink-900' : ''}`}>
        {!ghost && <span className="font-medium">{label}</span>}
        {value && <span className={ghost ? '' : 'max-w-32 truncate text-ink-500'}>{value}</span>}
        <ChevronDown size={13} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div id={id} role="dialog" aria-label={label} className={`${PANEL} ${width} ${align === 'end' ? 'right-0' : 'left-0'}`}>{children(close)}</div>}
    </div>
  );
}

export function ChipSelect<T extends string>({ label, value, options, onChange, disabled, ghost, align, width = 'w-44' }: { label: string; value: T; options: Array<Option<T>>; onChange: (value: T) => void; disabled?: boolean; ghost?: boolean; align?: 'start' | 'end'; width?: string }) {
  return (
    <ChipPopover label={label} value={options.find((option) => option.value === value)?.label} disabled={disabled} ghost={ghost} align={align} width={width}>
      {(close) => (
        <div role="listbox" aria-label={label}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button key={option.value} type="button" role="option" aria-selected={selected} disabled={option.disabled} onClick={() => { onChange(option.value); close(); }}
                className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors disabled:opacity-40 ${selected ? 'bg-brand-50 font-medium text-ink-900' : 'text-ink-700 hover:bg-paper-deep'}`}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>{selected && <Check size={14} aria-hidden="true" className="shrink-0 text-brand-700" />}
              </button>
            );
          })}
        </div>
      )}
    </ChipPopover>
  );
}

export function ChipText({ label, value, placeholder, maxLength, onChange, disabled }: { label: string; value: string; placeholder: string; maxLength: number; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useLocale();
  return (
    <ChipPopover label={label} value={value || t('Opsional', 'Optional')} disabled={disabled} width="w-64">
      {(close) => (
        <form className="space-y-2 p-1.5" onSubmit={(event) => { event.preventDefault(); close(); }}>
          <input autoFocus aria-label={label} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)}
            className="h-9 w-full rounded-lg border border-line-strong bg-white px-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100" />
          <div className="flex items-center justify-between text-xs text-ink-500">
            <span>{value.length}/{maxLength}</span>
            <span className="flex gap-1">
              {value && <button type="button" onClick={() => onChange('')} className="rounded-lg px-2.5 py-1.5 font-semibold text-ink-600 hover:bg-paper">{t('Hapus', 'Clear')}</button>}
              <button type="submit" className="rounded-lg bg-brand-50 px-2.5 py-1.5 font-semibold text-brand-800 hover:bg-brand-100">{t('Selesai', 'Done')}</button>
            </span>
          </div>
        </form>
      )}
    </ChipPopover>
  );
}
