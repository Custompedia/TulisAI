'use client';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Download, RotateCw, Search, SearchX, UserPlus, UserRound, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { dateTime, numberFormat, relativeTime } from '@/lib/client/format';
import { useSessionGuard, useShell } from '@/components/app/AppShell';
import { Avatar } from '@/components/ui/Avatar';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import { Pagination } from '@/components/ui/Pagination';
import { sortLabel, TIERS, tierLabel, type AdminUser, type Role, type Tier, type UsersPage, type UserSort } from './admin-shared';
import { CreateUserDialog } from './CreateUserDialog';
import { RoleBadge, StatusBadge, TierBadge } from './UserDetailModal';

type Filters = { role: 'all' | Role; tier: 'all' | Tier; status: 'all' | 'active' | 'banned'; sort: UserSort };
const th = 'px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500';
const csvCell = (value: unknown) => { const text = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
function exportCsv(items: AdminUser[]) {
  const header = ['id', 'name', 'email', 'username', 'role', 'tier', 'status', 'email_verified', 'requests_this_month', 'characters_this_month', 'failed_this_month', 'tokens_this_month', 'character_limit', 'documents', 'last_active_at', 'created_at'];
  const rows = items.map((u) => [u.id, u.name, u.email, u.username, u.role, u.tier, u.banned ? 'disabled' : 'active', u.emailVerified, u.requestsThisMonth, u.charactersThisMonth, u.failedThisMonth, u.tokensThisMonth, u.unlimited ? 'unlimited' : u.characterLimit, u.documents, u.lastActiveAt, u.createdAt]);
  const blob = new Blob([[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `users-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

export function UserDatabase({ onOpenUser, onPage, refreshKey, notify }: { onOpenUser: (id: string) => void; onPage: (page: UsersPage) => void; refreshKey: number; notify: (notice: { tone: 'success' | 'error'; message: string }) => void }) {
  const { t, locale } = useLocale();
  const en = locale === 'en';
  const guard = useSessionGuard();
  const { user: me } = useShell();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<Filters>({ role: 'all', tier: 'all', status: 'all', sort: 'newest' });
  const [data, setData] = useState<UsersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const timer = setTimeout(() => { setTerm(query.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const search = new URLSearchParams({ q: term, page: String(page), sort: filters.sort });
    if (filters.role !== 'all') search.set('role', filters.role); if (filters.tier !== 'all') search.set('tier', filters.tier); if (filters.status !== 'all') search.set('status', filters.status);
    try { const next = await request<UsersPage>(`/api/admin/users?${search}`); setData(next); onPage(next); }
    catch (caught) { if (!guard(caught)) setError(caught); }
    finally { setLoading(false); }
  }, [filters, guard, onPage, page, term]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const filtered = filters.role !== 'all' || filters.tier !== 'all' || filters.status !== 'all' || term !== '';
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      {summary && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-600">
          <span><b className="font-semibold text-ink-900">{numberFormat(summary.users, locale)}</b> {t('akun', 'accounts')}</span>
          <span><b className="font-semibold text-ink-900">{numberFormat(summary.admins, locale)}</b> admin</span>
          <span><b className="font-semibold text-ink-900">{numberFormat(summary.banned, locale)}</b> {t('nonaktif', 'disabled')}</span>
          {TIERS.map((tier) => <span key={tier}><b className="font-semibold text-ink-900">{numberFormat(summary.tiers[tier], locale)}</b> {tierLabel(tier, t)}</span>)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full lg:w-72">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input type="search" aria-label={t('Cari pengguna', 'Search users')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Cari nama, email, username…', 'Search name, email, username…')} className={`${inputClass} pl-9 pr-9`} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Hapus pencarian', 'Clear search')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-paper-deep hover:text-ink-900"><X size={14} /></button>}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:w-auto">
          <div className="lg:w-32"><HintSelect size="sm" label="Role" value={filters.role} onChange={(role) => setFilter('role', role)} options={[{ value: 'all', label: t('Semua role', 'All roles') }, { value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]} /></div>
          <div className="lg:w-32"><HintSelect size="sm" label="Tier" value={filters.tier} onChange={(tier) => setFilter('tier', tier)} options={[{ value: 'all', label: t('Semua tier', 'All tiers') }, ...TIERS.map((tier) => ({ value: tier, label: tierLabel(tier, t) }))]} /></div>
          <div className="lg:w-36"><HintSelect size="sm" label="Status" value={filters.status} onChange={(status) => setFilter('status', status)} options={[{ value: 'all', label: t('Semua status', 'All statuses') }, { value: 'active', label: t('Aktif', 'Active') }, { value: 'banned', label: t('Nonaktif', 'Disabled') }]} /></div>
          <div className="lg:w-48"><HintSelect size="sm" label={t('Urutkan', 'Sort')} value={filters.sort} onChange={(sort) => setFilter('sort', sort)} options={(['newest', 'oldest', 'name', 'usage', 'active'] as UserSort[]).map((sort) => ({ value: sort, label: sortLabel(sort, t) }))} /></div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={Download} disabled={!data?.items.length} onClick={() => data && exportCsv(data.items)}>CSV</Button>
          <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setCreating(true)}>{t('Tambah pengguna', 'Add user')}</Button>
        </div>
      </div>
      {error !== null && <Alert tone="error" actions={<Button size="sm" icon={RotateCw} onClick={() => void load()}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, en)}</Alert>}

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] table-fixed">
            <colgroup><col /><col className="w-24" /><col className="w-24" /><col className="w-28" /><col className="w-32" /><col className="w-36" /><col className="w-36" /><col className="w-10" /></colgroup>
            <thead className="bg-paper/60"><tr><th className={th}>{t('Pengguna', 'User')}</th><th className={th}>Role</th><th className={th}>Tier</th><th className={th}>Status</th><th className={`${th} text-right`}>{t('AI bulan ini', 'AI this month')}</th><th className={th}>{t('Terakhir aktif', 'Last active')}</th><th className={th}>{t('Bergabung', 'Joined')}</th><th className={th}><span className="sr-only">{t('Buka', 'Open')}</span></th></tr></thead>
            <tbody className="divide-y divide-line">
              {data === null ? Array.from({ length: 6 }, (_, index) => <tr key={index} aria-hidden="true" className="animate-pulse"><td className="px-4 py-3"><span className="flex items-center gap-3"><span className="h-9 w-9 rounded-full bg-paper-deep" /><span className="flex-1 space-y-2"><span className="block h-3 w-40 rounded bg-paper-deep" /><span className="block h-3 w-56 rounded bg-paper-deep" /></span></span></td><td colSpan={7} /></tr>)
                : data.items.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-10 text-center">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-paper-deep text-ink-400">{filtered ? <SearchX size={22} aria-hidden="true" /> : <UserRound size={22} aria-hidden="true" />}</span>
                    <p className="mt-3 font-semibold text-ink-900">{filtered ? t('Tidak ada pengguna yang cocok.', 'No users match.') : t('Belum ada pengguna.', 'No users yet.')}</p>
                    {filtered && <Button size="sm" className="mt-3" onClick={() => { setQuery(''); setFilters({ role: 'all', tier: 'all', status: 'all', sort: 'newest' }); setPage(1); }}>{t('Hapus filter', 'Clear filters')}</Button>}
                  </td></tr>
                ) : data.items.map((item) => {
                  const self = item.id === me.id;
                  return (
                    <tr key={item.id} onClick={() => onOpenUser(item.id)} className="cursor-pointer transition-colors hover:bg-paper/70">
                      <td className="px-4 py-2.5">
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar name={item.name} image={item.image} size={36} className={item.banned ? 'opacity-60' : ''} />
                          <span className="min-w-0"><span className="block truncate text-[14px] font-semibold text-ink-900">{item.name}{self && <span className="ml-1.5 text-[11px] font-medium text-ink-500">({t('kamu', 'you')})</span>}</span><span className="block truncate text-[12.5px] text-ink-500">{item.email}{item.username ? ` · @${item.username}` : ''}</span></span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5"><RoleBadge role={item.role} /></td>
                      <td className="px-4 py-2.5"><TierBadge tier={item.tier} t={t} /></td>
                      <td className="px-4 py-2.5"><StatusBadge user={item} t={t} /></td>
                      <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-ink-700" title={t(`${item.failedThisMonth} gagal · ${numberFormat(item.tokensThisMonth, locale)} token`, `${item.failedThisMonth} failed · ${numberFormat(item.tokensThisMonth, locale)} tokens`)}>{numberFormat(item.requestsThisMonth, locale)}<span className="text-ink-400"> / {item.unlimited ? '∞' : numberFormat(item.requestLimit, locale)}</span>{item.failedThisMonth > 0 && <span className="ml-1 text-amber-700">!</span>}</td>
                      <td className="px-4 py-2.5 text-[13px] text-ink-700" title={item.lastActiveAt ? dateTime(item.lastActiveAt, locale) : undefined}>{item.lastActiveAt ? relativeTime(item.lastActiveAt, locale) : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-ink-700">{dateTime(item.createdAt, locale)}</td>
                      <td className="px-2 py-2.5 text-ink-400"><ChevronRight size={16} aria-hidden="true" /></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {data && <Pagination info={data.pageInfo} disabled={loading} onPage={setPage} className="border-t border-line px-4 py-2.5" />}
      </div>
      {creating && <CreateUserDialog summary={summary ?? null} onClose={() => setCreating(false)} onCreated={(created) => { setCreating(false); notify({ tone: 'success', message: t(`Akun ${created.email} dibuat.`, `Account ${created.email} created.`) }); void load(); onOpenUser(created.id); }} />}
    </div>
  );
}
