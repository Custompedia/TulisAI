'use client';
import { useState } from 'react';
import { Check, ExternalLink, RotateCw } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { replaceOrder, useBilling, type Order } from '@/lib/client/billing-store';
import { dateTime, numberFormat } from '@/lib/client/format';
import { daysLeft, quotaLevel, shortDate, tierName } from '@/lib/client/quota';
import { balanceRows, featureLabel, orderStatus } from '@/lib/client/usage-view';
import { useEntitlements, useSessionGuard, useShell } from '@/components/app/AppShell';
import { openPlans } from '@/components/app/shell-events';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white">
      <header className="px-5 pt-5 sm:px-6"><h2 className="text-[17px] font-semibold tracking-tight text-ink-900">{title}</h2>{description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}</header>
      <div className="px-5 pb-5 pt-4 sm:px-6">{children}</div>
    </section>
  );
}

const TONE = { ok: 'bg-brand-50 text-brand-800', wait: 'bg-amber-50 text-amber-800', bad: 'bg-red-50 text-red-800', muted: 'bg-paper-deep text-ink-600' } as const;

// Akun & Paket › Pemakaian & paket: everything comes from GET /api/usage and GET /api/payments/orders,
// with no number written into the interface (the Free request cap is an environment setting).
export function UsagePanel() {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const { user, usage, refreshUsage } = useShell();
  const { tier, features } = useEntitlements();
  const { billing, loading, error, reload } = useBilling();
  const [checking, setChecking] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);
  const en = locale === 'en';
  const admin = user.role === 'admin';

  if (!usage) {
    return <Alert tone="info" actions={<Button size="sm" icon={RotateCw} onClick={() => void refreshUsage()}>{t('Muat ulang', 'Reload')}</Button>}>{t('Data pemakaian belum tersedia.', 'Usage data is unavailable.')}</Alert>;
  }

  const oneTime = usage.characterScope === 'account';
  const level = quotaLevel(usage);
  const usedPercent = Math.min(100, Math.round((usage.charactersUsed / Math.max(1, usage.characterLimit)) * 100));
  const paidUntil = usage.access?.paidUntil ?? billing?.plan?.paidThrough ?? null;
  const rows = balanceRows(usage.wallet, t);
  const requestPercent = Math.min(100, Math.round((usage.requestsUsed / Math.max(1, usage.requestLimit)) * 100));

  async function check(order: Order) {
    setChecking(order.id); setNotice(null);
    try {
      const fresh = await request<Order>(`/api/payments/orders/${encodeURIComponent(order.id)}/refresh`, 'POST', undefined, newKey());
      replaceOrder(fresh);
      if (fresh.status === 'paid') { await refreshUsage(); void reload(); }
      setNotice({ tone: fresh.status === 'paid' ? 'success' : 'info', message: t(`Status pesanan: ${orderStatus(fresh.status, t).label}.`, `Order status: ${orderStatus(fresh.status, t).label}.`) });
    } catch (caught) { if (!guard(caught)) setNotice({ tone: 'error', message: errorText(caught, en) }); }
    finally { setChecking(''); }
  }

  return (
    <div className="space-y-5">
      <Section title={t('Paket aktif', 'Current plan')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tracking-tight text-ink-950">{tierName(tier, t)}{admin && <span className="ml-2 align-middle text-sm font-medium text-ink-500">{t('akun admin', 'admin account')}</span>}</p>
            <p className="mt-1 text-sm text-ink-600">
              {admin ? t('Akun admin memakai hak Max tanpa paket katalog.', 'An admin account has Max rights without a catalogue plan.')
                : tier === 'free' ? t('Jatah karakter Gratis diberikan sekali per akun.', 'The Free character allowance is given once per account.')
                : paidUntil ? t(`Berlaku s.d. ${shortDate(paidUntil, 'id')} · ${daysLeft(paidUntil)} hari lagi`, `Valid until ${shortDate(paidUntil, 'en')} · ${daysLeft(paidUntil)} days left`)
                : t('Masa berlaku belum tersedia.', 'Validity is not available yet.')}
            </p>
          </div>
          <button type="button" onClick={openPlans} className="text-[13px] font-medium text-ink-600 underline decoration-line-strong underline-offset-2 hover:text-ink-900">{t('Lihat paket', 'See plans')}</button>
        </div>
        {billing && !billing.checkoutOpen && <p className="mt-2 text-[13px] text-ink-500">{t('Pembayaran belum dibuka. Paket dan kuota yang sudah kamu punya tetap berlaku.', 'Payments are not open yet. Your current plan and allowance stay as they are.')}</p>}
        <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">{t('Fitur terbuka', 'Unlocked features')}</p>
        {features.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">{features.map((feature) => <li key={feature} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-[12.5px] text-ink-700"><Check size={13} aria-hidden="true" className="text-brand-700" />{featureLabel(feature, t)}</li>)}</ul>
        ) : <p className="mt-1.5 text-[13px] text-ink-500">{t('6 mode tulis ulang, aksi cepat, riwayat versi, dan bandingkan.', '6 rewrite modes, quick actions, version history, and compare.')}</p>}
      </Section>

      <Section title={t('Karakter AI', 'AI characters')} description={oneTime ? t('Jatah sekali pakai untuk akun ini', 'A one-time allowance for this account') : t('Jatah bulan ini, ditambah top-up yang masih berlaku', 'This month’s allowance plus any valid top-up')}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-3xl font-bold text-ink-950 tabular-nums">{numberFormat(usage.charactersRemaining, locale)}<span className="ml-1.5 text-base font-medium text-ink-400">{t('tersisa', 'left')}</span></p>
          <p className="text-sm text-ink-500 tabular-nums">{t(`${numberFormat(usage.charactersUsed, 'id')} dari ${numberFormat(usage.characterLimit, 'id')} terpakai`, `${numberFormat(usage.charactersUsed, 'en')} of ${numberFormat(usage.characterLimit, 'en')} used`)}</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-deep"><div className={`h-full rounded-full ${level === 'empty' ? 'bg-red-500' : level === 'low' ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${usedPercent}%` }} /></div>
        {rows.length > 0 && (
          <dl className="mt-4 divide-y divide-line rounded-xl border border-line">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="min-w-0"><span className={`block text-[13.5px] font-medium ${row.spendable ? 'text-ink-900' : 'text-ink-500'}`}>{row.label}</span><span className="block text-[12px] text-ink-500">{row.hint}</span></dt>
                <dd className={`shrink-0 text-[13.5px] font-semibold tabular-nums ${row.spendable ? 'text-ink-900' : 'text-ink-500'}`}>{numberFormat(row.value, locale)}{row.of !== undefined && <span className="font-normal text-ink-500"> / {numberFormat(row.of, locale)}</span>}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-[13px] text-ink-500">{t('Yang dihitung hanya teks sumber yang berhasil diproses. Perbaikan otomatis, percobaan gagal, mengetik, riwayat, dan perbandingan tidak dihitung.', 'Only source text that was processed successfully is counted. Automatic repairs, failed attempts, typing, history, and comparisons are never counted.')}</p>
      </Section>

      <Section title={t('Permintaan AI', 'AI requests')} description={`${t('Periode', 'Period')} ${usage.period} (UTC)`}>
        {admin ? (
          <p className="text-sm text-ink-700">{t('Akun admin tidak dibatasi kuota permintaan bulanan (tetap maks. 10 per menit), tetapi tetap memakai saldo karakter.', 'An admin account has no monthly request cap (still at most 10 per minute), but it still spends its character balance.')} <span className="text-ink-500">{t(`${numberFormat(usage.requestsUsed, 'id')} permintaan bulan ini.`, `${numberFormat(usage.requestsUsed, 'en')} requests this month.`)}</span></p>
        ) : (
          <>
            <p className="text-sm text-ink-700"><span className="text-xl font-semibold tabular-nums text-ink-950">{numberFormat(usage.requestsUsed, locale)}</span> / {numberFormat(usage.requestLimit, locale)} {t('permintaan bulan ini', 'requests this month')}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-deep"><div className={`h-full rounded-full ${requestPercent >= 90 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${requestPercent}%` }} /></div>
            <p className="mt-2 text-[13px] text-ink-500">{t('Di semua paket, maks. 10 permintaan AI per menit.', 'On every plan, at most 10 AI requests per minute.')}</p>
          </>
        )}
      </Section>

      <Section title={t('Riwayat pembayaran', 'Payment history')} description={t('20 pesanan terakhir', 'The last 20 orders')}>
        {notice && <Alert tone={notice.tone} className="mb-3" onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')}>{notice.message}</Alert>}
        {loading && !billing ? <div role="status" aria-label={t('Memuat pesanan…', 'Loading orders…')} className="space-y-2">{[0, 1].map((row) => <div key={row} className="h-12 animate-pulse rounded-xl bg-paper-deep" />)}</div>
          : error && !billing ? <Alert tone="error" actions={<Button size="sm" icon={RotateCw} onClick={() => void reload()}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, en)}</Alert>
          : !billing?.orders.length ? <p className="text-sm text-ink-500">{t('Belum ada pesanan.', 'No orders yet.')}</p>
          : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {billing.orders.slice(0, 20).map((order) => {
                const status = orderStatus(order.status, t);
                const what = order.kind === 'plan' ? `${t('Paket', 'Plan')} ${order.plan ? tierName(order.plan, t) : ''}` : t(`Tambahan ${numberFormat(order.characters, 'id')} karakter`, `${numberFormat(order.characters, 'en')}-character top-up`);
                return (
                  <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink-900">{what} · Rp{numberFormat(order.amountIdr, 'id')}</p>
                      <p className="text-[12px] text-ink-500">{dateTime(order.createdAt, locale)}{order.mode === 'sandbox' && ` · ${t('mode uji', 'test mode')}`}</p>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${TONE[status.tone]}`}>{status.label}</span>
                    {order.status === 'pending' && (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Button size="sm" icon={RotateCw} loading={checking === order.id} disabled={checking !== ''} onClick={() => void check(order)}>{t('Cek status', 'Check status')}</Button>
                        {order.payUrl && <a href={order.payUrl} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold text-brand-800 hover:bg-brand-50">{t('Lanjutkan pembayaran', 'Continue payment')}<ExternalLink size={13} aria-hidden="true" /></a>}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </Section>
    </div>
  );
}
