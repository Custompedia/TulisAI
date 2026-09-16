'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { resolveSide, VIEWPORT_GUTTER as GUTTER } from '../ui/placement';

export const CHIP = 'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong bg-white px-3 text-[12.5px] text-ink-800 transition-colors hover:border-ink-300 hover:text-ink-900 disabled:opacity-50';
const PANEL = 'fixed z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-12px_rgb(31_32_29/0.22)] animate-fade-up';

type Option<T extends string> = { value: T; label: string; short?: string; hint?: string; disabled?: boolean };

// Fixed-position panel so chips inside a horizontally scrolling row are never clipped.
export function ChipPopover({ label, value, disabled, width = 'w-60', align = 'start', ghost = false, prefix, children }: { label: string; value?: string; disabled?: boolean; width?: string; align?: 'start' | 'end'; ghost?: boolean; prefix?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      const anchor = button.current?.getBoundingClientRect(); const box = panel.current?.getBoundingClientRect(); if (!anchor || !box) return;
      const preferred = align === 'end' ? anchor.right - box.width : anchor.left;
      const { side, maxHeight } = resolveSide(anchor, (panel.current?.scrollHeight ?? box.height) + 6, 'bottom');
      const height = Math.min(panel.current?.scrollHeight ?? box.height, maxHeight - 6);
      setPosition({ top: side === 'bottom' ? anchor.bottom + 6 : Math.max(GUTTER, anchor.top - 6 - height), left: Math.max(GUTTER, Math.min(preferred, window.innerWidth - GUTTER - box.width)), maxHeight: maxHeight - 6 });
    };
    place();
    const close = () => setOpen(false);
    // Scrolling inside the panel itself keeps it open; any other scroll closes it.
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) close(); };
    window.addEventListener('resize', close); window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true); };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const close = () => { setOpen(false); button.current?.focus(); };
  return (
    <div ref={root} className="shrink-0">
      <button ref={button} type="button" aria-haspopup="true" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(!open)}
        className={ghost ? `inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-medium text-ink-600 transition-colors hover:bg-paper-deep hover:text-ink-900 disabled:opacity-50 ${open ? 'bg-paper-deep text-ink-900' : ''}` : `${CHIP} ${open ? 'border-ink-300 text-ink-900' : ''}`}>
        {!ghost && <span className="font-medium">{label}</span>}
        {ghost && prefix && <span className="text-ink-400">{prefix}:</span>}
        {!ghost && value && <span aria-hidden="true" className="text-ink-300">·</span>}
        {value && <span className={ghost ? '' : 'max-w-28 truncate text-ink-500'}>{value}</span>}
        <ChevronDown size={13} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label={label} style={position ?? { top: 0, left: 0, visibility: 'hidden' }} className={`${PANEL} scrollbar-thin overflow-y-auto ${width}`}>{children(close)}</div>
      )}
    </div>
  );
}

export function ChipSelect<T extends string>({ label, title, value, options, onChange, disabled, ghost, prefix, align, width }: { label: string; title?: string; value: T; options: Array<Option<T>>; onChange: (value: T) => void; disabled?: boolean; ghost?: boolean; prefix?: string; align?: 'start' | 'end'; width?: string }) {
  const current = options.find((option) => option.value === value);
  return (
    <ChipPopover label={label} value={current?.short ?? current?.label} disabled={disabled} ghost={ghost} prefix={prefix} align={align} width={width ?? (options.some((option) => option.hint) ? 'w-72' : 'w-44')}>
      {(close) => (
        <div role="listbox" aria-label={title ?? label}>
          {title && <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">{title}</p>}
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button key={option.value} type="button" role="option" aria-selected={selected} disabled={option.disabled} onClick={() => { onChange(option.value); close(); }}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors disabled:opacity-40 ${selected ? 'bg-brand-50 font-medium text-ink-900' : 'text-ink-700 hover:bg-paper-deep'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block">{option.label}</span>
                  {option.hint && <span className="mt-0.5 block text-[12px] font-normal leading-snug text-ink-500">{option.hint}</span>}
                </span>
                {selected && <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0 self-start text-brand-700" />}
              </button>
            );
          })}
        </div>
      )}
    </ChipPopover>
  );
}

// One non-wrapping row that scrolls sideways and fades its right edge while more chips are hidden.
export function ChipRow({ center = false, children }: { center?: boolean; children: React.ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const node = row.current; if (!node) return;
    const update = () => setMore(node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    update();
    const observer = new ResizeObserver(update); observer.observe(node); for (const child of node.children) observer.observe(child);
    node.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); node.removeEventListener('scroll', update); };
  }, [children]);
  return (
    <div ref={row} className={`scrollbar-none flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto ${center ? '' : 'flex-1'} ${more ? '[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]' : ''}`}>
      {children}
    </div>
  );
}
