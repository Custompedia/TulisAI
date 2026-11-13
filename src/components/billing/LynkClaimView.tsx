'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, RotateCw } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, isUnauthenticated, request } from '@/lib/client/api';
import { dateTime } from '@/lib/client/format';
import { lynkProduct, type LynkProductKey } from '@/lib/lynk-products';
import { Logo } from '@/components/ui/Logo';
import { Button, buttonClass } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

type Claim = { status: 'granted' | 'needs_operator'; product: LynkProductKey; orderId: string; paidThrough: string | null };

// Opened from the email Tulis Lab sends after a Lynk payment whose email had no verified account yet. A signed-out
// visitor is sent to sign in (or sign up) and comes back here; the signed-in account then receives the purchase.
export function LynkClaimView() {
  const { t, locale } = useLocale();
  const params = useSearchParams(); const router = useRouter();
  const ref = params.get('ref') ?? ''; const token = params.get('t') ?? '';
  const [claim, setClaim] = useState<Claim | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!ref || !token) { setError(t('Link aktivasi ini tidak lengkap. Buka lagi link dari email pembelianmu.', 'This activation link is incomplete. Open the link from your purchase email again.')); return; }
    setBusy(true); setError('');
    try { setClaim(await request<Claim>('/api/lynk/claim', 'POST', { ref, token })); }
    catch (caught) {
      if (isUnauthenticated(caught)) { router.push(`/login?next=${encodeURIComponent(`/billing/lynk?ref=${encodeURIComponent(ref)}&t=${token}`)}`); return; }
      setError(errorText(caught, locale === 'en'));
    } finally { setBusy(false); }
  }, [locale, ref, router, t, token]);
  useEffect(() => { void run(); }, [run]);

  const product = claim ? lynkProduct(claim.product) : null;
  const what = !product ? '' : product.kind === 'plan'
    ? t(`Paket ${product.plan[0]!.toUpperCase()}${product.plan.slice(1)} (${product.months === 12 ? '1 tahun' : '1 bulan'})`, `${product.plan[0]!.toUpperCase()}${product.plan.slice(1)} plan (${product.months === 12 ? '1 year' : '1 month'})`)
    : t('Tambahan karakter', 'Character top-up');
  const done = claim?.status === 'granted';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-sm" aria-live="polite">
        <div className="mb-5 flex justify-center"><Logo compact /></div>
        {!claim && !error && <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-ink-500"><Spinner size={16} />{t('Mengaktifkan pembelianmu…', 'Activating your purchase…')}</div>}
        {error && <>
          <CircleAlert size={36} className="mx-auto text-red-700" aria-hidden="true" />
          <p className="mt-3 text-sm text-red-700">{error}</p>
        </>}
        {claim && <>
          {done ? <CircleCheck size={36} className="mx-auto text-brand-700" aria-hidden="true" /> : <CircleAlert size={36} className="mx-auto text-amber-700" aria-hidden="true" />}
          <h1 className="mt-3 text-lg font-semibold text-ink-900">{done ? t('Pembelian aktif', 'Purchase active') : t('Pembayaran diterima', 'Payment received')}</h1>
          <p className="mt-1.5 text-sm text-ink-600">{done
            ? (product?.kind === 'plan' && claim.paidThrough ? t(`${what} aktif di akunmu sampai ${dateTime(claim.paidThrough, 'id')}.`, `${what} is active on your account until ${dateTime(claim.paidThrough, 'en')}.`) : t(`${what} sudah masuk ke akunmu.`, `${what} has been added to your account.`))
            : t('Akunmu sedang memakai paket lain, jadi pembelian ini belum dipasang otomatis. Tim kami akan menyesuaikannya dan menghubungimu.', 'Your account is on another plan, so this purchase was not applied automatically. Our team will sort it out and contact you.')}</p>
        </>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {error && <Button icon={RotateCw} loading={busy} onClick={() => void run()}>{t('Coba lagi', 'Try again')}</Button>}
          <Link className={buttonClass(done ? 'primary' : 'secondary')} href="/app">{t('Buka Tulis Lab', 'Open Tulis Lab')}</Link>
        </div>
      </section>
    </main>
  );
}
