import { ChevronDown } from 'lucide-react';

const inputBase = 'w-full rounded-lg border border-line-strong bg-white text-ink-900 placeholder:text-ink-300 transition-colors hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100 disabled:bg-paper disabled:text-ink-400';
export const inputClass = `h-10 px-3 text-sm ${inputBase}`;

export function FieldLabel({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-700">{children}</label>
      {hint && <span className="text-xs text-ink-400">{hint}</span>}
    </div>
  );
}

export function Select({ value, onChange, options, id, label, disabled, className = '', size = 'md' }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string; disabled?: boolean }>; id?: string; label?: string; disabled?: boolean; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={`relative ${className}`}>
      <select id={id} aria-label={id ? undefined : label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${inputBase} appearance-none ${size === 'sm' ? 'h-8 pr-7 pl-2.5 text-[13px]' : 'h-10 pr-9 pl-3 text-sm'}`}>
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <ChevronDown size={16} aria-hidden="true" className={`pointer-events-none absolute top-1/2 ${size === 'sm' ? 'right-2' : 'right-3'} -translate-y-1/2 text-ink-400`} />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, disabled, size = 'md' }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>; label: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-lg border border-line-strong bg-paper p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={active} disabled={disabled} onClick={() => onChange(option.value)}
            className={`flex-1 rounded-md px-2.5 font-semibold transition-colors ${size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px]'} ${active ? 'bg-white text-ink-900 shadow-sm ring-1 ring-line' : 'text-ink-500 hover:text-ink-800'}`}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
