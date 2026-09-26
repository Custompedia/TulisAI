'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, Crown, Gauge, Leaf, Minus, RotateCw, Rocket, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { errorText, newKey } from '@/lib/client/api';
import { beginPurchase, blockedLabel, loadCatalog, phoneLooksValid, productName, type CatalogProduct, type CommerceCatalog, type PlanCode } from '@/lib/client/commerce';
import { PLAN_LIMITS, TIERS, TOP_UPS, TOP_UP_VALIDITY_MONTHS, type Tier, type TopUp } from '@/lib/plans';
import { Button, pressGreen, raisedGreen } from '@/components/ui/Button';
import { FieldLabel, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { useSessionGuard, useShell } from './AppShell';

type T = (id: string, en: string) => string;
type Plan = { id: Tier; name: string; icon: LucideIcon; tagline: string; quota: string; inherits?: string; features: string[]; popular?: boolean };
type Cells = [string | boolean, string | boolean, string | boolean, string | boolean];

// Prices, allowances and gates all come from PLAN_LIMITS, so this catalogue cannot drift from what the server enforces.
// Whether something can be bought right now comes only from /api/commerce/offers; MKL takes the payment.
const FREE_CHARACTERS = PLAN_LIMITS.free.includedCharacters;
const chars = (value: number, t: T) => t(`${numberFormat(value, 'id')} karakter`, `${numberFormat(value, 'en')} characters`);
const perRun = (tier: Tier, t: T) => t(`Sekali proses s.d. ${chars(PLAN_LIMITS[tier].runLimit, t)}`, `Up to ${chars(PLAN_LIMITS[tier].runLimit, t)} per run`);
const allowance = (tier: Tier, t: T, freeCharacters: number) => (tier === 'free'
  ? t(`${numberFormat(freeCharacters, 'id')} karakter AI sekali pakai`, `${numberFormat(freeCharacters, 'en')} one-time AI characters`)
  : t(`${numberFormat(PLAN_LIMITS[tier].includedCharacters, 'id')} karakter AI / bulan`, `${numberFormat(PLAN_LIMITS[tier].includedCharacters, 'en')} AI characters / month`));

function plans(t: T, freeCharacters: number): Plan[] {
  return [
    {
      id: 'free', name: t('Gratis', 'Free'), icon: Leaf, tagline: t('Coba TulisAI sekali jalan.', 'Try TulisAI once.'), quota: allowance('free', t, freeCharacters),
      features: [t('6 mode penulisan', '6 writing modes'), perRun('free', t), t('Aksi cepat pada teks terpilih', 'Quick actions on selected text'), t('Riwayat versi & bandingkan', 'Version history & compare'), t('Editor tetap bisa dipakai setelah jatah habis', 'The editor keeps working after the allowance runs out')],
    },
    {
      id: 'plus', name: 'Plus', icon: Sparkles, tagline: t('Untuk yang rutin menulis ulang.', 'For regular rewriting.'), quota: allowance('plus', t, freeCharacters),
      inherits: t('Semua di Gratis, plus:', 'Everything in Free, plus:'),
      features: [perRun('plus', t), t('Kuota AI baru tiap periode paket', 'A fresh AI allowance every plan period'), t('Skills & gaya tulisan tersimpan', 'Saved Skills & writing styles')],
    },
    {
      id: 'pro', name: 'Pro', icon: Crown, tagline: t('Untuk dokumen panjang dan skripsi.', 'For long documents and theses.'), quota: allowance('pro', t, freeCharacters), popular: true,
      inherits: t('Semua di Plus, plus:', 'Everything in Plus, plus:'),
      features: [perRun('pro', t), t('Ruang kerja dokumen lanjutan', 'Advanced document workspace'), t('Impor & ekspor DOCX', 'DOCX import & export'), t('Atur halaman, header, dan footer', 'Page, header, and footer controls')],
    },
    {
      id: 'max', name: 'Max', icon: Rocket, tagline: t('Untuk kontrol penuh atas hasil AI.', 'For full control over AI results.'), quota: allowance('max', t, freeCharacters),
      inherits: t('Semua di Pro, plus:', 'Everything in Pro, plus:'),
      features: [t('AI Mode: perintah bebas pada teks terpilih', 'AI Mode: free-form instructions on selected text'), t('Kuota AI terbesar — 3,5× Pro', 'The largest AI allowance — 3.5× Pro')],
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
        { label: t('Kuota baru tiap periode paket', 'Fresh allowance every plan period'), cells: [false, true, true, true] },
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
    [t('Apa bedanya jatah Gratis dan paket berbayar?', 'How does the Free allowance differ from a paid plan?'), t(`Gratis mendapat ${numberFormat(PLAN_LIMITS.free.includedCharacters, 'id')} karakter sekali saja per akun, tidak diisi ulang. Paket berbayar memberi kuota baru untuk setiap periode yang dibayar.`, `Free gets ${numberFormat(PLAN_LIMITS.free.includedCharacters, 'en')} characters once per account and they are not refilled. Paid plans give a fresh allowance for every period you pay for.`)],
    [t('Sisa kuota dibawa ke periode berikutnya?', 'Does unused allowance roll over?'), t('Tidak. Kuota paket berlaku untuk satu periode paket saja. Karakter tambahan yang kamu beli berlaku 12 bulan sejak pembelian dan baru dipakai setelah kuota paket habis.', 'No. Plan allowance lasts for one plan period only. Characters you buy stay valid for 12 months from purchase and are only used after the plan allowance is spent.')],
    [t('Kalau kuota habis atau langganan berakhir?', 'What if the allowance runs out or the plan ends?'), t('Tulisanmu tetap bisa dibuka, diedit, disimpan, dan diekspor. Yang berhenti hanya fitur AI dan fitur berbayar, sampai kamu membeli periode baru. Tidak ada dokumen yang dihapus.', 'Your writing stays open, editable, saved, and exportable. Only the AI and paid features pause until you buy a new period. No document is ever deleted.')],
    [t('Apakah perpanjangan otomatis?', 'Does it renew automatically?'), t('Tidak. Tidak ada penarikan berulang. Paket berlaku satu bulan kalender sejak pembayaran dicatat MKL, dan paket baru bisa dibeli setelah periode itu berakhir.', 'No. There is no recurring charge. A plan lasts one calendar month from when MKL records the payment, and a new plan can be bought once that period ends.')],
    [t('Siapa yang memproses pembayaran?', 'Who processes the payment?'), t('MKL (Mari Kita Lembur). Kamu membayar di halaman MKL; TulisAI tidak menerima atau menyimpan data pembayaranmu, dan paket atau kuota baru berubah setelah MKL mengonfirmasi pembayaran.', 'MKL (Mari Kita Lembur). You pay on MKL’s page; TulisAI never receives or stores your payment details, and your plan or allowance changes only after MKL confirms the payment.')],
    [t('Apakah tulisan saya dipakai untuk melatih AI?', 'Is my writing used to train AI?'), t('Tidak. Tulisanmu hanya diproses untuk menghasilkan permintaan yang kamu jalankan.', 'No. Your writing is only processed to produce the request you run.')],
  ];
}

function CellValue({ value, t }: { value: string | boolean; t: T }) {
  if (value === true) return <Check size={16} className="mx-auto text-brand-700" aria-label={t('Termasuk', 'Included')} />;
  if (value === false) return <Minus size={16} className="mx-auto text-ink-300" aria-label={t('Tidak termasuk', 'Not included')} />;
  return <span className="text-[12.5px] text-ink-700">{value}</span>;
}

const PACK_NAMES: Record<TopUp['id'], [string, string]> = { small: ['Kecil', 'Small'], medium: ['Sedang', 'Medium'], large: ['Besar', 'Large'] };
const perThousand = (pack: TopUp) => Math.round((pack.priceIdr / pack.characters) * 1_000);
// The cheapest price per 1,000 characters is computed, so the "best value" tag cannot drift from the catalogue.
const BEST_VALUE = TOP_UPS.reduce((best, pack) => (perThousand(pack) < perThousand(best) ? pack : best)).id;

const buyButton = (popular: boolean, compact = false) => `${compact ? 'mt-3 h-8 text-[12.5px]' : 'mt-4 h-9 text-[13px]'} inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 text-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 ${popular ? `${raisedGreen} ${pressGreen}` : 'border border-line-strong bg-white text-ink-800 hover:border-ink-300 hover:text-ink-950'}`;

export type Availability = { product: CatalogProduct | null; loading: boolean; failed: boolean; onRetry: () => void };

/**
 * The one control that can start a purchase. What it offers comes from the
 * server's catalog state; when it cannot buy it says why, in words, instead
 * of rendering a button that looks usable.
 */
export function BuyControl({ availability, label, popular = false, compact = false, onBuy, t }: { availability: Availability; label: string; popular?: boolean; compact?: boolean; onBuy: (product: CatalogProduct) => void; t: T }) {
  const { product, loading, failed, onRetry } = availability;
  const note = `${compact ? 'mt-3 min-h-8' : 'mt-4 min-h-9'} flex items-center justify-center text-center text-[12px] leading-snug text-ink-500`;
  if (!product) {
    if (failed) return <button type="button" onClick={onRetry} className={buyButton(false, compact)}><RotateCw size={13} aria-hidden="true" />{t('Muat ulang status pembelian', 'Reload purchase status')}</button>;
    return <p className={note}>{loading ? t('Memeriksa ketersediaan…', 'Checking availability…') : ''}</p>;
  }
  const blocked = blockedLabel(product.state, t);
  if (blocked === null) return <button type="button" onClick={() => onBuy(product)} className={buyButton(popular, compact)}>{label}</button>;
  if (product.state === 'link_required') return <a href="/settings#profil" className={buyButton(false, compact)}>{blocked}</a>;
  if (product.state === 'purchase_open') return <a href="/settings#pembelian" className={buyButton(false, compact)}>{t('Lihat pembelian yang berjalan', 'View the purchase in progress')}</a>;
  if (product.state === 'mkl_unavailable') return <button type="button" onClick={onRetry} className={buyButton(false, compact)}><RotateCw size={13} aria-hidden="true" />{blocked}</button>;
  return <p className={note}>{blocked}</p>;
}

function TopUps({ t, availability, checkoutOpen, onBuy }: { t: T; availability: (characters: number) => Availability; checkoutOpen: boolean | null; onBuy: (product: CatalogProduct) => void }) {
  const rules = [
    t('Hanya menambah kuota AI — tidak membuka fitur paket lain', 'Adds AI allowance only — never unlocks another plan\'s features'),
    t(`Dipakai setelah kuota paket habis, berlaku ${TOP_UP_VALIDITY_MONTHS} bulan`, `Used after the plan allowance, valid for ${TOP_UP_VALIDITY_MONTHS} months`),
    t('Dibekukan saat langganan berakhir, aktif lagi saat berlangganan', 'Frozen when the plan ends, usable again once you resubscribe'),
  ];
  return (
    <section aria-labelledby="topup-title" className="mt-6 rounded-2xl border border-line bg-white">
      <header className="flex flex-col gap-2 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Wallet size={16} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 id="topup-title" className="text-[15px] font-semibold text-ink-900">{t('Tambahan karakter', 'Character top-up')}</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-500">{t('Untuk Plus, Pro, dan Max saat kuota paket habis sebelum periodenya selesai.', 'For Plus, Pro, and Max when the plan allowance runs out before the period ends.')}</p>
          </div>
        </div>
        {checkoutOpen === false && <span className="self-start rounded-md border border-line bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-600">{t('Dibuka setelah pembayaran aktif', 'Opens once payment is live')}</span>}
      </header>

      <ul className="grid gap-3 p-4 sm:grid-cols-3">
        {TOP_UPS.map((pack) => {
          const [id, en] = PACK_NAMES[pack.id]; const best = pack.id === BEST_VALUE;
          return (
            <li key={pack.id} className={`flex flex-col rounded-xl border p-3.5 ${best ? 'border-brand-300 bg-brand-50/40' : 'border-line'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{t(id, en)}</p>
                {best && <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-800">{t('Paling hemat', 'Best value')}</span>}
              </div>
              <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink-950 tabular-nums">{numberFormat(pack.characters, 'id')}<span className="ml-1 text-xs font-medium text-ink-500">{t('karakter', 'characters')}</span></p>
              <p className="mt-0.5 text-[14px] font-semibold text-ink-800 tabular-nums">Rp{numberFormat(pack.priceIdr, 'id')}</p>
              <p className="mt-2 flex-1 text-[11.5px] text-ink-500 tabular-nums">{t(`≈ Rp${numberFormat(perThousand(pack), 'id')} per 1.000 karakter`, `≈ Rp${numberFormat(perThousand(pack), 'id')} per 1,000 characters`)}</p>
              <BuyControl availability={availability(pack.characters)} compact t={t} onBuy={onBuy} label={t('Beli tambahan', 'Buy top-up')} />
            </li>
          );
        })}
      </ul>

      <ul className="grid gap-x-6 gap-y-1.5 rounded-b-2xl border-t border-line bg-paper/60 px-4 py-3 md:grid-cols-3">
        {rules.map((rule) => <li key={rule} className="flex items-start gap-2 text-[12px] leading-snug text-ink-600"><Check size={13} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />{rule}</li>)}
      </ul>
    </section>
  );
}

/**
 * The last step before MKL. It collects only what MKL's checkout needs from
 * the buyer that TulisAI does not already know from the linked MKL identity;
 * price, period and characters are never sent from here.
 */
export function CheckoutPanel({ product, onBack }: { product: CatalogProduct; onBack: () => void }) {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const en = locale === 'en';
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // One deliberate purchase keeps one key, so a retry or a double submit replays it
  // instead of opening a second order. A different phone is a different request.
  const attempt = useRef<{ phone: string; key: string } | null>(null);
  const access = product.kind === 'access';
  const valid = phoneLooksValid(phone);
  const rules = access ? [
    t('Berlaku satu bulan kalender sejak MKL mencatat pembayaran.', 'Lasts one calendar month from when MKL records the payment.'),
    t('Tanpa perpanjangan otomatis dan tanpa tagihan berulang.', 'No automatic renewal and no recurring charge.'),
    t('Tulisanmu tetap milikmu apa pun status paketnya.', 'Your writing stays yours whatever the plan status.'),
  ] : [
    t(`Berlaku ${TOP_UP_VALIDITY_MONTHS} bulan sejak MKL mencatat pembelian.`, `Valid for ${TOP_UP_VALIDITY_MONTHS} months from when MKL records the purchase.`),
    t('Dipakai setelah kuota paket habis, dan dibekukan saat paket berakhir.', 'Used after the plan allowance, and frozen when the plan ends.'),
    t('Hanya menambah kuota AI, tidak membuka fitur paket lain.', 'Adds AI allowance only; it never unlocks another plan’s features.'),
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    const trimmed = phone.trim();
    if (!attempt.current || attempt.current.phone !== trimmed) attempt.current = { phone: trimmed, key: newKey() };
    setBusy(true); setError(null);
    try { window.location.assign(await beginPurchase(product, trimmed, attempt.current.key)); }
    catch (caught) { if (!guard(caught)) setError(caught); setBusy(false); }
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <button type="button" onClick={onBack} disabled={busy} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600 hover:text-ink-900 disabled:opacity-50">
        <ArrowLeft size={15} aria-hidden="true" />{t('Kembali ke paket', 'Back to plans')}
      </button>
      <section aria-labelledby="checkout-title" className="mt-3 rounded-2xl border border-line bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{access ? t('Paket bulanan', 'Monthly plan') : t('Tambahan karakter', 'Character top-up')}</p>
        <h3 id="checkout-title" className="mt-1 text-lg font-semibold text-ink-950">{productName(product.planCode, t)}</h3>
        <p className="mt-2 flex items-baseline gap-1">
          <span className="text-[26px] font-semibold leading-none tracking-tight text-ink-950 tabular-nums">Rp{numberFormat(product.priceIdr, 'id')}</span>
          {access && <span className="text-xs text-ink-500">{t('/ bulan', '/ month')}</span>}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-800"><Gauge size={14} className="shrink-0 text-brand-700" aria-hidden="true" />
          {access ? t(`${numberFormat(product.characters, 'id')} karakter AI untuk periode ini`, `${numberFormat(product.characters, 'en')} AI characters for this period`)
            : t(`${numberFormat(product.characters, 'id')} karakter AI tambahan`, `${numberFormat(product.characters, 'en')} extra AI characters`)}
        </p>
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
          {rules.map((rule) => <li key={rule} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-600"><Check size={14} className="mt-px shrink-0 text-brand-600" aria-hidden="true" />{rule}</li>)}
        </ul>
      </section>

      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3" noValidate>
        <div>
          <FieldLabel htmlFor="buyer-phone" hint={t('Dipakai MKL untuk tagihan dan konfirmasi pembayaran.', 'MKL uses it for the invoice and payment confirmation.')}>{t('Nomor HP', 'Phone number')}</FieldLabel>
          <input id="buyer-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} placeholder="08…" className={`${inputClass} mt-1.5`}
            value={phone} onChange={(event) => setPhone(event.target.value)} disabled={busy} aria-invalid={phone.trim() !== '' && !valid} />
        </div>
        {error !== null && <Alert tone="error" title={t('Pembelian belum dimulai', 'The purchase did not start')}>{errorText(error, en)}</Alert>}
        <Button type="submit" variant="primary" loading={busy} disabled={!valid} className="w-full">{t('Lanjut ke MKL untuk membayar', 'Continue to MKL to pay')}</Button>
        <p className="text-[12px] leading-relaxed text-ink-500">{t('Pembayaran diproses oleh MKL (Mari Kita Lembur). TulisAI tidak menerima atau menyimpan data pembayaranmu, dan paket atau kuota baru berubah setelah MKL mengonfirmasi pembayaran.', 'MKL (Mari Kita Lembur) processes the payment. TulisAI never receives or stores your payment details, and your plan or allowance changes only after MKL confirms the payment.')}</p>
      </form>
    </div>
  );
}

export function PlansDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const { usage } = useShell();
  const guard = useSessionGuard();
  // An unlimited account (admin or override) is on no catalogue plan, so nothing is marked as its current plan.
  const unlimited = usage?.unlimited === true;
  const CURRENT: Tier | null = unlimited ? null : usage?.tier ?? 'free';
  const freeCharacters = usage && usage.tier === 'free' && !unlimited ? usage.characterLimit : FREE_CHARACTERS;
  const catalogue = plans(t, freeCharacters);
  const [catalog, setCatalog] = useState<CommerceCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [checkout, setCheckout] = useState<CatalogProduct | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try { setCatalog(await loadCatalog()); }
    catch (caught) { if (!guard(caught)) setFailed(true); }
  }, [guard]);
  useEffect(() => { void load(); }, [load]);

  const availability = (find: (product: CatalogProduct) => boolean): Availability =>
    ({ product: catalog?.products.find(find) ?? null, loading: catalog === null && !failed, failed, onRetry: () => { setCatalog(null); void load(); } });
  const planAvailability = (planCode: PlanCode) => availability((product) => product.planCode === planCode);

  if (checkout) {
    return <Modal size="2xl" onClose={onClose} title={t('Paket & kuota AI', 'Plans & AI allowance')}><CheckoutPanel product={checkout} onBack={() => { setCheckout(null); void load(); }} /></Modal>;
  }

  return (
    <Modal size="2xl" onClose={onClose} title={t('Paket & kuota AI', 'Plans & AI allowance')}>
      {unlimited && <Alert tone="info" className="mb-4" title={t('Akses AI tanpa batas', 'Unlimited AI access')}>{t('Akun ini tidak memakai kuota paket, jadi tidak ada paket yang ditandai aktif.', 'This account does not use plan allowance, so no plan is marked as active.')}</Alert>}
      {catalog?.checkoutOpen === false && <Alert tone="info" className="mb-4" title={t('Pembayaran belum dibuka', 'Payment is not open yet')}>{t('Paket belum bisa dibeli. Tulisan dan kuotamu saat ini tidak berubah.', 'Plans cannot be bought yet. Your writing and current allowance are unchanged.')}</Alert>}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {catalogue.map((plan) => {
          const Icon = plan.icon; const current = plan.id === CURRENT; const price = PLAN_LIMITS[plan.id].priceIdr;
          return (
            <li key={plan.id} className={`flex flex-col rounded-2xl border bg-white p-4 ${plan.popular ? 'border-brand-600 ring-1 ring-brand-600' : current ? 'border-brand-300' : 'border-line'}`}>
              <div className="flex items-center gap-2">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${plan.popular ? 'bg-brand-800 text-white' : 'bg-brand-50 text-brand-700'}`}><Icon size={16} aria-hidden="true" /></span>
                <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-900">{plan.name}</h3>
                {current ? <span className="shrink-0 rounded-md bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">{t('Paket saat ini', 'Current plan')}</span>
                  : plan.popular && <span className="shrink-0 rounded-md bg-brand-800 px-2 py-0.5 text-[11px] font-semibold text-white">{t('Rekomendasi', 'Recommended')}</span>}
              </div>
              <p className="mt-1.5 min-h-[2.25rem] text-xs leading-relaxed text-ink-500">{plan.tagline}</p>

              <p className="mt-2 flex items-baseline gap-1">
                <span className="text-[26px] font-semibold leading-none tracking-tight text-ink-950 tabular-nums">{price === 0 ? 'Rp0' : `Rp${numberFormat(price, 'id')}`}</span>
                {price > 0 && <span className="text-xs text-ink-500">{t('/ bulan', '/ month')}</span>}
              </p>

              <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-paper px-2.5 py-1.5 text-[12.5px] font-medium text-ink-800"><Gauge size={14} className="shrink-0 text-brand-700" aria-hidden="true" />{plan.quota}</p>

              <div className="mt-3 flex-1 border-t border-line pt-3">
                {plan.inherits && <p className="mb-1.5 text-[11.5px] font-medium text-ink-500">{plan.inherits}</p>}
                <ul className="space-y-1.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-700"><Check size={14} className="mt-px shrink-0 text-brand-600" aria-hidden="true" />{feature}</li>
                  ))}
                </ul>
              </div>

              {/* Free is not something to buy, so it gets a plain label instead of a disabled-looking button. */}
              {current ? (
                <p className="mt-4 flex h-9 items-center justify-center rounded-full bg-paper-deep text-[13px] font-semibold text-ink-500">{t('Paket saat ini', 'Current plan')}</p>
              ) : plan.id === 'free' ? (
                <p className="mt-4 flex h-9 items-center justify-center text-[12.5px] text-ink-500">{t('Otomatis untuk setiap akun baru', 'Given to every new account')}</p>
              ) : (
                <BuyControl availability={planAvailability(plan.id)} popular={plan.popular} t={t} onBuy={setCheckout} label={t(`Pilih ${plan.name}`, `Choose ${plan.name}`)} />
              )}
            </li>
          );
        })}
      </ul>

      <TopUps t={t} checkoutOpen={catalog?.checkoutOpen ?? null} onBuy={setCheckout}
        availability={(characters) => availability((product) => product.kind === 'consumable' && product.characters === characters)} />

      <section aria-label={t('Perbandingan fitur', 'Feature comparison')} className="mt-10">
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

      <footer className="mt-8 flex w-full flex-col gap-1.5 border-t border-line pt-4 text-[11.5px] text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>{t('Harga dalam Rupiah per bulan. Tanpa perpanjangan dan penarikan otomatis.', 'Prices in Rupiah per month. No automatic renewal or charge.')}</p>
        <p>{t('Periode paket dihitung MKL: satu bulan kalender sejak pembayaran dicatat.', 'MKL sets the plan period: one calendar month from when the payment is recorded.')}</p>
      </footer>
    </Modal>
  );
}
