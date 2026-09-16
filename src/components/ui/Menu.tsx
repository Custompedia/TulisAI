'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useAutoSide } from './placement';

export type MenuItem = { label: string; icon?: LucideIcon; onSelect: () => void; tone?: 'default' | 'danger'; disabled?: boolean };

export function Menu({ label, trigger, items, align = 'end', side = 'bottom', header, className = '', triggerClassName = '', disabled }: { label: string; trigger: React.ReactNode; items: MenuItem[]; align?: 'start' | 'end'; side?: 'top' | 'bottom'; header?: React.ReactNode; className?: string; triggerClassName?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const placement = useAutoSide(open, root, list, side);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const nodes = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
    nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
  };

  return (
    <div ref={root} className={`relative ${className}`}>
      <button ref={button} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(!open); }} className={triggerClassName}>{trigger}</button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label} onKeyDown={move} style={{ maxHeight: placement.maxHeight }}
          className={`scrollbar-thin absolute z-40 min-w-44 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)] ${align === 'end' ? 'right-0' : 'left-0'} ${placement.side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}>
          {header}
          {items.map(({ label: itemLabel, icon: Icon, onSelect, tone = 'default', disabled: itemDisabled }) => (
            <button key={itemLabel} type="button" role="menuitem" disabled={itemDisabled} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); onSelect(); }}
              className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium outline-none transition-colors disabled:opacity-40 ${tone === 'danger' ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : 'text-ink-700 hover:bg-paper-deep focus-visible:bg-paper-deep'}`}>
              {Icon && <Icon size={15} aria-hidden="true" className="shrink-0" />}{itemLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
