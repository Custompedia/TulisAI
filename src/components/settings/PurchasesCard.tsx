'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, RotateCw } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { dateTime, numberFormat } from '@/lib/client/format';
import { errorText } from '@/lib/client/api';
import { authorizePurchase, listPurchases, productName, purchaseStatus, recoverPurchase, type PurchaseIntent, type Tone } from '@/lib/client/commerce';
import { Button, buttonClass } from '@/components/ui/Button';
import { useSessionGuard, useShell } from '@/components/app/AppShell';
import type { Notice } from './ProfileCard';

const TONE_CHIP: Record<Tone, string> = {
  info: 'bg-paper-deep text-ink-700', success: 'bg-brand-100 text-brand-800', warning: 'bg-amber-50 text-amber-800', error: 'bg-red-50 text-red-800',
};
// These can still move: MKL may confirm, close, or correct them. A delivered
// top-up also stays checkable, because MKL can still report a refund for it.
const OPEN = new Set(['created', 'checkout_pending', 'pending_payment', 'paid_awaiting_authority', 'reconciling', 'reconciliation_required']);

/**
 * Every purchase this account started, newest first, as recorded locally from
 * MKL's answers. "Periksa status" asks MKL again; nothing here marks anything
 * paid on its own.
 */
export function PurchasesCard({ notify }: { notify: (notice: Notice) => void }) {
  const { t, locale } = useLocale();
  const { refresh } = useShell();
  const guard = useSessionGuard();
  const en = locale === 'en';
  const [items, setItems] = useState<PurchaseIntent[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try { setItems(await listPurchases()); } catch (caught) { if (!guard(caught)) setFailed(caught); }
  }, [guard]);
  useEffect(() => { void load(); }, [load]);

  const check = async (purchase: PurchaseIntent) => {
    setBusy(purchase.purchaseId);
    try {
      const { intent, outcome } = await recoverPurchase(purchase.purchaseId);
      setItems((current) => current?.map((item) => (item.purchaseId === intent.purchaseId ? intent : item)) ?? current);
      if (outcome === 'reconciled') await refresh();
      if (outcome === 'retry') notify({ tone: 'error', title: t('Status belum terbaca', 'Status not read yet'), message: t('MKL belum bisa dibaca sekarang. Tidak ada yang berubah.', 'MKL could not be read right now. Nothing changed.') });
    } catch (caught) { if (!guard(caught)) notify({ tone: 'error', title: t('Status belum terbaca', 'Status not read yet'), message: errorText(caught, en) }); }
    finally { setBusy(null); }
  };

  const resume = async (purchase: PurchaseIntent) => {
    setBusy(purchase.purchaseId);
    try { window.location.assign(await authorizePurchase(purchase.purchaseId)); }
    catch (caught) { if (!guard(caught)) notify({ tone: 'error', title: t('Belum bisa melanjutkan', 'Could not continue'), message: errorText(caught, en) }); setBusy(null); }
  };

  if (failed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">{errorText(failed, en)}</p>
        <Button size="sm" icon={RotateCw} onClick={() => void load()}>{t('Muat ulang', 'Reload')}</Button>
      </div>
    );
  }
  if (!items) return <p role="status" className="text-sm text-ink-500">{t('Memuat pembelian…', 'Loading purchases…')}</p>;
  if (items.length === 0) return <p className="text-sm text-ink-500">{t('Belum ada pembelian. Paket dan tambahan karakter bisa dibeli dari menu Paket & kuota AI.', 'No purchases yet. Plans and character top-ups can be bought from Plans & AI allowance.')}</p>;

  return (
    <ul className="divide-y divide-line">
      {items.map((purchase) => {
        const status = purchaseStatus(purchase, t); const working = busy === purchase.purchaseId;
        return (
          <li key={purchase.purchaseId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-900">{productName(purchase.planCode, t)}<span className="ml-2 font-normal tabular-nums text-ink-500">Rp{numberFormat(purchase.offeredPriceIdr, 'id')}</span></p>
              <p className="mt-0.5 text-[12.5px] text-ink-500">
                {dateTime(purchase.createdAt, locale)}{purchase.orderNumber && <> · <span className="font-mono">{purchase.orderNumber}</span></>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${TONE_CHIP[status.tone]}`}>{status.label}</span>
              {purchase.authorizationRequired && <Button size="sm" variant="primary" loading={working} onClick={() => void resume(purchase)}>{t('Lanjutkan di MKL', 'Continue at MKL')}</Button>}
              {purchase.status === 'pending_payment' && purchase.checkoutUrl && <a href={purchase.checkoutUrl} className={buttonClass('primary', 'sm')}>{t('Buka pembayaran', 'Open payment')}<ArrowUpRight size={14} aria-hidden="true" /></a>}
              {(OPEN.has(purchase.status) || (purchase.kind === 'consumable' && purchase.status === 'reconciled')) && purchase.orderId && <Button size="sm" icon={RotateCw} loading={working} onClick={() => void check(purchase)}>{t('Periksa status', 'Check status')}</Button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
