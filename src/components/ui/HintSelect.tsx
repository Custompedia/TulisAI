'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAutoSide } from './placement';

type Option<V extends string> = { value: V; label: string; hint?: string; disabled?: boolean };

// Dropdown whose options show a muted one-line hint under each label.
export function HintSelect<V extends string>({ id, label, value, options, onChange, disabled, size = 'md', align = 'start' }: { id?: string; label: string; value: V; options: Array<Option<V>>; onChange: (value: V) => void; disabled?: boolean; size?: 'sm' | 'md'; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const placement = useAutoSide(open, root, list);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  const pick = (next: V) => { onChange(next); setOpen(false); button.current?.focus(); };

  return (
    <div ref={root} className="relative">
      <button ref={button} id={id} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={id ? undefined : label} disabled={disabled} onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 rounded-lg border bg-white text-left text-ink-900 ${size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3 text-sm'} transition-colors hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100 disabled:bg-paper disabled:text-ink-400 ${open ? 'border-brand-400' : 'border-line-strong'}`}>
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        <ChevronDown size={size === 'sm' ? 14 : 16} aria-hidden="true" className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={list} id={listId} role="listbox" aria-label={label} onKeyDown={move} style={{ maxHeight: placement.maxHeight }} className={`scrollbar-thin absolute z-40 ${placement.side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1'} ${align === 'end' ? 'right-0' : 'left-0'} w-full min-w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-12px_rgb(31_32_29/0.22)] animate-fade-up`}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button key={option.value} type="button" role="option" aria-selected={selected} disabled={option.disabled} onClick={() => pick(option.value)}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus:outline-none focus-visible:bg-paper-deep disabled:opacity-40 ${selected ? 'bg-brand-50' : 'hover:bg-paper-deep'}`}>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] ${selected ? 'font-medium text-ink-900' : 'text-ink-700'}`}>{option.label}</span>
                  {option.hint && <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{option.hint}</span>}
                </span>
                {selected && <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0 self-start text-brand-700" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
