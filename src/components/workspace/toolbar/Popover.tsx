'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useAutoSide } from '@/components/ui/placement';

export const CONTROL = 'grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40';
export const IDLE = 'text-ink-600 enabled:hover:bg-paper-deep enabled:hover:text-ink-900';
export const TRIGGER = 'flex h-8 shrink-0 items-center gap-0.5 rounded-md px-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40';
export const ACTIVE = 'bg-brand-50 text-brand-800 ring-1 ring-brand-200';
export const PANEL = 'absolute z-40 rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)]';
export const DIVIDER = 'mx-1 h-5 w-px shrink-0 bg-line';

// Keeps the editor selection: a toolbar press must never move focus before the command runs.
export const keepSelection = (event: React.MouseEvent) => event.preventDefault();
// Open popovers, innermost last: Esc closes only the top one, so a menu nested in the ⋮ panel leaves the panel open.
const openStack: string[] = [];

export function Control({ icon: Icon, label, active, disabled, onRun, shortcut }: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onRun: (event: React.MouseEvent<HTMLButtonElement>) => void; shortcut?: string }) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button type="button" title={title} aria-label={label} aria-pressed={active} disabled={disabled}
      onMouseDown={keepSelection} onClick={onRun} className={`${CONTROL} ${active ? ACTIVE : IDLE}`}>
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

type PopoverProps = {
  label: string; trigger: React.ReactNode; disabled?: boolean; active?: boolean; triggerClassName?: string; idleClassName?: string; panelClassName?: string;
  role?: 'menu' | 'dialog'; focusFirst?: boolean; align?: 'start' | 'end'; scrollable?: boolean; children: (close: () => void) => React.ReactNode; onOpen?: () => void;
};

// A toolbar dropdown: closes on outside press or Esc, flips to fit the viewport, and never steals the editor selection on press.
export function Popover({ label, trigger, disabled, active, triggerClassName = TRIGGER, idleClassName = IDLE, panelClassName = '', role = 'menu', focusFirst = true, align = 'start', scrollable = true, children, onOpen }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(align === 'end');
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const placement = useAutoSide(open, root, panel, 'bottom');

  useLayoutEffect(() => {
    if (!open) { setAlignEnd(align === 'end'); return; }
    const box = panel.current?.getBoundingClientRect();
    if (box && box.right > window.innerWidth - 8) setAlignEnd(true);
    else if (box && box.left < 8) setAlignEnd(false);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && openStack.at(-1) === id) { event.stopPropagation(); setOpen(false); button.current?.focus(); } };
    openStack.push(id);
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey, true);
    if (focusFirst) (panel.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled), input'))?.focus({ preventScroll: true });
    return () => { const at = openStack.indexOf(id); if (at >= 0) openStack.splice(at, 1); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open, focusFirst, id]);

  const move = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []);
    if (!nodes.length) return;
    event.preventDefault();
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
  };
  const close = () => setOpen(false);

  return (
    <div ref={root} className="relative shrink-0">
      <button ref={button} type="button" title={label} aria-label={label} aria-haspopup={role} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
        onMouseDown={keepSelection} onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}
        className={`${triggerClassName} ${active || open ? ACTIVE : idleClassName}`}>
        {trigger}
      </button>
      {open && (
        <div ref={panel} id={id} role={role} aria-label={label} onKeyDown={move} style={scrollable ? { maxHeight: placement.maxHeight } : undefined}
          className={`${PANEL} ${scrollable ? 'scrollbar-thin overflow-y-auto' : ''} ${alignEnd ? 'right-0' : 'left-0'} ${placement.side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1'} ${panelClassName}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export const Chevron = () => <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-400" />;

export type Choice = { key: string; label: string; checked?: boolean; icon?: LucideIcon; style?: React.CSSProperties; hint?: string; disabled?: boolean; onSelect: () => void };

export function ChoiceList({ items, close, checkable = true }: { items: Choice[]; close: () => void; checkable?: boolean }) {
  return items.map(({ key, label, checked, icon: Icon, style, hint, disabled, onSelect }) => (
    <button key={key} type="button" role={checkable ? 'menuitemradio' : 'menuitem'} aria-checked={checkable ? !!checked : undefined} disabled={disabled}
      onMouseDown={keepSelection} onClick={() => { close(); onSelect(); }}
      className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-ink-800 outline-none transition-colors enabled:hover:bg-paper-deep focus-visible:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-40">
      {checkable && <Check size={14} aria-hidden="true" className={`shrink-0 text-brand-700 ${checked ? '' : 'invisible'}`} />}
      {Icon && <Icon size={15} aria-hidden="true" className="shrink-0 text-ink-500" />}
      <span className="min-w-0 flex-1 truncate py-1" style={style}>{label}</span>
      {hint && <span className="shrink-0 pl-3 text-xs text-ink-400">{hint}</span>}
    </button>
  ));
}
