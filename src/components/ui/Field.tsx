import { Lock, type LucideIcon } from 'lucide-react';

const inputBase = 'w-full rounded-lg border border-line-strong bg-white text-ink-900 placeholder:text-ink-300 transition-colors hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100 disabled:bg-paper disabled:text-ink-400';
export const inputClass = `h-10 px-3 text-sm ${inputBase}`;

export function FieldLabel({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-700">{children}</label>
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
    </div>
  );
}

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: LucideIcon; locked?: boolean; lockedHint?: string; disabled?: boolean };

// A locked option is a paid one: it shows a grey padlock and calls onLocked instead of selecting, so the choice
// stays visible and can explain itself rather than disappearing on the free plan.
// `fit` sizes the control to its labels instead of filling its parent, for use inside a toolbar row.
export function Segmented<T extends string>({ value, onChange, onLocked, options, label, disabled, size = 'md', fit = false }: { value: T; onChange: (value: T) => void; onLocked?: (value: T) => void; options: Array<SegmentedOption<T>>; label: string; disabled?: boolean; size?: 'sm' | 'md'; fit?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-lg border border-line-strong bg-paper p-0.5 ${fit ? '' : 'w-full'}`}>
      {options.map((option) => {
        const active = option.value === value && !option.locked;
        const Icon = option.icon;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={active} disabled={(disabled || option.disabled) && !option.locked}
            title={option.locked ? (option.lockedHint ?? option.label) : option.label}
            onClick={() => (option.locked ? onLocked?.(option.value) : onChange(option.value))}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 font-semibold transition-colors ${fit ? '' : 'flex-1'} ${size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px]'} ${active ? 'bg-white text-ink-900 shadow-sm ring-1 ring-line' : option.locked ? 'text-ink-400 hover:text-ink-600' : 'text-ink-500 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:text-ink-300'}`}>
            {Icon && !option.locked && <Icon size={13} aria-hidden="true" className="shrink-0" />}
            {option.locked && <Lock size={12} aria-hidden="true" className="shrink-0 text-ink-400" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
