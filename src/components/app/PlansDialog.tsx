'use client';
import { useState } from 'react';
import { Building2, Check, Crown, Gauge, Leaf, Sparkles, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';

type T = (id: string, en: string) => string;
type PlanId = 'free' | 'plus' | 'pro' | 'team';
type Plan = { id: PlanId; name: string; icon: LucideIcon; tagline: string; price: number; unit?: string; quota: string; inherits?: string; features: string[]; popular?: boolean };

// Mock catalogue until billing exists; the current plan is always Free.
const CURRENT: PlanId = 'free';

function plans(t: T): Plan[] {
  return [
    {
      id: 'free', name: t('Gratis', 'Free'), icon: Leaf, tagline: t('Untuk mencoba dan tugas ringan.', 'For trying it out and light tasks.'), price: 0,
      quota: t('100 permintaan AI / bulan', '100 AI requests / month'),
      features: [t('6 mode penulisan', '6 writing modes'), t('Pilihan teks s.d. 5.000 karakter', 'Selections up to 5,000 characters'), t('Dokumen s.d. 20.000 karakter', 'Documents up to 20,000 characters'), t('Maks. 10 notebook', 'Up to 10 notebooks'), t('Riwayat versi 7 hari', '7-day version history'), t('Analisis kualitas 5× / bulan', 'Quality analysis 5× / month')],
    },
    {
      id: 'plus', name: 'Plus', icon: Sparkles, tagline: t('Untuk mahasiswa yang rutin menulis.', 'For students who write regularly.'), price: 49_000,
      quota: t('500 permintaan AI / bulan', '500 AI requests / month'), inherits: t('Semua di Gratis, plus:', 'Everything in Free, plus:'),
      features: [t('Notebook tanpa batas', 'Unlimited notebooks'), t('Sesuaikan hasil & catatan untuk AI', 'Customize results & AI notes'), t('Riwayat versi 90 hari', '90-day version history'), t('Analisis kualitas 50× / bulan', 'Quality analysis 50× / month'), t('Ekspor DOCX & PDF', 'Export to DOCX & PDF')],
    },
    {
      id: 'pro', name: 'Pro', icon: Crown, tagline: t('Untuk skripsi, jurnal, dan pekerjaan.', 'For theses, journals, and work.'), price: 99_000, popular: true,
      quota: t('2.000 permintaan AI / bulan', '2,000 AI requests / month'), inherits: t('Semua di Plus, plus:', 'Everything in Plus, plus:'),
      features: [t('Dokumen s.d. 50.000 karakter', 'Documents up to 50,000 characters'), t('Riwayat versi tanpa batas', 'Unlimited version history'), t('Analisis kualitas tanpa batas', 'Unlimited quality analysis'), t('Antrean AI prioritas', 'Priority AI queue'), t('Istilah terkunci untuk semua notebook', 'Locked terms across all notebooks')],
    },
    {
      id: 'team', name: t('Tim', 'Team'), icon: Building2, tagline: t('Untuk lab riset, kelas, dan kantor.', 'For research labs, classes, and offices.'), price: 79_000, unit: t('/ anggota', '/ member'),
      quota: t('3.000 permintaan AI / anggota', '3,000 AI requests / member'), inherits: t('Semua di Pro, plus:', 'Everything in Pro, plus:'),
      features: [t('Ruang kerja & notebook bersama', 'Shared workspace & notebooks'), t('Peran admin dan anggota', 'Admin and member roles'), t('Panduan gaya & istilah tim', 'Team style guide & terms'), t('Tagihan terpusat', 'Centralised billing'), t('Minimal 3 anggota', 'Minimum 3 members')],
    },
  ];
}

export function PlansDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [notice, setNotice] = useState('');

  return (
    <Modal size="2xl" onClose={onClose} title={t('Paket & kuota AI', 'Plans & AI quota')} description={t('Harga dalam Rupiah, sudah termasuk pajak. Kuota tidak terpakai tidak dibawa ke bulan berikutnya.', 'Prices in Rupiah, tax included. Unused quota does not roll over to the next month.')}>
      {notice && <Alert tone="info" className="mb-4" onDismiss={() => setNotice('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Segera hadir', 'Coming soon')}>{t(`Pembayaran untuk paket ${notice} belum tersedia. Ini masih pratinjau paket.`, `Payment for the ${notice} plan is not available yet. This is a plan preview.`)}</Alert>}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans(t).map((plan) => {
          const Icon = plan.icon; const current = plan.id === CURRENT; const { price } = plan;
          return (
            <li key={plan.id} className={`relative flex flex-col rounded-2xl border bg-white p-4 ${plan.popular ? 'border-brand-600 ring-1 ring-brand-600' : current ? 'border-brand-300 bg-brand-50/40' : 'border-line'}`}>
              <div className="flex items-center gap-2">
                <span className={`grid h-8 w-8 place-items-center rounded-lg ${plan.popular ? 'bg-brand-800 text-white' : 'bg-brand-50 text-brand-700'}`}><Icon size={16} aria-hidden="true" /></span>
                <h3 className="flex-1 text-[15px] font-semibold text-ink-900">{plan.name}</h3>
                {current && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">{t('Paket saat ini', 'Current plan')}</span>}
                {plan.popular && <span className="rounded-full bg-brand-800 px-2 py-0.5 text-[11px] font-semibold text-white">{t('Populer', 'Popular')}</span>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{plan.tagline}</p>

              <p className="mt-2.5 flex items-baseline gap-1">
                <span className="text-2xl font-semibold tracking-tight text-ink-950">{price === 0 ? 'Rp0' : `Rp${numberFormat(price, 'id')}`}</span>
                {price > 0 && <span className="text-xs text-ink-500">{plan.unit ?? ''} {t('/ bulan', '/ month')}</span>}
              </p>

              <p className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-paper px-2.5 py-1.5 text-[12.5px] font-medium text-ink-800"><Gauge size={14} className="shrink-0 text-brand-700" aria-hidden="true" />{plan.quota}</p>

              <div className="mt-2.5 flex-1">
                {plan.inherits && <p className="mb-1.5 text-[11.5px] font-medium text-ink-500">{plan.inherits}</p>}
                <ul className="space-y-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-700"><Check size={14} className="mt-px shrink-0 text-brand-600" aria-hidden="true" />{feature}</li>
                  ))}
                </ul>
              </div>

              <button type="button" disabled={current} onClick={() => setNotice(plan.name)}
                className={`mt-3.5 inline-flex h-9 w-full items-center justify-center rounded-full text-[13px] font-semibold transition-colors disabled:cursor-default ${current ? 'bg-paper-deep text-ink-400' : plan.popular ? `${raisedGreen} ${pressGreen}` : 'border border-line-strong bg-white text-ink-800 hover:border-ink-300 hover:text-ink-950'}`}>
                {current ? t('Paket saat ini', 'Current plan') : plan.id === 'team' ? t('Hubungi kami', 'Contact us') : t(`Pilih ${plan.name}`, `Choose ${plan.name}`)}
              </button>
            </li>
          );
        })}
      </ul>

    </Modal>
  );
}
