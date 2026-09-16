'use client';
import { useCallback, useEffect, useState } from 'react';
import { RotateCw, Search, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { dateTime, relativeTime } from '@/lib/client/format';
import { useSessionGuard } from '@/components/app/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import { Pagination } from '@/components/ui/Pagination';
import { actionLabel, ADMIN_ACTIONS, detailSummary, shortId, type AuditPage } from './admin-shared';

const th = 'px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500';

export function AdminLog({ onOpenUser, refreshKey }: { onOpenUser: (id: string) => void; refreshKey: number }) {
  const { t, locale } = useLocale();
  const en = locale === 'en';
  const guard = useSessionGuard();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<'all' | (typeof ADMIN_ACTIONS)[number]>('all');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { const timer = setTimeout(() => { setTerm(query.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await request<AuditPage>(`/api/admin/audit?page=${page}&q=${encodeURIComponent(term)}${action === 'all' ? '' : `&action=${action}`}`)); }
    catch (caught) { if (!guard(caught)) setError(caught); }
    finally { setLoading(false); }
  }, [action, guard, page, term]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input type="search" aria-label={t('Cari log', 'Search log')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Cari pelaku, target, atau detail…', 'Search actor, target, or detail…')} className={`${inputClass} pl-9 pr-9`} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Hapus pencarian', 'Clear search')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-paper-deep hover:text-ink-900"><X size={14} /></button>}
        </div>
        <div className="w-full sm:w-56"><HintSelect size="sm" label={t('Jenis tindakan', 'Action type')} value={action} onChange={(value) => { setAction(value); setPage(1); }} options={[{ value: 'all' as const, label: t('Semua tindakan', 'All actions') }, ...ADMIN_ACTIONS.map((item) => ({ value: item, label: actionLabel(item, t) }))]} /></div>
        <Button size="sm" variant="ghost" icon={RotateCw} loading={loading} className="ml-auto" onClick={() => void load()}>{t('Muat ulang', 'Refresh')}</Button>
      </div>
      {error !== null && <Alert tone="error" actions={<Button size="sm" icon={RotateCw} onClick={() => void load()}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, en)}</Alert>}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-paper/60"><tr><th className={`${th} w-44`}>{t('Waktu', 'Time')}</th><th className={`${th} w-44`}>{t('Pelaku', 'Actor')}</th><th className={`${th} w-48`}>{t('Tindakan', 'Action')}</th><th className={`${th} w-44`}>Target</th><th className={th}>Detail</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data === null ? Array.from({ length: 6 }, (_, index) => <tr key={index} aria-hidden="true" className="animate-pulse"><td colSpan={5} className="px-4 py-3"><span className="block h-3.5 w-3/4 rounded bg-paper-deep" /></td></tr>)
                : data.items.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-ink-500">{term || action !== 'all' ? t('Tidak ada log yang cocok.', 'No log entries match.') : t('Belum ada tindakan admin.', 'No admin actions yet.')}</td></tr>
                  : data.items.map((entry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="px-4 py-2.5 text-[13px] text-ink-700"><span className="block font-medium text-ink-900">{relativeTime(entry.createdAt, locale)}</span><span className="block text-[11.5px] text-ink-400">{dateTime(entry.createdAt, locale)}</span></td>
                      <td className="px-4 py-2.5 text-[13px]">{entry.actorName ? <button type="button" onClick={() => onOpenUser(entry.actorId)} className="font-medium text-ink-900 underline-offset-2 hover:underline">{entry.actorName}</button> : <span className="font-mono text-[12px] text-ink-500">{shortId(entry.actorId)}</span>}</td>
                      <td className="px-4 py-2.5 text-[13px]"><span className="inline-flex rounded-md bg-paper-deep px-2 py-0.5 text-[12px] font-semibold text-ink-700">{actionLabel(entry.action, t)}</span></td>
                      <td className="px-4 py-2.5 text-[13px]">{entry.targetName ? <button type="button" onClick={() => entry.targetUserId && onOpenUser(entry.targetUserId)} className="font-medium text-brand-800 underline-offset-2 hover:underline">{entry.targetName}</button> : entry.targetUserId ? <span className="font-mono text-[12px] text-ink-500" title={t('Akun sudah dihapus', 'Account deleted')}>{shortId(entry.targetUserId)}</span> : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-ink-600">{detailSummary(entry, t) || '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {data && <Pagination info={data.pageInfo} disabled={loading} onPage={setPage} className="border-t border-line px-4 py-2.5" />}
      </div>
    </div>
  );
}
