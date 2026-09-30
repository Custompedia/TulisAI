'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Clock, RotateCw } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, isUnauthenticated, newKey, request } from '@/lib/client/api';
import { numberFormat } from '@/lib/client/format';
import { Logo } from '@/components/ui/Logo';
import { Button, buttonClass } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

type Order = { id: string; kind: 'plan' | 'topup'; plan: string | null; characters: number; amountIdr: number; mode: 'sandbox' | 'production'; status: string; granted: boolean; needsOperator: boolean; payUrl: string | null };

export function BillingReturnView() {
  const { t, locale } = useLocale();
  const params = useSearchParams(); const router = useRouter();
  const orderId = params.get('order') ?? params.get('order_id');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (!orderId) { setError(t('Nomor pesanan tidak ditemukan di tautan ini.', 'This link has no order number.')); return; }
    setBusy(true); setError('');
    try { setOrder(await request<Order>(`/api/payments/orders/${encodeURIComponent(orderId)}/refresh`, 'POST', undefined, newKey())); }
    catch (caught) {
      if (isUnauthenticated(caught)) { router.push(`/login?next=${encodeURIComponent(`/billing/return?order=${orderId}`)}`); return; }
      setError(errorText(caught, locale === 'en'));
    } finally { setBusy(false); }
  }, [locale, orderId, router, t]);
  useEffect(() => { void check(); }, [check]);

  const what = order ? (order.kind === 'plan' ? `${t('Paket', 'Plan')} ${order.plan ? order.plan[0]!.toUpperCase() + order.plan.slice(1) : ''}` : t(`Tambahan ${numberFormat(order.characters, 'id')} karakter`, `${numberFormat(order.characters, 'en')}-character top-up`)) : '';
  const view = !order ? null
    : order.status === 'paid' && order.granted ? { icon: CircleCheck, tone: 'text-brand-700', title: t('Pembayaran berhasil', 'Payment successful'), text: t(`${what} sudah aktif di akunmu.`, `${what} is active on your account.`) }
    : order.status === 'paid' && order.needsOperator ? { icon: CircleAlert, tone: 'text-amber-700', title: t('Pembayaran diterima', 'Payment received'), text: t('Pembayaranmu sudah kami terima, tetapi paketmu berubah sebelum pembayaran selesai. Tim kami akan menyesuaikannya dan menghubungimu.', 'We received your payment, but your plan changed before it completed. Our team will sort it out and contact you.') }
    : order.status === 'pending' ? { icon: Clock, tone: 'text-ink-600', title: t('Menunggu pembayaran', 'Waiting for payment'), text: t('Pembayaran belum kami terima. Selesaikan pembayaran atau cek lagi sebentar lagi.', 'We have not received the payment yet. Finish paying or check again shortly.') }
    : order.status === 'refunded' ? { icon: CircleAlert, tone: 'text-amber-700', title: t('Pembayaran dikembalikan', 'Payment refunded'), text: t('Pembayaran ini sudah dikembalikan.', 'This payment has been refunded.') }
    : { icon: CircleAlert, tone: 'text-red-700', title: t('Pembayaran tidak selesai', 'Payment not completed'), text: t('Pembayaran gagal, dibatalkan, atau kedaluwarsa. Tidak ada biaya yang ditarik untuk pesanan ini.', 'The payment failed, was cancelled, or expired. Nothing was charged for this order.') };
  const Icon = view?.icon;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-sm" aria-live="polite">
        <div className="mb-5 flex justify-center"><Logo compact /></div>
        {!view && !error && <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-ink-500"><Spinner size={16} />{t('Mengecek status pembayaran…', 'Checking the payment status…')}</div>}
        {error && <p className="py-4 text-sm text-red-700">{error}</p>}
        {view && Icon && <>
          <Icon size={36} className={`mx-auto ${view.tone}`} aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold text-ink-900">{view.title}</h1>
          <p className="mt-1.5 text-sm text-ink-600">{view.text}</p>
          <p className="mt-3 text-[12px] text-ink-500">{what} · Rp{numberFormat(order!.amountIdr, 'id')} · <span className="font-mono">{order!.id}</span>{order!.mode === 'sandbox' && ` · ${t('mode uji', 'test mode')}`}</p>
        </>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {order?.status === 'pending' && order.payUrl && <a className={buttonClass('primary')} href={order.payUrl}>{t('Lanjutkan pembayaran', 'Continue payment')}</a>}
          {(order?.status === 'pending' || error) && <Button icon={RotateCw} loading={busy} onClick={() => void check()}>{t('Cek lagi', 'Check again')}</Button>}
          <Link className={buttonClass(order?.status === 'paid' ? 'primary' : 'secondary')} href="/app">{t('Kembali ke Tulis Lab', 'Back to Tulis Lab')}</Link>
        </div>
      </section>
    </main>
  );
}
