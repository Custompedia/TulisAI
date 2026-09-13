import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';

type Tone = 'info' | 'success' | 'warning' | 'error';
const tones: Record<Tone, { box: string; icon: typeof Info }> = {
  info: { box: 'border-brand-200 bg-brand-50 text-brand-900', icon: Info },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CircleCheck },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: TriangleAlert },
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: CircleAlert },
};

export function Alert({ tone = 'info', title, children, actions, onDismiss, dismissLabel = 'Tutup', className = '' }: { tone?: Tone; title?: string; children?: React.ReactNode; actions?: React.ReactNode; onDismiss?: () => void; dismissLabel?: string; className?: string }) {
  const { box, icon: Icon } = tones[tone];
  return (
    <div role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${box} ${className}`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
        {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-md opacity-70 hover:bg-black/5 hover:opacity-100"><X size={15} /></button>}
    </div>
  );
}
