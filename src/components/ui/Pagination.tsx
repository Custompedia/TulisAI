'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';

export type PageInfo = { page: number; pageSize: number; total: number; pages: number };

// Window of page numbers around the current page, with edges always present; null marks a gap.
function windowOf(page: number, pages: number): Array<number | null> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const inner = new Set([1, pages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pages));
  if (page <= 3) [2, 3, 4].forEach((value) => inner.add(value)); if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((value) => inner.add(value));
  const sorted = [...inner].sort((a, b) => a - b); const out: Array<number | null> = [];
  sorted.forEach((value, index) => { if (index > 0 && value - sorted[index - 1]! > 1) out.push(null); out.push(value); });
  return out;
}

export function Pagination({ info, disabled, onPage, className = '' }: { info: PageInfo; disabled?: boolean; onPage: (page: number) => void; className?: string }) {
  const { t, locale } = useLocale();
  const first = info.total === 0 ? 0 : (info.page - 1) * info.pageSize + 1;
  const last = Math.min(info.total, info.page * info.pageSize);
  const button = 'inline-grid h-8 min-w-8 place-items-center rounded-lg px-2 text-[13px] font-medium transition-colors disabled:opacity-40';
  return (
    <nav aria-label={t('Halaman', 'Pages')} className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="text-[13px] text-ink-500">{info.total === 0 ? t('Tidak ada data', 'No rows') : t(`${numberFormat(first, locale)}–${numberFormat(last, locale)} dari ${numberFormat(info.total, locale)}`, `${numberFormat(first, locale)}–${numberFormat(last, locale)} of ${numberFormat(info.total, locale)}`)}</p>
      {info.pages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t('Halaman sebelumnya', 'Previous page')} disabled={disabled || info.page <= 1} onClick={() => onPage(info.page - 1)} className={`${button} text-ink-600 hover:bg-paper-deep`}><ChevronLeft size={16} aria-hidden="true" /></button>
          {windowOf(info.page, info.pages).map((value, index) => value === null
            ? <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-ink-400">…</span>
            : <button key={value} type="button" aria-current={value === info.page ? 'page' : undefined} disabled={disabled} onClick={() => onPage(value)} className={`${button} ${value === info.page ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-paper-deep'}`}>{value}</button>)}
          <button type="button" aria-label={t('Halaman berikutnya', 'Next page')} disabled={disabled || info.page >= info.pages} onClick={() => onPage(info.page + 1)} className={`${button} text-ink-600 hover:bg-paper-deep`}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      )}
    </nav>
  );
}
