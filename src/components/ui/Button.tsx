import { forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';
type Size = 'sm' | 'md' | 'lg';

export const raisedGreen = 'bg-brand-800 text-white';
// Flat hover/press for the green button.
export const pressGreen = 'hover:bg-brand-900 active:bg-brand-900';
export const raisedBlack = 'border border-white/50 bg-[linear-gradient(180deg,#6b6b6b_-20.63%,#000_34.92%)] text-white shadow-raised';
// Small white pill for secondary inline actions.
export const pillButton = 'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-white px-2.5 text-xs font-medium text-ink-700 transition-colors hover:border-line-strong hover:bg-paper hover:text-ink-900 disabled:pointer-events-none disabled:opacity-50';
const base = 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[color,background-color,border-color,transform] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2';
const variants: Record<Variant, string> = {
  primary: `rounded-full ${raisedGreen} ${pressGreen} focus-visible:outline-brand-600`,
  secondary: 'rounded-lg border border-line bg-white text-ink-800 hover:border-line-strong hover:bg-paper',
  ghost: 'rounded-lg text-ink-600 hover:bg-ink-100/70 hover:text-ink-900',
  danger: 'rounded-lg bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-500',
  light: 'rounded-lg bg-white text-ink-900 hover:bg-ink-50',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-[15px]' };

export const buttonClass = (variant: Variant = 'secondary', size: Size = 'md', extra = '') => `${base} ${variants[variant]} ${sizes[size]} ${extra}`;

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: LucideIcon; iconRight?: LucideIcon; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading = false, className = '', children, disabled, type = 'button', ...rest }, ref) {
  const iconSize = size === 'sm' ? 15 : 17;
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Spinner size={iconSize} /> : Icon ? <Icon size={iconSize} aria-hidden="true" /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} aria-hidden="true" /> : null}
    </button>
  );
});

export function IconButton({ icon: Icon, label, active = false, className = '', size = 'md', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  return (
    <button type="button" aria-label={label} title={label} className={`inline-grid ${box} shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40 ${active ? 'bg-brand-50 text-brand-800' : 'text-ink-500 hover:bg-ink-100/70 hover:text-ink-900'} ${className}`} {...rest}>
      <Icon size={size === 'sm' ? 16 : 18} aria-hidden="true" />
    </button>
  );
}
