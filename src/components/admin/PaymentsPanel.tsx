'use client';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, Coins, FlaskConical, Link2, ReceiptText, RotateCw, ShoppingBag, Undo2, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { dateTime, numberFormat, usdFormat } from '@/lib/client/format';
import { useSessionGuard } from '@/components/app/AppShell';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { LYNK_PRODUCTS } from '@/lib/lynk-products';

type Report = {
  month: string; revenue: { plan: { grossIdr: number; orders: number }; topup: { grossIdr: number; orders: number }; byItem: Array<{ kind: string; item: string; months?: number; grossIdr: number; orders: number }>; refundedIdr: number; netIdr: number };
  sandboxOrders: number; aiCostUsd: number | null; aiRequests: number;
  attention: Array<{ id: string; userId: string; name: string | null; email: string | null; kind: string; item: string; amountIdr: number; mode: string; reason: 'needs_operator' | 'plan_refunded'; at: string }>;
  recent: Array<{ id: string; userId: string; name: string | null; email: string | null; kind: string; item: string; months?: number; provider?: string; amountIdr: number; mode: string; status: string; granted: boolean; createdAt: string; paidAt: string | null }>;
  lynk?: Lynk[];
};
type Lynk = { refId: string; email: string; name: string; product: string; amountIdr: number | null; status: string; reason: string | null; extra: number; receivedAt: string; orderId: string | null };

// A Lynk payment that waits for an account can be given to the account with another email (a typo at checkout).
function AttachForm({ refId, onDone }: { refId: string; onDone: () => void }) {
  const { t, locale } = useLocale();
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await request('/api/admin/lynk/attach', 'POST', { ref: refId, email }); onDone(); }
    catch (caught) { setError(errorText(caught, locale === 'en')); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex w-full flex-wrap items-center gap-2 pt-1">
      <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('Email akun Tulis Lab', 'Tulis Lab account email')} aria-label={t('Email akun Tulis Lab', 'Tulis Lab account email')}
        className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-2.5 text-[13px] text-ink-900 focus:border-brand-600 focus:outline-none" />
      <Button size="sm" icon={Link2} loading={busy} type="submit">{t('Sambungkan', 'Attach')}</Button>
      {error && <p className="w-full text-[12px] text-red-700">{error}</p>}
    </form>
  );
}

const shiftMonth = (month: string, delta: number) => { const [year, index] = month.split('-').map(Number); const date = new Date(Date.UTC(year!, index! - 1 + delta, 1)); return date.toISOString().slice(0, 7); };
const currentMonth = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500';
const td = 'px-3 py-2 text-[13px] text-ink-700';

function Kpi({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500"><Icon size={14} aria-hidden="true" className="shrink-0 text-brand-700" />{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-ink-950">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-ink-500">{hint}</p>}
    </div>
  );
}

// Admin → Pembayaran, after Mari Rekap: production money only; sandbox is a count; refunds net in the month handled.
export function PaymentsPanel({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const idr = (value: number) => `Rp${numberFormat(value, locale)}`;
  const itemLabel = (kind: string, item: string, months = 1) => kind === 'plan' ? `${t('Paket', 'Plan')} ${item[0]!.toUpperCase()}${item.slice(1)}${months > 1 ? t(` · ${months} bulan`, ` · ${months} months`) : ''}` : t(`Tambahan ${{ small: 'kecil', medium: 'sedang', large: 'besar' }[item] ?? item}`, `Top-up ${item}`);
  const lynkTitle = (key: string) => LYNK_PRODUCTS.find((product) => product.key === key)?.title ?? (key || t('Produk lain', 'Another product'));
  const lynkReason = (row: Lynk) => row.status === 'waiting_account' ? t('Belum ada akun terverifikasi dengan email ini. Pembeli sudah dikirimi link aktivasi; sambungkan manual bila emailnya salah ketik.', 'No verified account has this email. The buyer was emailed an activation link; attach it by hand if the email was mistyped.')
    : row.reason === 'EMAIL_INVALID' ? t('Email pembeli tidak terbaca. Hubungi pembeli lewat Lynk, lalu beri paket lewat tab Paket.', 'The buyer\'s email is unusable. Contact them through Lynk, then grant the plan in the Plan tab.')
    : row.reason === 'ZERO_TOTAL' ? t('Total Rp0 (kupon penuh). Beri paket lewat tab Paket bila memang hadiah.', 'A zero total (a full coupon). Grant the plan in the Plan tab if it is a gift.')
    : row.extra > 0 ? t(`Ada ${row.extra} produk lagi di pembayaran ini yang belum diberikan. Berikan lewat tab Paket.`, `${row.extra} more product(s) in this payment were not granted. Grant them in the Plan tab.`)
    : row.status === 'processing' ? t('Sedang diproses, atau terhenti di tengah. Dicoba lagi otomatis saat Lynk mengirim ulang.', 'Being processed, or cut short. Retried automatically when Lynk sends it again.')
    : t('Perlu dicek.', 'Needs a look.');
  const statusText = (status: string, granted: boolean) => ({ pending: t('Menunggu', 'Pending'), paid: granted ? t('Lunas', 'Paid') : t('Lunas · perlu tindakan', 'Paid · action needed'), failed: t('Gagal', 'Failed'), expired: t('Kedaluwarsa', 'Expired'), cancelled: t('Dibatalkan', 'Cancelled'), refunded: t('Dikembalikan', 'Refunded') }[status] ?? status);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await request<Report>(`/api/admin/payments?month=${month}`)); }
    catch (caught) { if (!guard(caught)) setError(caught); }
    finally { setLoading(false); }
  }, [guard, month]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={ChevronLeft} onClick={() => setMonth(shiftMonth(month, -1))}>{t('Bulan lalu', 'Previous')}</Button>
        <span className="min-w-[7rem] text-center text-[14px] font-semibold tabular-nums text-ink-900">{month}</span>
        <Button size="sm" icon={ChevronRight} disabled={month >= currentMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>{t('Bulan depan', 'Next')}</Button>
        <Button size="sm" icon={RotateCw} loading={loading} onClick={() => void load()}>{t('Muat ulang', 'Reload')}</Button>
      </div>
      {error ? <Alert tone="error">{errorText(error, locale === 'en')}</Alert> : null}
      {data && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={Coins} label={t('Pendapatan bersih', 'Net revenue')} value={idr(data.revenue.netIdr)} hint={t(`Kotor ${idr(data.revenue.plan.grossIdr + data.revenue.topup.grossIdr)} · refund ${idr(data.revenue.refundedIdr)}`, `Gross ${idr(data.revenue.plan.grossIdr + data.revenue.topup.grossIdr)} · refunds ${idr(data.revenue.refundedIdr)}`)} />
          <Kpi icon={ReceiptText} label={t('Langganan / tambahan', 'Plans / top-ups')} value={`${numberFormat(data.revenue.plan.orders, locale)} / ${numberFormat(data.revenue.topup.orders, locale)}`} hint={`${idr(data.revenue.plan.grossIdr)} / ${idr(data.revenue.topup.grossIdr)}`} />
          <Kpi icon={FlaskConical} label={t('Pesanan sandbox', 'Sandbox orders')} value={numberFormat(data.sandboxOrders, locale)} hint={t('Tidak dihitung sebagai pendapatan', 'Never counted as revenue')} />
          <Kpi icon={Undo2} label={t('Biaya AI', 'AI cost')} value={data.aiCostUsd === null ? '—' : usdFormat(data.aiCostUsd, locale)} hint={t(`${numberFormat(data.aiRequests, locale)} permintaan · dalam USD`, `${numberFormat(data.aiRequests, locale)} requests · in USD`)} />
        </div>

        <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink-900"><CircleAlert size={15} className="text-amber-600" aria-hidden="true" />{t('Perlu tindakan', 'Needs action')}</h3>
          {data.attention.length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-ink-500">{t('Tidak ada pembayaran yang perlu ditangani.', 'No payments need handling.')}</p> : (
            <ul className="divide-y divide-line">{data.attention.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5 text-[13px]">
                <button type="button" className="font-medium text-brand-800 underline-offset-2 hover:underline" onClick={() => onOpenUser(row.userId)}>{row.name ?? row.email ?? row.userId}</button>
                <span className="text-ink-700">{itemLabel(row.kind, row.item)} · {idr(row.amountIdr)}{row.mode === 'sandbox' ? ' · sandbox' : ''}</span>
                <span className="text-ink-500">{row.reason === 'needs_operator' ? t('Dibayar saat paket lain berjalan — sesuaikan paket lewat tab Paket, lalu hubungi pengguna.', 'Paid while another plan was running — adjust the plan in the Plan tab, then contact the user.') : t('Paket dikembalikan dananya — akhiri paket lewat tab Paket bila perlu.', 'Plan refunded — end the plan in the Plan tab if needed.')}</span>
                <span className="ml-auto font-mono text-[11.5px] text-ink-400">{row.id} · {dateTime(row.at, locale)}</span>
              </li>
            ))}</ul>
          )}
        </section>

        {(data.lynk?.length ?? 0) > 0 && <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink-900"><ShoppingBag size={15} className="text-amber-600" aria-hidden="true" />{t('Lynk: belum masuk ke akun', 'Lynk: not on an account yet')}</h3>
          <ul className="divide-y divide-line">{data.lynk!.map((row) => (
            <li key={row.refId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5 text-[13px]">
              <span className="font-medium text-ink-900">{row.name || row.email || '—'}</span>
              {row.email && <span className="text-ink-500">{row.email}</span>}
              <span className="text-ink-700">{lynkTitle(row.product)}{row.amountIdr !== null ? ` · ${idr(row.amountIdr)}` : ''}</span>
              <span className="w-full text-ink-500">{lynkReason(row)}</span>
              <span className="ml-auto font-mono text-[11.5px] text-ink-400">{row.refId} · {dateTime(row.receivedAt, locale)}</span>
              {row.status === 'waiting_account' && <AttachForm refId={row.refId} onDone={() => void load()} />}
            </li>
          ))}</ul>
        </section>}

        <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <h3 className="border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink-900">{t('Pendapatan per item (production)', 'Revenue by item (production)')}</h3>
          {data.revenue.byItem.length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-ink-500">{t('Belum ada pembayaran production bulan ini.', 'No production payments this month.')}</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[420px]"><thead className="bg-paper/60"><tr><th className={th}>{t('Item', 'Item')}</th><th className={`${th} text-right`}>{t('Pesanan', 'Orders')}</th><th className={`${th} text-right`}>{t('Kotor', 'Gross')}</th></tr></thead>
              <tbody className="divide-y divide-line">{data.revenue.byItem.map((row) => <tr key={`${row.kind}:${row.item}:${row.months ?? 1}`}><td className={td}>{itemLabel(row.kind, row.item, row.months)}</td><td className={`${td} text-right tabular-nums`}>{numberFormat(row.orders, locale)}</td><td className={`${td} text-right tabular-nums`}>{idr(row.grossIdr)}</td></tr>)}</tbody></table></div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <h3 className="border-b border-line px-4 py-2.5 text-[14px] font-semibold text-ink-900">{t('Pesanan terbaru', 'Recent orders')}</h3>
          {data.recent.length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-ink-500">{t('Belum ada pesanan.', 'No orders yet.')}</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[720px]"><thead className="bg-paper/60"><tr><th className={th}>{t('Waktu', 'Time')}</th><th className={th}>{t('Pengguna', 'User')}</th><th className={th}>Item</th><th className={`${th} text-right`}>{t('Jumlah', 'Amount')}</th><th className={th}>Status</th><th className={th}>{t('Lewat', 'Via')}</th><th className={th}>ID</th></tr></thead>
              <tbody className="divide-y divide-line">{data.recent.map((row) => (
                <tr key={row.id}>
                  <td className={td}>{dateTime(row.createdAt, locale)}</td>
                  <td className={td}><button type="button" className="text-brand-800 underline-offset-2 hover:underline" onClick={() => onOpenUser(row.userId)}>{row.name ?? row.email ?? row.userId}</button></td>
                  <td className={td}>{itemLabel(row.kind, row.item, row.months)}</td>
                  <td className={`${td} text-right tabular-nums`}>{idr(row.amountIdr)}</td>
                  <td className={td}>{statusText(row.status, row.granted)}</td>
                  <td className={td}>{row.provider === 'lynk' ? 'Lynk' : row.mode === 'sandbox' ? 'Sandbox' : 'Midtrans'}</td>
                  <td className={`${td} font-mono text-[11.5px] text-ink-500`}>{row.id}</td>
                </tr>
              ))}</tbody></table></div>
          )}
        </section>
        <p className="text-[12px] text-ink-500">{t('Pendapatan hanya dari pembayaran production yang lunas, dihitung per bulan WIB. Refund dikurangkan pada bulan refund ditangani. Biaya AI dicatat dalam USD; margin menunggu kurs akuntansi yang disepakati.', 'Revenue counts paid production payments only, per WIB month. Refunds are netted in the month they were handled. AI cost is recorded in USD; margin waits for an agreed accounting exchange rate.')}</p>
      </>}
    </div>
  );
}
