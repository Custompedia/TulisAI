'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CircleAlert, Clock, Coins, RotateCw, Users, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { numberFormat } from '@/lib/client/format';
import { useSessionGuard } from '@/components/app/AppShell';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import { promptLabel, tierLabel, type AdminSummary, type AiMetrics } from './admin-shared';
import { UsageChart, type Bar } from './UsageChart';

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom';
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (days: number) => iso(new Date(Date.now() - days * 86_400_000));
function rangeOf(preset: Preset, month: string): { from: string; to: string } {
  const today = iso(new Date());
  if (preset === 'today') return { from: today, to: today };
  if (preset === '7d') return { from: shift(6), to: today };
  if (preset === '30d') return { from: shift(29), to: today };
  const [year, mon] = month.split('-').map(Number); const last = new Date(Date.UTC(year!, mon!, 0));
  return { from: `${month}-01`, to: iso(last) };
}

function Stat({ icon: Icon, label, value, hint, tone = 'default' }: { icon: LucideIcon; label: string; value: string; hint?: string; tone?: 'default' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500"><Icon size={14} aria-hidden="true" className={tone === 'warn' ? 'text-amber-600' : 'text-brand-700'} />{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-ink-950">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[12px] text-ink-500" title={hint}>{hint}</p>}
    </div>
  );
}
const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500';
const thr = `${th} text-right`;
const td = 'px-3 py-2 text-[13px] text-ink-700';
const tdr = `${td} text-right tabular-nums`;
function Table({ title, children, empty, isEmpty }: { title: string; children: React.ReactNode; empty: string; isEmpty: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <h3 className="border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink-900">{title}</h3>
      {isEmpty ? <p className="px-4 py-6 text-center text-[13px] text-ink-500">{empty}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[520px]">{children}</table></div>}
    </section>
  );
}

export function AiMonitor({ summary, onOpenUser }: { summary: AdminSummary | null; onOpenUser: (id: string) => void }) {
  const { t, locale } = useLocale();
  const en = locale === 'en';
  const guard = useSessionGuard();
  const [preset, setPreset] = useState<Preset>('30d');
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7));
  const [custom, setCustom] = useState({ from: shift(29), to: iso(new Date()) });
  const [data, setData] = useState<AiMetrics | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const range = preset === 'custom' ? custom : rangeOf(preset, month);
  const n = useCallback((value: number) => numberFormat(value, locale), [locale]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await request<AiMetrics>(`/api/admin/ai?from=${range.from}&to=${range.to}`)); }
    catch (caught) { if (!guard(caught)) setError(caught); }
    finally { setLoading(false); }
  }, [guard, range.from, range.to]);
  useEffect(() => { void load(); }, [load]);

  // Fill every day in the range (zero days included) so weekday averages count quiet days too.
  const charts = useMemo(() => {
    if (!data) return null;
    const byDay = new Map(data.byDay.map((row) => [row.day, row]));
    const days: Bar[] = []; const weekday = Array.from({ length: 7 }, () => ({ total: 0, count: 0, failed: 0 }));
    const dayNames = en ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    for (let at = Date.parse(`${data.from}T00:00:00Z`); at < Date.parse(`${data.to}T00:00:00Z`) + 86_400_000; at += 86_400_000) {
      const day = new Date(at).toISOString().slice(0, 10); const row = byDay.get(day); const dow = new Date(at).getUTCDay();
      weekday[dow]!.total += row?.requests ?? 0; weekday[dow]!.failed += row?.failed ?? 0; weekday[dow]!.count += 1;
      days.push({ key: day, label: `${day.slice(8)}/${day.slice(5, 7)}`, value: row?.requests ?? 0, detail: [[t('Permintaan', 'Requests'), n(row?.requests ?? 0)], [t('Gagal', 'Failed'), n(row?.failed ?? 0)], [t('Pengguna', 'Users'), n(row?.users ?? 0)], ['Token', n(row?.tokens ?? 0)]] });
    }
    const order = [1, 2, 3, 4, 5, 6, 0];
    const weekdays: Bar[] = order.map((dow) => { const w = weekday[dow]!; const avg = w.count ? Math.round((w.total / w.count) * 10) / 10 : 0; return { key: String(dow), label: dayNames[dow]!, value: avg, detail: [[t('Rata-rata / hari', 'Average / day'), n(avg)], [t('Total', 'Total'), n(w.total)], [t('Gagal', 'Failed'), n(w.failed)], [t('Hari dihitung', 'Days counted'), n(w.count)]] }; });
    const peakDay = days.reduce((best, bar) => (bar.value > best.value ? bar : best), days[0]!);
    const peakWeekday = weekdays.reduce((best, bar) => (bar.value > best.value ? bar : best), weekdays[0]!);
    return { days, weekdays, peakDay: peakDay.value > 0 ? peakDay.key : undefined, peakWeekday: peakWeekday.value > 0 ? peakWeekday.key : undefined, peakName: peakWeekday.value > 0 ? peakWeekday.label : null };
  }, [data, en, n, t]);

  const presets: Array<[Preset, string]> = [['today', t('Hari ini', 'Today')], ['7d', t('7 hari', '7 days')], ['30d', t('30 hari', '30 days')], ['month', t('Per bulan', 'By month')], ['custom', t('Rentang', 'Custom')]];
  const totals = data?.totals;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2.5">
        <div role="radiogroup" aria-label={t('Rentang waktu', 'Time range')} className="inline-flex rounded-lg border border-line-strong bg-paper p-0.5">
          {presets.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preset === value} onClick={() => setPreset(value)} className={`h-8 rounded-md px-3 text-[13px] font-semibold transition-colors ${preset === value ? 'bg-white text-ink-900 shadow-sm ring-1 ring-line' : 'text-ink-500 hover:text-ink-800'}`}>{label}</button>)}
        </div>
        {preset === 'month' && <input type="month" aria-label={t('Bulan', 'Month')} value={month} max={iso(new Date()).slice(0, 7)} onChange={(event) => event.target.value && setMonth(event.target.value)} className={`${inputClass} h-8 w-44`} />}
        {preset === 'custom' && <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-500"><input type="date" aria-label={t('Dari', 'From')} value={custom.from} max={custom.to} onChange={(event) => event.target.value && setCustom({ ...custom, from: event.target.value })} className={`${inputClass} h-8 w-40`} /><span>–</span><input type="date" aria-label={t('Sampai', 'To')} value={custom.to} min={custom.from} max={iso(new Date())} onChange={(event) => event.target.value && setCustom({ ...custom, to: event.target.value })} className={`${inputClass} h-8 w-40`} /></div>}
        <span className="ml-auto text-[12.5px] text-ink-500">{range.from} → {range.to} (UTC)</span>
        <Button size="sm" variant="ghost" icon={RotateCw} loading={loading} onClick={() => void load()}>{t('Muat ulang', 'Refresh')}</Button>
      </div>

      {error !== null && <Alert tone="error" actions={<Button size="sm" icon={RotateCw} onClick={() => void load()}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, en)}</Alert>}

      <section aria-label={t('Ringkasan AI', 'AI summary')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {totals ? (
          <>
            <Stat icon={Activity} label={t('Permintaan', 'Requests')} value={n(totals.requests)} hint={t(`${n(totals.completed)} selesai · ${n(totals.running)} berjalan`, `${n(totals.completed)} completed · ${n(totals.running)} running`)} />
            <Stat icon={CircleAlert} label={t('Gagal', 'Failed')} value={n(totals.failed)} hint={t(`${totals.failRate}% dari permintaan`, `${totals.failRate}% of requests`)} tone={totals.failed > 0 ? 'warn' : 'default'} />
            <Stat icon={Users} label={t('Pengguna aktif', 'Active users')} value={n(totals.users)} hint={summary ? t(`dari ${n(summary.users)} akun`, `of ${n(summary.users)} accounts`) : undefined} />
            <Stat icon={Coins} label="Token" value={n(totals.inputTokens + totals.outputTokens)} hint={t(`${n(totals.inputTokens)} masuk · ${n(totals.outputTokens)} keluar`, `${n(totals.inputTokens)} in · ${n(totals.outputTokens)} out`)} />
            <Stat icon={Clock} label={t('Latensi rata-rata', 'Avg latency')} value={totals.avgLatencyMs === null ? '—' : `${n(totals.avgLatencyMs)} ms`} hint={t('dari permintaan selesai', 'over completed requests')} />
            <Stat icon={Activity} label={t('Karakter diproses', 'Characters')} value={n(totals.characters)} hint={summary ? `${summary.model}` : undefined} />
          </>
        ) : Array.from({ length: 6 }, (_, index) => <div key={index} aria-hidden="true" className="h-[92px] animate-pulse rounded-2xl border border-line bg-white" />)}
      </section>

      {data && charts && (
        <div className="grid gap-5">
          <UsageChart title={t('Permintaan per hari', 'Requests per day')} unit={t('permintaan', 'requests')} bars={charts.days} highlight={charts.peakDay} empty={t('Tidak ada permintaan di rentang ini.', 'No requests in this range.')} />
          <UsageChart title={charts.peakName ? t(`Per hari dalam seminggu · puncak ${charts.peakName}`, `By weekday · peak ${charts.peakName}`) : t('Per hari dalam seminggu', 'By weekday')} unit={t('rata-rata permintaan / hari', 'average requests / day')} bars={charts.weekdays} highlight={charts.peakWeekday} empty={t('Tidak ada permintaan di rentang ini.', 'No requests in this range.')} />
        </div>
      )}

      {data && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Table title={t('Per hari', 'By day')} empty={t('Tidak ada permintaan di rentang ini.', 'No requests in this range.')} isEmpty={data.byDay.length === 0}>
            <thead className="bg-paper/60"><tr><th className={th}>{t('Tanggal', 'Date')}</th><th className={thr}>{t('Permintaan', 'Requests')}</th><th className={thr}>{t('Gagal', 'Failed')}</th><th className={thr}>Token</th><th className={thr}>{t('Pengguna', 'Users')}</th></tr></thead>
            <tbody className="divide-y divide-line">{data.byDay.map((row) => <tr key={row.day}><td className={`${td} font-medium text-ink-900`}>{row.day}</td><td className={tdr}>{n(row.requests)}</td><td className={`${tdr} ${row.failed ? 'text-amber-700' : ''}`}>{n(row.failed)}</td><td className={tdr}>{n(row.tokens)}</td><td className={tdr}>{n(row.users)}</td></tr>)}</tbody>
          </Table>
          <Table title={t('Per mode', 'By mode')} empty={t('Tidak ada permintaan di rentang ini.', 'No requests in this range.')} isEmpty={data.byPrompt.length === 0}>
            <thead className="bg-paper/60"><tr><th className={th}>Mode</th><th className={thr}>{t('Permintaan', 'Requests')}</th><th className={thr}>{t('Gagal', 'Failed')}</th><th className={thr}>Token</th><th className={thr}>{t('Latensi', 'Latency')}</th></tr></thead>
            <tbody className="divide-y divide-line">{data.byPrompt.map((row) => <tr key={row.promptId}><td className={td}><span className="font-medium text-ink-900">{promptLabel(row.promptId)}</span><span className="ml-1.5 font-mono text-[11px] text-ink-400">{row.promptId}</span></td><td className={tdr}>{n(row.requests)}</td><td className={`${tdr} ${row.failed ? 'text-amber-700' : ''}`}>{n(row.failed)}</td><td className={tdr}>{n(row.tokens)}</td><td className={tdr}>{row.avgLatencyMs === null ? '—' : `${n(row.avgLatencyMs)} ms`}</td></tr>)}</tbody>
          </Table>
          <Table title={t('Pengguna teratas', 'Top users')} empty={t('Belum ada pemakaian.', 'No usage yet.')} isEmpty={data.topUsers.length === 0}>
            <thead className="bg-paper/60"><tr><th className={th}>{t('Pengguna', 'User')}</th><th className={th}>Tier</th><th className={thr}>{t('Permintaan', 'Requests')}</th><th className={thr}>{t('Gagal', 'Failed')}</th><th className={thr}>Token</th></tr></thead>
            <tbody className="divide-y divide-line">{data.topUsers.map((row) => <tr key={row.id}><td className={td}><button type="button" onClick={() => onOpenUser(row.id)} className="text-left font-medium text-brand-800 underline-offset-2 hover:underline">{row.name}</button><span className="block truncate text-[12px] text-ink-500">{row.email}</span></td><td className={td}>{row.role === 'admin' ? 'Admin' : tierLabel(row.tier, t)}</td><td className={tdr}>{n(row.requests)}</td><td className={`${tdr} ${row.failed ? 'text-amber-700' : ''}`}>{n(row.failed)}</td><td className={tdr}>{n(row.tokens)}</td></tr>)}</tbody>
          </Table>
          <Table title={t('Kode error', 'Error codes')} empty={t('Tidak ada kegagalan di rentang ini.', 'No failures in this range.')} isEmpty={data.byError.length === 0}>
            <thead className="bg-paper/60"><tr><th className={th}>{t('Kode', 'Code')}</th><th className={thr}>{t('Jumlah', 'Count')}</th></tr></thead>
            <tbody className="divide-y divide-line">{data.byError.map((row) => <tr key={row.errorCode}><td className={`${td} font-mono text-[12px]`}>{row.errorCode}</td><td className={tdr}>{n(row.count)}</td></tr>)}</tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
