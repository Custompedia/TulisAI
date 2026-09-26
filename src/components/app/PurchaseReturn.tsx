'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RotateCw } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { ApiError, errorText } from '@/lib/client/api';
import { authorizePurchase, isSettledOutcome, outcomeNotice, recoverPurchase, type PurchaseIntent, type RecoveryOutcome, type Tone } from '@/lib/client/commerce';
import { Button, buttonClass } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { useSessionGuard, useShell } from './AppShell';

type View = { purchaseId: string; tone: Tone; title: string; message: string; outcome: RecoveryOutcome | null; intent: PurchaseIntent | null };

// Waits between automatic re-reads while MKL has not decided yet: 5s, 10s, 20s, 40s, then only on request.
const POLL_DELAYS_MS = [5_000, 10_000, 20_000, 40_000];

/**
 * Shown when MKL sends the buyer back (`/app?purchase=…`). The URL only names
 * the purchase: its status is always read again from the owner-scoped recovery
 * route, so a crafted link can never make a purchase look paid.
 */
export function PurchaseReturn() {
  const { t, locale } = useLocale();
  const { refresh } = useShell();
  const guard = useSessionGuard();
  const en = locale === 'en';
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async (purchaseId: string, attempt: number) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setBusy(true);
    try {
      const { intent, outcome } = await recoverPurchase(purchaseId);
      setView({ purchaseId, ...outcomeNotice(outcome, intent.kind, t), outcome, intent });
      if (outcome === 'reconciled') await refresh();
      else if (!isSettledOutcome(outcome) && outcome !== 'authorization_required' && attempt < POLL_DELAYS_MS.length) {
        timer.current = setTimeout(() => void check(purchaseId, attempt + 1), POLL_DELAYS_MS[attempt]);
      }
    } catch (caught) {
      if (!guard(caught)) setView({ purchaseId, tone: 'error', title: t('Status pembelian belum terbaca', 'Could not read the purchase status'), message: errorText(caught, en), outcome: null, intent: null });
    } finally { setBusy(false); }
  }, [en, guard, refresh, t]);

  useEffect(() => {
    const url = new URL(window.location.href); const purchaseId = url.searchParams.get('purchase'); const error = url.searchParams.get('purchase_error');
    if (!purchaseId) return;
    for (const name of ['purchase', 'purchase_status', 'purchase_error']) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (error) setView({ purchaseId, tone: 'error', title: t('Pembelian belum berlanjut', 'The purchase did not continue'), message: errorText(new ApiError(error, 400), en), outcome: null, intent: null });
    else void check(purchaseId, 0);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // Read once per arrival; `check` changes identity with the locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resume = async (purchaseId: string) => {
    setBusy(true);
    try { window.location.assign(await authorizePurchase(purchaseId)); }
    catch (caught) { if (!guard(caught)) setView((current) => current && { ...current, tone: 'error', title: t('Belum bisa melanjutkan', 'Could not continue'), message: errorText(caught, en) }); setBusy(false); }
  };

  if (!view) return null;
  const dismiss = () => { if (timer.current) clearTimeout(timer.current); setView(null); };
  const payable = view.intent?.status === 'pending_payment' && view.intent.checkoutUrl;
  return (
    <Toast tone={view.tone} title={view.title} duration={view.outcome === 'reconciled' ? 8000 : undefined} onDismiss={dismiss} dismissLabel={t('Tutup', 'Dismiss')}
      actions={<>
        {view.outcome === 'authorization_required' && <Button size="sm" variant="primary" loading={busy} onClick={() => void resume(view.purchaseId)}>{t('Lanjutkan di MKL', 'Continue at MKL')}</Button>}
        {payable && <a href={view.intent!.checkoutUrl!} className={buttonClass('primary', 'sm')}>{t('Buka pembayaran', 'Open payment')}<ArrowUpRight size={14} aria-hidden="true" /></a>}
        {view.outcome !== 'reconciled' && view.outcome !== 'authorization_required' && <Button size="sm" icon={RotateCw} loading={busy} onClick={() => void check(view.purchaseId, POLL_DELAYS_MS.length)}>{t('Periksa lagi', 'Check again')}</Button>}
        <a href="/settings#pembelian" className={buttonClass('secondary', 'sm')}>{t('Lihat pembelian', 'View purchases')}</a>
      </>}>
      {view.message}
    </Toast>
  );
}
