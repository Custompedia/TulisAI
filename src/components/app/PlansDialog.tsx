'use client';
import { useState } from 'react';
import { Building2, Check, ChevronDown, Crown, Gauge, Leaf, Minus, Sparkles, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { AI_SCOPE_LIMIT, SELECTION_LIMIT } from '@/lib/writing/settings';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { useShell } from './AppShell';

type T = (id: string, en: string) => string;
type PlanId = 'free' | 'plus' | 'pro' | 'team';
type Plan = { id: PlanId; name: string; icon: LucideIcon; tagline: string; price: number; unit?: string; quota: string; inherits?: string; features: string[]; popular?: boolean };

// Mock catalogue until billing exists; the active plan comes from the account's tier.
// Only the Free quota and the two length limits are real numbers, read from the account and from the shared constants.
const FREE_REQUESTS = 100;
const chars = (value: number, t: T) => t(`${numberFormat(value, 'id')} karakter`, `${numberFormat(value, 'en')} characters`);

function plans(t: T, freeRequests: number): Plan[] {
  return [
    {
      id: 'free', name: t('Gratis', 'Free'), icon: Leaf, tagline: t('Untuk mencoba dan tugas ringan.', 'For trying it out and light tasks.'), price: 0,
      quota: t(`${numberFormat(freeRequests, 'id')} permintaan AI / bulan`, `${numberFormat(freeRequests, 'en')} AI requests / month`),
      features: [t('6 mode penulisan', '6 writing modes'), t(`Pilihan teks s.d. ${chars(SELECTION_LIMIT, t)}`, `Selections up to ${chars(SELECTION_LIMIT, t)}`), t(`Dokumen s.d. ${chars(AI_SCOPE_LIMIT, t)}`, `Documents up to ${chars(AI_SCOPE_LIMIT, t)}`), t('Maks. 10 notebook', 'Up to 10 notebooks'), t('Riwayat versi 7 hari', '7-day version history'), t('Analisis kualitas 5× / bulan', 'Quality analysis 5× / month')],
    },
    {
      id: 'plus', name: 'Plus', icon: Sparkles, tagline: t('Untuk mahasiswa yang rutin menulis.', 'For students who write regularly.'), price: 49_000,
      quota: t('500 permintaan AI / bulan', '500 AI requests / month'), inherits: t('Semua di Gratis, plus:', 'Everything in Free, plus:'),
      features: [t('Notebook tanpa batas', 'Unlimited notebooks'), t('Sesuaikan hasil & catatan untuk AI', 'Customize results & AI notes'), t('Riwayat versi 90 hari', '90-day version history'), t('Analisis kualitas 50× / bulan', 'Quality analysis 50× / month'), t('Ekspor DOCX & PDF', 'Export to DOCX & PDF')],
    },
    {
      id: 'pro', name: 'Pro', icon: Crown, tagline: t('Untuk skripsi, jurnal, dan pekerjaan.', 'For theses, journals, and work.'), price: 99_000, popular: true,
      quota: t('2.000 permintaan AI / bulan', '2,000 AI requests / month'), inherits: t('Semua di Plus, plus:', 'Everything in Plus, plus:'),
      features: [t('Riwayat versi tanpa batas', 'Unlimited version history'), t('Analisis kualitas tanpa batas', 'Unlimited quality analysis'), t('Antrean AI prioritas', 'Priority AI queue'), t('Istilah terkunci untuk semua notebook', 'Locked terms across all notebooks')],
    },
    {
      id: 'team', name: t('Tim', 'Team'), icon: Building2, tagline: t('Untuk lab riset, kelas, dan kantor.', 'For research labs, classes, and offices.'), price: 79_000, unit: t('/ anggota', '/ member'),
      quota: t('3.000 permintaan AI / anggota', '3,000 AI requests / member'), inherits: t('Semua di Pro, plus:', 'Everything in Pro, plus:'),
      features: [t('Ruang kerja & notebook bersama', 'Shared workspace & notebooks'), t('Peran admin dan anggota', 'Admin and member roles'), t('Panduan gaya & istilah tim', 'Team style guide & terms'), t('Tagihan terpusat', 'Centralised billing'), t('Minimal 3 anggota', 'Minimum 3 members')],
    },
  ];
}


type Cell = boolean | string;
type Row = { label: string; cells: [Cell, Cell, Cell, Cell] };
type Group = { title: string; rows: Row[] };

function groups(t: T, freeRequests: number): Group[] {
  const all = t('Semua', 'All');
  return [
    {
      title: t('Menulis ulang', 'Rewriting'),
      rows: [
        { label: t('Permintaan AI per bulan', 'AI requests per month'), cells: [numberFormat(freeRequests, 'id'), '500', '2.000', t('3.000 / anggota', '3,000 / member')] },
        { label: t('Mode penulisan', 'Writing modes'), cells: [t('6 mode', '6 modes'), t('6 mode', '6 modes'), t('6 mode', '6 modes'), t('6 mode', '6 modes')] },
        { label: t('Sesuaikan hasil & catatan untuk AI', 'Customize results & AI notes'), cells: [false, true, true, true] },
        { label: t('Aksi cepat pada teks terpilih', 'Quick actions on selected text'), cells: [true, true, true, true] },
        { label: t('Panjang teks terpilih', 'Selection length'), cells: [chars(SELECTION_LIMIT, t), chars(SELECTION_LIMIT, t), chars(SELECTION_LIMIT, t), chars(SELECTION_LIMIT, t)] },
        { label: t('Panjang dokumen sekali proses', 'Document length per run'), cells: [chars(AI_SCOPE_LIMIT, t), chars(AI_SCOPE_LIMIT, t), chars(AI_SCOPE_LIMIT, t), chars(AI_SCOPE_LIMIT, t)] },
      ],
    },
    {
      title: t('Menjaga tulisan', 'Refining'),
      rows: [
        { label: t('Istilah terkunci per notebook', 'Locked terms per notebook'), cells: [true, true, true, true] },
        { label: t('Istilah terkunci untuk semua notebook', 'Locked terms across all notebooks'), cells: [false, false, true, true] },
        { label: t('Analisis kualitas tulisan', 'Writing quality analysis'), cells: [t('5× / bulan', '5× / month'), t('50× / bulan', '50× / month'), t('Tanpa batas', 'Unlimited'), t('Tanpa batas', 'Unlimited')] },
        { label: t('Bandingkan versi', 'Compare versions'), cells: [true, true, true, true] },
      ],
    },
    {
      title: t('Notebook & riwayat', 'Notebooks & history'),
      rows: [
        { label: t('Jumlah notebook', 'Number of notebooks'), cells: ['10', t('Tanpa batas', 'Unlimited'), t('Tanpa batas', 'Unlimited'), t('Tanpa batas', 'Unlimited')] },
        { label: t('Riwayat versi', 'Version history'), cells: [t('7 hari', '7 days'), t('90 hari', '90 days'), t('Tanpa batas', 'Unlimited'), t('Tanpa batas', 'Unlimited')] },
        { label: t('Pulihkan versi lama', 'Restore old versions'), cells: [true, true, true, true] },
        { label: t('Ekspor DOCX & PDF', 'Export to DOCX & PDF'), cells: [false, true, true, true] },
      ],
    },
    {
      title: t('Tim & dukungan', 'Team & support'),
      rows: [
        { label: t('Ruang kerja & notebook bersama', 'Shared workspace & notebooks'), cells: [false, false, false, true] },
        { label: t('Peran admin dan anggota', 'Admin and member roles'), cells: [false, false, false, true] },
        { label: t('Panduan gaya & istilah tim', 'Team style guide & terms'), cells: [false, false, false, true] },
        { label: t('Tagihan terpusat', 'Centralised billing'), cells: [false, false, false, true] },
        { label: t('Antrean AI prioritas', 'Priority AI queue'), cells: [false, false, true, true] },
        { label: t('Dukungan', 'Support'), cells: [t('Pusat bantuan', 'Help centre'), t('Email', 'Email'), t('Email prioritas', 'Priority email'), all + t(' di Pro + orientasi tim', ' in Pro + team onboarding')] },
      ],
    },
  ];
}

function faqs(t: T): Array<[string, string]> {
  return [
    [t('Apa itu satu permintaan AI?', 'What counts as one AI request?'), t('Satu kali menjalankan AI: memperbaiki teks terpilih, satu paragraf, seluruh dokumen, atau satu analisis kualitas. Mengetik, menyimpan, dan membandingkan versi tidak memakai kuota.', 'One AI run: rewriting a selection, a paragraph, the whole document, or one quality analysis. Typing, saving, and comparing versions do not use quota.')],
    [t('Kalau kuota habis sebelum akhir bulan?', 'What if my quota runs out before the month ends?'), t('Tulisanmu tetap bisa dibuka, diedit, dan disimpan. Hanya fitur AI yang berhenti sampai kuota direset di awal bulan berikutnya, atau kamu naik paket.', 'Your writing stays open, editable, and saved. Only the AI features pause until the quota resets at the start of next month, or you upgrade.')],
    [t('Apakah kuota sisa dibawa ke bulan berikutnya?', 'Does unused quota roll over?'), t('Tidak. Kuota direset setiap awal bulan dan sisa kuota tidak diakumulasi.', 'No. Quota resets at the start of each month and unused requests do not accumulate.')],
    [t('Bisa pindah atau berhenti kapan saja?', 'Can I change or cancel anytime?'), t('Bisa. Naik paket berlaku langsung, turun paket berlaku di periode tagihan berikutnya, dan notebook-mu tidak dihapus saat kembali ke Gratis.', 'Yes. Upgrades apply immediately, downgrades apply next billing period, and your notebooks are not deleted when you return to Free.')],
    [t('Apakah tulisan saya dipakai untuk melatih AI?', 'Is my writing used to train AI?'), t('Tidak. Tulisanmu hanya diproses untuk menghasilkan permintaan yang kamu jalankan.', 'No. Your writing is only processed to produce the request you run.')],
  ];
}

function CellValue({ value, t }: { value: Cell; t: T }) {
  if (value === true) return <Check size={16} className="mx-auto text-brand-700" aria-label={t('Termasuk', 'Included')} />;
  if (value === false) return <Minus size={16} className="mx-auto text-ink-300" aria-label={t('Tidak termasuk', 'Not included')} />;
  return <span className="text-[12.5px] text-ink-700">{value}</span>;
}

export function PlansDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const { usage } = useShell();
  // An unlimited account (admin or override) is on no catalogue plan, so nothing is marked as its current plan.
  const unlimited = usage?.unlimited === true;
  const CURRENT: PlanId | null = unlimited ? null : usage?.tier ?? 'free';
  const freeRequests = usage && usage.tier === 'free' && !unlimited ? usage.requestLimit : FREE_REQUESTS;
  const catalogue = plans(t, freeRequests);
  const [notice, setNotice] = useState('');

  return (
    <Modal size="2xl" onClose={onClose} title={t('Paket & kuota AI', 'Plans & AI quota')}>
      {unlimited && <Alert tone="info" className="mb-4" title={t('Akses AI tanpa batas', 'Unlimited AI access')}>{t('Akun ini tidak memakai kuota paket, jadi tidak ada paket yang ditandai aktif. Katalog di bawah masih pratinjau.', 'This account does not use plan quota, so no plan is marked as active. The catalogue below is still a preview.')}</Alert>}
      {notice && <Alert tone="info" className="mb-4" onDismiss={() => setNotice('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Segera hadir', 'Coming soon')}>{t(`Pembayaran untuk paket ${notice} belum tersedia. Ini masih pratinjau paket.`, `Payment for the ${notice} plan is not available yet. This is a plan preview.`)}</Alert>}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {catalogue.map((plan) => {
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

      <section aria-label={t('Perbandingan fitur', 'Feature comparison')} className="mx-auto mt-10 w-full max-w-4xl">
        <h3 className="text-center text-[15px] font-semibold text-ink-900">{t('Bandingkan semua fitur', 'Compare all features')}</h3>
        <div className="scrollbar-thin mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-[38%] py-2 pr-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{t('Fitur', 'Feature')}</th>
                {catalogue.map((plan) => (
                  <th key={plan.id} scope="col" className="px-3 py-2 text-center text-[13px] font-semibold text-ink-900">{plan.name}{plan.id === CURRENT && <span className="ml-1.5 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800">{t('Saat ini', 'Current')}</span>}</th>
                ))}
              </tr>
            </thead>
            {groups(t, freeRequests).map((group) => (
              <tbody key={group.title}>
                <tr>
                  <th scope="colgroup" colSpan={5} className="pb-1.5 pt-5 text-[12px] font-semibold text-brand-800">{group.title}</th>
                </tr>
                {group.rows.map((row, index) => (
                  <tr key={row.label} className={index % 2 === 1 ? 'bg-paper/60' : ''}>
                    <th scope="row" className="rounded-l-lg py-2 pl-2 pr-3 text-[12.5px] font-normal text-ink-700">{row.label}</th>
                    {row.cells.map((cell, column) => (
                      <td key={column} className={`px-3 py-2 text-center ${column === 3 ? 'rounded-r-lg' : ''}`}><CellValue value={cell} t={t} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <section aria-label="FAQ" className="mx-auto mt-10 w-full max-w-3xl">
        <h3 className="text-center text-[15px] font-semibold text-ink-900">{t('Pertanyaan yang sering muncul', 'Frequently asked questions')}</h3>
        <div className="mt-4 divide-y divide-line border-y border-line">
          {faqs(t).map(([question, answer]) => (
            <details key={question} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 py-3 text-[13.5px] font-medium text-ink-800 marker:hidden hover:text-ink-950">
                <span className="min-w-0 flex-1">{question}</span>
                <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="pb-3.5 pr-7 text-[12.5px] leading-relaxed text-ink-600">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="mx-auto mt-8 flex w-full max-w-4xl flex-col gap-1.5 border-t border-line pt-4 text-[11.5px] text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>{t('Harga dalam Rupiah, sudah termasuk pajak. Kuota direset setiap awal bulan.', 'Prices in Rupiah, tax included. Quota resets at the start of each month.')}</p>
        <p>{t('Semua paket mendapat pembaruan fitur tanpa biaya tambahan.', 'Every plan gets feature updates at no extra cost.')}</p>
      </footer>
    </Modal>
  );
}
