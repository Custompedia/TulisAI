'use client';
import { useState } from 'react';
import { Check, ChevronDown, Crown, Gauge, Leaf, Minus, Rocket, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { PLAN_LIMITS, TIERS, TOP_UPS, TOP_UP_VALIDITY_MONTHS, type Tier } from '@/lib/plans';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { useShell } from './AppShell';

type T = (id: string, en: string) => string;
type Plan = { id: Tier; name: string; icon: LucideIcon; tagline: string; quota: string; inherits?: string; features: string[]; popular?: boolean };
type Cells = [string | boolean, string | boolean, string | boolean, string | boolean];

// Prices, allowances and gates all come from PLAN_LIMITS, so this catalogue cannot drift from what the server enforces.
// Payment is not wired yet: the buttons say so instead of pretending to sell.
const FREE_CHARACTERS = PLAN_LIMITS.free.includedCharacters;
const chars = (value: number, t: T) => t(`${numberFormat(value, 'id')} karakter`, `${numberFormat(value, 'en')} characters`);
const perRun = (tier: Tier, t: T) => t(`Sekali proses s.d. ${chars(PLAN_LIMITS[tier].runLimit, t)}`, `Up to ${chars(PLAN_LIMITS[tier].runLimit, t)} per run`);
const allowance = (tier: Tier, t: T, freeCharacters: number) => (tier === 'free'
  ? t(`${numberFormat(freeCharacters, 'id')} karakter AI sekali pakai`, `${numberFormat(freeCharacters, 'en')} one-time AI characters`)
  : t(`${numberFormat(PLAN_LIMITS[tier].includedCharacters, 'id')} karakter AI / periode`, `${numberFormat(PLAN_LIMITS[tier].includedCharacters, 'en')} AI characters / period`));

function plans(t: T, freeCharacters: number): Plan[] {
  return [
    {
      id: 'free', name: t('Gratis', 'Free'), icon: Leaf, tagline: t('Coba TulisAI sekali jalan.', 'Try TulisAI once.'), quota: allowance('free', t, freeCharacters),
      features: [t('6 mode penulisan', '6 writing modes'), perRun('free', t), t('Aksi cepat pada teks terpilih', 'Quick actions on selected text'), t('Riwayat versi & bandingkan', 'Version history & compare'), t('Editor tetap bisa dipakai setelah jatah habis', 'The editor keeps working after the allowance runs out')],
    },
    {
      id: 'plus', name: 'Plus', icon: Sparkles, tagline: t('Untuk yang rutin menulis ulang.', 'For regular rewriting.'), quota: allowance('plus', t, freeCharacters),
      inherits: t('Semua di Gratis, plus:', 'Everything in Free, plus:'),
      features: [perRun('plus', t), t('Kuota AI isi ulang tiap periode', 'AI allowance refills every period'), t('Skills & gaya tulisan tersimpan', 'Saved Skills & writing styles'), t('Bisa beli tambahan karakter', 'Can buy extra characters')],
    },
    {
      id: 'pro', name: 'Pro', icon: Crown, tagline: t('Untuk dokumen panjang dan skripsi.', 'For long documents and theses.'), quota: allowance('pro', t, freeCharacters), popular: true,
      inherits: t('Semua di Plus, plus:', 'Everything in Plus, plus:'),
      features: [perRun('pro', t), t('Ruang kerja dokumen lanjutan', 'Advanced document workspace'), t('Impor & ekspor DOCX', 'DOCX import & export'), t('Atur halaman, header, dan footer', 'Page, header, and footer controls')],
    },
    {
      id: 'max', name: 'Max', icon: Rocket, tagline: t('Untuk kontrol penuh atas hasil AI.', 'For full control over AI results.'), quota: allowance('max', t, freeCharacters),
      inherits: t('Semua di Pro, plus:', 'Everything in Pro, plus:'),
      features: [t('AI Mode: perintah bebas pada teks terpilih', 'AI Mode: free-form instructions on selected text'), t('Catatan & instruksi khusus untuk AI', 'Custom AI notes & instructions'), t('Contoh tulisan sebagai acuan gaya', 'Writing sample as a style reference'), t('Kuota AI terbesar', 'The largest AI allowance')],
    },
  ];
}

// Everything here already runs today, and every paid row is enforced on the server, not only in the interface.
function groups(t: T, freeCharacters: number): Array<{ title: string; rows: Array<{ label: string; cells: Cells }> }> {
  const modes = t('6 mode', '6 modes');
  return [
    {
      title: t('Kuota AI', 'AI allowance'),
      rows: [
        { label: t('Karakter AI termasuk', 'Included AI characters'), cells: [t(`${numberFormat(freeCharacters, 'id')} sekali pakai`, `${numberFormat(freeCharacters, 'en')} one-time`), chars(PLAN_LIMITS.plus.includedCharacters, t), chars(PLAN_LIMITS.pro.includedCharacters, t), chars(PLAN_LIMITS.max.includedCharacters, t)] },
        { label: t('Isi ulang tiap periode', 'Refills every period'), cells: [false, true, true, true] },
        { label: t('Panjang teks sekali proses', 'Text length per run'), cells: TIERS.map((tier) => chars(PLAN_LIMITS[tier].runLimit, t)) as Cells },
      ],
    },
    {
      title: t('Menulis ulang', 'Rewriting'),
      rows: [
        { label: t('Mode penulisan', 'Writing modes'), cells: [modes, modes, modes, modes] },
        { label: t('Aksi cepat pada teks terpilih', 'Quick actions on selected text'), cells: [true, true, true, true] },
        { label: t('Istilah terkunci & pelindung angka', 'Locked terms & number protection'), cells: [true, true, true, true] },
        { label: t('Skills & gaya tulisan tersimpan', 'Saved Skills & writing styles'), cells: [false, true, true, true] },
        { label: t('AI Mode: perintah bebas pada teks terpilih', 'AI Mode: free-form instructions on selected text'), cells: [false, false, false, true] },
      ],
    },
    {
      title: t('Notebook & dokumen', 'Notebooks & documents'),
      rows: [
        { label: t('Riwayat versi & bandingkan', 'Version history & compare'), cells: [true, true, true, true] },
        { label: t('Ruang kerja dokumen lanjutan', 'Advanced document workspace'), cells: [false, false, true, true] },
        { label: t('Impor DOCX', 'DOCX import'), cells: [false, false, true, true] },
        { label: t('Ekspor DOCX', 'DOCX export'), cells: [false, false, true, true] },
      ],
    },
  ];
}

function faqs(t: T): Array<[string, string]> {
  return [
    [t('Bagaimana karakter AI dihitung?', 'How are AI characters counted?'), t('Yang dihitung adalah teks sumber yang benar-benar diproses — kalau kamu memilih 2.000 karakter dari dokumen 30.000 karakter, yang terpotong 2.000. Khusus AI Mode, yang dihitung adalah yang lebih besar antara teks sumber dan hasil yang dikeluarkan. Mengetik, menyimpan, impor/ekspor tanpa AI, dan membandingkan versi tidak memakai kuota.', 'It counts the source text actually processed — select 2,000 characters inside a 30,000-character document and 2,000 are charged. AI Mode is charged the larger of the source text and the generated result. Typing, saving, importing or exporting without AI, and comparing versions never use the allowance.')],
    [t('Kalau hasilnya gagal atau ditolak?', 'What if a run fails or is refused?'), t('Tidak ada karakter yang terpotong. Kegagalan provider, hasil yang ditolak pemeriksaan keamanan, dan perbaikan otomatis kami tanggung sendiri. Menekan “buat ulang” dihitung sebagai pemakaian baru.', 'Nothing is charged. Provider failures, results refused by the safety checks, and our own automatic repair are on us. Pressing “generate again” counts as new usage.')],
    [t('Apa bedanya jatah Gratis dan paket berbayar?', 'How does the Free allowance differ from a paid plan?'), t(`Gratis mendapat ${numberFormat(PLAN_LIMITS.free.includedCharacters, 'id')} karakter sekali saja per akun, tidak diisi ulang. Paket berbayar diisi ulang setiap periode langganan.`, `Free gets ${numberFormat(PLAN_LIMITS.free.includedCharacters, 'en')} characters once per account and they are not refilled. Paid plans refill every billing period.`)],
    [t('Sisa kuota dibawa ke periode berikutnya?', 'Does unused allowance roll over?'), t('Tidak. Kuota langganan direset tiap periode. Karakter tambahan yang kamu beli berlaku 12 bulan sejak pembelian dan baru dipakai setelah kuota langganan habis.', 'No. Subscription allowance resets every period. Characters you buy stay valid for 12 months from purchase and are only used after the subscription allowance is spent.')],
    [t('Kalau kuota habis atau langganan berakhir?', 'What if the allowance runs out or the plan ends?'), t('Tulisanmu tetap bisa dibuka, diedit, disimpan, dan diekspor. Yang berhenti hanya fitur AI dan fitur berbayar, sampai kuota terisi lagi atau kamu memperpanjang. Tidak ada dokumen yang dihapus.', 'Your writing stays open, editable, saved, and exportable. Only the AI and paid features pause until the allowance refills or you renew. No document is ever deleted.')],
    [t('Apakah perpanjangan otomatis?', 'Does it renew automatically?'), t('Belum. Perpanjangan dilakukan manual, tidak ada penarikan berulang, dan akses tetap berjalan sampai akhir periode yang sudah dibayar.', 'Not yet. Renewal is manual, there is no recurring charge, and access runs to the end of the period you paid for.')],
    [t('Apakah tulisan saya dipakai untuk melatih AI?', 'Is my writing used to train AI?'), t('Tidak. Tulisanmu hanya diproses untuk menghasilkan permintaan yang kamu jalankan.', 'No. Your writing is only processed to produce the request you run.')],
  ];
}

function CellValue({ value, t }: { value: string | boolean; t: T }) {
  if (value === true) return <Check size={16} className="mx-auto text-brand-700" aria-label={t('Termasuk', 'Included')} />;
  if (value === false) return <Minus size={16} className="mx-auto text-ink-300" aria-label={t('Tidak termasuk', 'Not included')} />;
  return <span className="text-[12.5px] text-ink-700">{value}</span>;
}

export function PlansDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const { usage } = useShell();
  // An unlimited account (admin or override) is on no catalogue plan, so nothing is marked as its current plan.
  const unlimited = usage?.unlimited === true;
  const CURRENT: Tier | null = unlimited ? null : usage?.tier ?? 'free';
  const freeCharacters = usage && usage.tier === 'free' && !unlimited ? usage.characterLimit : FREE_CHARACTERS;
  const catalogue = plans(t, freeCharacters);
  const [notice, setNotice] = useState('');

  return (
    <Modal size="2xl" onClose={onClose} title={t('Paket & kuota AI', 'Plans & AI allowance')}>
      {unlimited && <Alert tone="info" className="mb-4" title={t('Akses AI tanpa batas', 'Unlimited AI access')}>{t('Akun ini tidak memakai kuota paket, jadi tidak ada paket yang ditandai aktif.', 'This account does not use plan allowance, so no plan is marked as active.')}</Alert>}
      {notice && <Alert tone="info" className="mb-4" onDismiss={() => setNotice('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Pembayaran belum tersedia', 'Payment is not available yet')}>{t(`Paket ${notice} belum bisa dibeli dari dalam aplikasi. Hubungi kami untuk mengaktifkannya.`, `The ${notice} plan cannot be bought in-app yet. Contact us to activate it.`)}</Alert>}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {catalogue.map((plan) => {
          const Icon = plan.icon; const current = plan.id === CURRENT; const price = PLAN_LIMITS[plan.id].priceIdr;
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
                {price > 0 && <span className="text-xs text-ink-500">{t('/ periode', '/ period')}</span>}
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

              <button type="button" disabled={current || plan.id === 'free'} onClick={() => setNotice(plan.name)}
                className={`mt-3.5 inline-flex h-9 w-full items-center justify-center rounded-full text-[13px] font-semibold transition-colors disabled:cursor-default ${current || plan.id === 'free' ? 'bg-paper-deep text-ink-400' : plan.popular ? `${raisedGreen} ${pressGreen}` : 'border border-line-strong bg-white text-ink-800 hover:border-ink-300 hover:text-ink-950'}`}>
                {current ? t('Paket saat ini', 'Current plan') : plan.id === 'free' ? t('Termasuk', 'Included') : t(`Pilih ${plan.name}`, `Choose ${plan.name}`)}
              </button>
            </li>
          );
        })}
      </ul>

      <section aria-label={t('Tambahan karakter', 'Character top-up')} className="mx-auto mt-10 w-full max-w-4xl rounded-2xl border border-line bg-paper/60 p-4">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-700"><Wallet size={16} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink-900">{t('Kurang karakter di tengah periode?', 'Out of characters mid-period?')}</h3>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-600">{t(`Tambahan karakter bisa dibeli di paket Plus, Pro, dan Max. Isinya kuota AI saja — tidak membuka fitur paket yang lebih tinggi. Berlaku ${TOP_UP_VALIDITY_MONTHS} bulan sejak pembelian dan baru terpakai setelah kuota langganan habis. Pembelian belum bisa dilakukan dari dalam aplikasi.`, `Extra characters can be bought on Plus, Pro, and Max. They add AI allowance only — they never unlock a higher plan's features. Valid for ${TOP_UP_VALIDITY_MONTHS} months from purchase and used only after the subscription allowance is spent. Buying is not available in-app yet.`)}</p>
          </div>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {TOP_UPS.map((pack) => (
            <li key={pack.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2">
              <span className="text-[13px] font-semibold text-ink-900">Rp{numberFormat(pack.priceIdr, 'id')}</span>
              <span className="text-[12.5px] text-ink-600">{chars(pack.characters, t)}</span>
            </li>
          ))}
        </ul>
      </section>

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
            {groups(t, freeCharacters).map((group) => (
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
          <p className="mt-3 text-[12px] text-ink-500">
            {t('Semua yang tercantum sudah berjalan sekarang, dan setiap baris berbayar dijaga di server — bukan hanya disembunyikan di tampilan.', 'Everything listed here already works today, and every paid row is enforced on the server — not merely hidden in the interface.')}
          </p>
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
        <p>{t('Harga dalam Rupiah, sudah termasuk pajak. Perpanjangan manual, tanpa penarikan otomatis.', 'Prices in Rupiah, tax included. Renewal is manual, with no automatic charge.')}</p>
        <p>{t('Semua paket mendapat pembaruan fitur tanpa biaya tambahan.', 'Every plan gets feature updates at no extra cost.')}</p>
      </footer>
    </Modal>
  );
}
