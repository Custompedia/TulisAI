'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Gauge } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { compactCharacters, quotaLevel } from '@/lib/client/quota';
import { HashLink } from '@/components/ui/HashLink';
import { useEntitlements, useShell } from './AppShell';
import { openPlans } from './shell-events';

// The character pill in the top bar (and the editor header). It opens a small popover with what is left,
// the per-run limit, and the way to the full usage page; "Lihat paket" stays a small link, never the main action.
export function QuotaPill() {
  const { t, locale } = useLocale();
  const { usage } = useShell();
  const { limits } = useEntitlements();
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

  if (!usage) return null;
  // Admins are charged characters like everyone else, so the meter never switches to an unlimited display.
  const level = quotaLevel(usage);
  // Free's allowance is granted once per account, so the label must not promise a monthly reset.
  const oneTime = usage.characterScope === 'account';
  const scope = oneTime ? t('sekali pakai', 'one-time') : t('bulan ini', 'this month');
  const usedPercent = Math.min(100, Math.round((usage.charactersUsed / Math.max(1, usage.characterLimit)) * 100));
  const tone = level === 'empty' ? 'border-red-200 bg-red-50 text-red-800' : level === 'low' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-line bg-white text-ink-700 hover:border-line-strong hover:text-ink-900';

  return (
    <div ref={root} className="relative">
      <button ref={button} type="button" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={t(`Karakter AI: ${numberFormat(usage.charactersRemaining, 'id')} tersisa, ${scope}`, `AI characters: ${numberFormat(usage.charactersRemaining, 'en')} left, ${scope}`)}
        className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-[13px] font-medium shadow-[0_1px_2px_rgb(31_32_29/0.05)] transition-colors sm:px-4 ${tone}`}>
        <Gauge size={16} aria-hidden="true" className={level === 'ok' ? 'text-brand-700' : ''} />
        {/* A phone gets the compact remaining count; wider screens get used/limit and the scope. */}
        <span className="font-semibold tabular-nums text-ink-900 sm:hidden">{compactCharacters(usage.charactersRemaining, locale)}</span>
        <span className="hidden sm:inline"><span className="font-semibold tabular-nums text-ink-900">{numberFormat(usage.charactersUsed, locale)}/{numberFormat(usage.characterLimit, locale)}</span> {oneTime ? t('karakter sekali pakai', 'one-time characters') : t('karakter bulan ini', 'characters this month')}</span>
      </button>

      {open && (
        <div id={id} role="dialog" aria-label={t('Karakter AI', 'AI characters')}
          className="absolute right-0 top-full z-40 mt-2 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-white p-4 shadow-[0_12px_32px_-12px_rgb(31_32_29/0.22)] animate-fade-up">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{t('Karakter AI', 'AI characters')} · {scope}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink-950 tabular-nums">{numberFormat(usage.charactersRemaining, locale)}<span className="ml-1 text-sm font-medium text-ink-500">{t('tersisa', 'left')}</span></p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-deep"><div className={`h-full rounded-full ${level === 'empty' ? 'bg-red-500' : level === 'low' ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${usedPercent}%` }} /></div>
          <p className="mt-2 text-[12.5px] text-ink-600">{t(`${numberFormat(usage.charactersUsed, 'id')} dari ${numberFormat(usage.characterLimit, 'id')} terpakai`, `${numberFormat(usage.charactersUsed, 'en')} of ${numberFormat(usage.characterLimit, 'en')} used`)}</p>
          <p className="mt-1 text-[12.5px] text-ink-600">{t(`Maks. ${numberFormat(limits.runLimit, 'id')} karakter per proses`, `Up to ${numberFormat(limits.runLimit, 'en')} characters per run`)}</p>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
            <HashLink href="/settings#pemakaian" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-800 hover:text-ink-900">{t('Rincian pemakaian', 'Usage details')}<ArrowRight size={14} aria-hidden="true" /></HashLink>
            <button type="button" onClick={() => { setOpen(false); openPlans(); }} className="text-[12px] font-medium text-ink-500 underline decoration-line-strong underline-offset-2 hover:text-ink-900">{t('Lihat paket', 'See plans')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
