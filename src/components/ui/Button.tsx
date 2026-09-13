import { forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'light';
type Size = 'sm' | 'md' | 'lg';

const base = 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-500',
  secondary: 'border border-line-strong bg-white text-ink-800 hover:border-ink-300 hover:bg-ink-50',
  ghost: 'text-ink-600 hover:bg-ink-100/70 hover:text-ink-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-500',
  dark: 'bg-ink-900 text-white hover:bg-ink-800',
  light: 'bg-white text-ink-900 hover:bg-ink-50',
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
    <button type="button" aria-label={label} title={label} className={`inline-grid ${box} shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40 ${active ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-ink-100/70 hover:text-ink-900'} ${className}`} {...rest}>
      <Icon size={size === 'sm' ? 16 : 18} aria-hidden="true" />
    </button>
  );
}
