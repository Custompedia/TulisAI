'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Crown, Gauge, Leaf, Minus, Rocket, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { dateTime, numberFormat } from '@/lib/client/format';
import { errorText, newKey, request } from '@/lib/client/api';
import { PLAN_LIMITS, TIERS, TOP_UPS, TOP_UP_VALIDITY_MONTHS, type Tier, type TopUp } from '@/lib/plans';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { useShell } from './AppShell';

type T = (id: string, en: string) => string;
type Plan = { id: Tier; name: string; icon: LucideIcon; tagline: string; quota: string; inherits?: string; features: string[]; popular?: boolean };
type Cells = [string | boolean, string | boolean, string | boolean, string | boolean];
type PaidTier = Exclude<Tier, 'free'>;
type Order = { id: string; kind: 'plan' | 'topup'; plan: PaidTier | null; pack: TopUp['id'] | null; characters: number; amountIdr: number; mode: 'sandbox' | 'production'; status: string; payUrl: string | null; createdAt: string };
type Billing = { checkoutOpen: boolean; mode: 'sandbox' | 'production' | null; orders: Order[]; plan: { code: PaidTier; source: 'admin' | 'payment'; periodEnd: string; paidThrough: string } | null };

// Prices, allowances and gates all come from PLAN_LIMITS, so this catalogue cannot drift from what the server enforces.
// Buying goes through Tulis Lab's own Midtrans checkout. While payments are closed, choosing a plan explains that instead of pretending to sell.
const FREE_CHARACTERS = PLAN_LIMITS.free.includedCharacters;
const chars = (value: number, t: T) => t(`${numberFormat(value, 'id')} karakter`, `${numberFormat(value, 'en')} characters`);
const perRun = (tier: Tier, t: T) => t(`Sekali proses s.d. ${chars(PLAN_LIMITS[tier].runLimit, t)}`, `Up to ${chars(PLAN_LIMITS[tier].runLimit, t)} per run`);
const allowance = (tier: Tier, t: T, freeCharacters: number) => (tier === 'free'
  ? t(`${numberFormat(freeCharacters, 'id')} karakter AI sekali pakai`, `${numberFormat(freeCharacters, 'en')} one-time AI characters`)
  : t(`${numberFormat(PLAN_LIMITS[tier].includedCharacters, 'id')} karakter AI / bulan`, `${numberFormat(PLAN_LIMITS[tier].includedCharacters, 'en')} AI characters / month`));

function plans(t: T, freeCharacters: number): Plan[] {
  return [
    {
      id: 'free', name: t('Gratis', 'Free'), icon: Leaf, tagline: t('Coba Tulis Lab sekali jalan.', 'Try Tulis Lab once.'), quota: allowance('free', t, freeCharacters),
      features: [t('6 mode penulisan', '6 writing modes'), perRun('free', t), t('Aksi cepat pada teks terpilih', 'Quick actions on selected text'), t('Riwayat versi & bandingkan', 'Version history & compare'), t('Editor tetap bisa dipakai setelah jatah habis', 'The editor keeps working after the allowance runs out')],
    },
    {
      id: 'plus', name: 'Plus', icon: Sparkles, tagline: t('Untuk yang rutin menulis ulang.', 'For regular rewriting.'), quota: allowance('plus', t, freeCharacters),
      inherits: t('Semua di Gratis, plus:', 'Everything in Free, plus:'),
      features: [perRun('plus', t), t('Kuota AI isi ulang tiap bulan', 'AI allowance refills every month'), t('Skill tersimpan: mode beserta pengaturannya', 'Saved skills: a mode with its settings')],
    },
    {
      id: 'pro', name: 'Pro', icon: Crown, tagline: t('Untuk dokumen panjang dan skripsi.', 'For long documents and theses.'), quota: allowance('pro', t, freeCharacters), popular: true,
      inherits: t('Semua di Plus, plus:', 'Everything in Plus, plus:'),
      features: [perRun('pro', t), t('Ruang kerja dokumen lanjutan', 'Advanced document workspace'), t('Impor & ekspor DOCX', 'DOCX import & export'), t('Atur halaman, header, dan footer', 'Page, header, and footer controls')],
    },
    {
      id: 'max', name: 'Max', icon: Rocket, tagline: t('Untuk kontrol penuh atas hasil AI.', 'For full control over AI results.'), quota: allowance('max', t, freeCharacters),
      inherits: t('Semua di Pro, plus:', 'Everything in Pro, plus:'),
      features: [
        t('Perintah AI: instruksi bebas pada teks terpilih', 'AI instructions: free-form instructions on selected text'),
        t('Catatan untuk AI di Sesuaikan hasil', 'Notes for the AI in Customize result'),
        t('Instruksi & contoh tulisan di skill', 'Instructions & writing samples in skills'),
        t('Sesuaikan hasil tersimpan di notebook & skill', 'Customize result saved in notebooks & skills'),
        t('Kuota AI terbesar — 3,5× Pro', 'The largest AI allowance — 3.5× Pro'),
      ],
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
        { label: t('Isi ulang tiap bulan', 'Refills every month'), cells: [false, true, true, true] },
        { label: t('Panjang teks sekali proses', 'Text length per run'), cells: TIERS.map((tier) => chars(PLAN_LIMITS[tier].runLimit, t)) as Cells },
      ],
    },
    {
      title: t('Menulis ulang', 'Rewriting'),
      rows: [
        { label: t('Mode penulisan', 'Writing modes'), cells: [modes, modes, modes, modes] },
        { label: t('Aksi cepat pada teks terpilih', 'Quick actions on selected text'), cells: [true, true, true, true] },
        { label: t('Istilah terkunci & pelindung angka', 'Locked terms & number protection'), cells: [true, true, true, true] },
        { label: t('Skill tersimpan', 'Saved skills'), cells: [false, true, true, true] },
        { label: t('Perintah AI: instruksi bebas pada teks terpilih', 'AI instructions: free-form instructions on selected text'), cells: [false, false, false, true] },
        { label: t('Catatan untuk AI di Sesuaikan hasil', 'Notes for the AI in Customize result'), cells: [false, false, false, true] },
        { label: t('Instruksi & contoh tulisan di skill', 'Instructions & writing samples in skills'), cells: [false, false, false, true] },
        { label: t('Sesuaikan hasil tersimpan di notebook & skill', 'Customize result saved in notebooks & skills'), cells: [false, false, false, true] },
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
    [t('Bagaimana karakter AI dihitung?', 'How are AI characters counted?'), t('Yang dihitung adalah teks sumber yang benar-benar diproses — kalau kamu memilih 2.000 karakter dari dokumen 30.000 karakter, yang terpotong 2.000. Khusus Perintah AI, yang dihitung adalah yang lebih besar antara teks sumber dan hasil yang dikeluarkan. Mengetik, menyimpan, impor/ekspor tanpa AI, dan membandingkan versi tidak memakai kuota.', 'It counts the source text actually processed — select 2,000 characters inside a 30,000-character document and 2,000 are charged. AI instructions are charged the larger of the source text and the generated result. Typing, saving, importing or exporting without AI, and comparing versions never use the allowance.')],
    [t('Kalau hasilnya gagal atau ditolak?', 'What if a run fails or is refused?'), t('Tidak ada karakter yang terpotong. Kegagalan provider, hasil yang ditolak pemeriksaan keamanan, dan perbaikan otomatis kami tanggung sendiri. Menekan “buat ulang” dihitung sebagai pemakaian baru.', 'Nothing is charged. Provider failures, results refused by the safety checks, and our own automatic repair are on us. Pressing “generate again” counts as new usage.')],
    [t('Apa bedanya jatah Gratis dan paket berbayar?', 'How does the Free allowance differ from a paid plan?'), t(`Gratis mendapat ${numberFormat(PLAN_LIMITS.free.includedCharacters, 'id')} karakter sekali saja per akun, tidak diisi ulang. Paket berbayar diisi ulang setiap bulan.`, `Free gets ${numberFormat(PLAN_LIMITS.free.includedCharacters, 'en')} characters once per account and they are not refilled. Paid plans refill every month.`)],
    [t('Sisa kuota dibawa ke bulan berikutnya?', 'Does unused allowance roll over?'), t('Tidak. Kuota langganan direset tiap bulan. Karakter tambahan yang kamu beli berlaku 12 bulan sejak pembelian dan baru dipakai setelah kuota langganan habis.', 'No. Subscription allowance resets every month. Characters you buy stay valid for 12 months from purchase and are only used after the subscription allowance is spent.')],
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

const PACK_NAMES: Record<TopUp['id'], [string, string]> = { small: ['Kecil', 'Small'], medium: ['Sedang', 'Medium'], large: ['Besar', 'Large'] };
const perThousand = (pack: TopUp) => Math.round((pack.priceIdr / pack.characters) * 1_000);
// The cheapest price per 1,000 characters is computed, so the "best value" tag cannot drift from the catalogue.
const BEST_VALUE = TOP_UPS.reduce((best, pack) => (perThousand(pack) < perThousand(best) ? pack : best)).id;

function TopUps({ t, canBuy, busy, onBuy }: { t: T; canBuy: boolean; busy: string; onBuy: (pack: TopUp['id']) => void }) {
  const rules = [
    t('Hanya menambah kuota AI — tidak membuka fitur paket lain', 'Adds AI allowance only — never unlocks another plan\'s features'),
    t(`Dipakai setelah kuota bulanan habis, berlaku ${TOP_UP_VALIDITY_MONTHS} bulan`, `Used after the monthly allowance, valid for ${TOP_UP_VALIDITY_MONTHS} months`),
    t('Dibekukan saat langganan berakhir, aktif lagi saat berlangganan', 'Frozen when the plan ends, usable again once you resubscribe'),
  ];
  return (
    <section aria-labelledby="topup-title" className="mt-6 rounded-2xl border border-line bg-white">
      <header className="flex flex-col gap-2 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Wallet size={16} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 id="topup-title" className="text-[15px] font-semibold text-ink-900">{t('Tambahan karakter', 'Character top-up')}</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-500">{t('Untuk Plus, Pro, dan Max saat kuota bulanan habis sebelum waktunya.', 'For Plus, Pro, and Max when the monthly allowance runs out early.')}</p>
          </div>
        </div>
        {!canBuy && <span className="self-start rounded-md border border-line bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-600">{t('Untuk paket berbayar yang aktif', 'For an active paid plan')}</span>}
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
              <p className="mt-2 text-[11.5px] text-ink-500 tabular-nums">{t(`≈ Rp${numberFormat(perThousand(pack), 'id')} per 1.000 karakter`, `≈ Rp${numberFormat(perThousand(pack), 'id')} per 1,000 characters`)}</p>
              {canBuy && <button type="button" disabled={busy !== ''} onClick={() => onBuy(pack.id)} className="mt-3 inline-flex h-8 items-center justify-center rounded-full border border-line-strong bg-white text-[12.5px] font-semibold text-ink-800 hover:border-ink-300 disabled:opacity-60">{busy === pack.id ? t('Membuka pembayaran…', 'Opening payment…') : t('Beli', 'Buy')}</button>}
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

export function PlansDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const { usage, user } = useShell();
  // An admin is on no catalogue plan, so nothing is marked as its current plan; its characters are still charged.
  const admin = user.role === 'admin';
  const CURRENT: Tier | null = admin ? null : usage?.tier ?? 'free';
  const freeCharacters = usage && usage.tier === 'free' && !admin ? usage.characterLimit : FREE_CHARACTERS;
  const catalogue = plans(t, freeCharacters);
  const [notice, setNotice] = useState('');
  const [billing, setBilling] = useState<Billing | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const en = locale === 'en';
  const load = useCallback(async () => { try { setBilling(await request<Billing>('/api/payments/orders')); } catch { setBilling(null); } }, []);
  useEffect(() => { void load(); }, [load]);
  const running = billing?.plan ?? null;
  async function buy(body: { kind: 'plan'; plan: PaidTier } | { kind: 'topup'; pack: TopUp['id'] }, label: string) {
    if (!billing?.checkoutOpen) { setNotice(label); return; }
    setBusy(body.kind === 'plan' ? body.plan : body.pack); setError('');
    try {
      const result = await request<{ order: Order }>('/api/payments/checkout', 'POST', body, newKey());
      if (result.order.payUrl) window.location.assign(result.order.payUrl); else await load();
    } catch (caught) { setError(errorText(caught, en)); }
    finally { setBusy(''); }
  }
  const pending = (billing?.orders ?? []).filter((order) => order.status === 'pending' && order.payUrl);

  return (
    <Modal size="2xl" onClose={onClose} title={t('Paket & kuota AI', 'Plans & AI allowance')}>
      {admin && <Alert tone="info" className="mb-4" title={t('Akun admin', 'Admin account')}>{t('Akun admin tidak dibatasi kuota permintaan bulanan (tetap maks. 10 per menit), tetapi tetap memakai saldo karakter.', 'An admin account has no monthly request cap (still at most 10 per minute), but it still spends its character balance.')}</Alert>}
      {notice && <Alert tone="info" className="mb-4" onDismiss={() => setNotice('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Pembayaran belum dibuka', 'Payments are not open yet')}>{t(`${notice} belum bisa dibeli karena pembayaran belum dibuka. Tulisan dan kuotamu saat ini tidak berubah.`, `${notice} cannot be bought yet because payments are not open. Your writing and current allowance are unchanged.`)}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Alert>}
      {billing?.checkoutOpen && billing.mode === 'sandbox' && <Alert tone="warning" className="mb-4" title={t('Mode uji (sandbox)', 'Test mode (sandbox)')}>{t('Pembayaran memakai simulator Midtrans. Tidak ada uang sungguhan yang ditarik.', 'Payments use the Midtrans simulator. No real money is charged.')}</Alert>}
      {running && <Alert tone="info" className="mb-4" title={t(`Paket ${running.code[0]!.toUpperCase()}${running.code.slice(1)} aktif`, `${running.code[0]!.toUpperCase()}${running.code.slice(1)} plan active`)}>{t(`Berlaku sampai ${dateTime(running.paidThrough, 'id')}.`, `Valid until ${dateTime(running.paidThrough, 'en')}.`)}</Alert>}
      {pending.length > 0 && <Alert tone="info" className="mb-4" title={t('Pembayaran belum selesai', 'Payment not finished')}>
        <ul className="space-y-1">{pending.map((order) => <li key={order.id} className="flex flex-wrap items-center gap-2"><span>{order.kind === 'plan' ? `${t('Paket', 'Plan')} ${order.plan}` : t(`Tambahan ${numberFormat(order.characters, 'id')} karakter`, `${numberFormat(order.characters, 'en')}-character top-up`)} · Rp{numberFormat(order.amountIdr, 'id')}</span><a className="font-semibold text-brand-800 underline" href={order.payUrl!}>{t('Lanjutkan pembayaran', 'Continue payment')}</a></li>)}</ul>
      </Alert>}

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
              {current && plan.id !== 'free' && running?.code === plan.id && billing?.checkoutOpen ? (
                <button type="button" disabled={busy !== ''} onClick={() => void buy({ kind: 'plan', plan: plan.id as PaidTier }, plan.name)}
                  className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-full border border-line-strong bg-white text-[13px] font-semibold text-ink-800 hover:border-ink-300 disabled:opacity-60">
                  {busy === plan.id ? t('Membuka pembayaran…', 'Opening payment…') : t('Perpanjang 1 bulan', 'Renew 1 month')}
                </button>
              ) : current ? (
                <p className="mt-4 flex h-9 items-center justify-center rounded-full bg-paper-deep text-[13px] font-semibold text-ink-500">{t('Paket saat ini', 'Current plan')}</p>
              ) : running && plan.id !== 'free' ? (
                <p className="mt-4 flex h-9 items-center justify-center text-center text-[12px] text-ink-500">{t('Bisa dipilih setelah paket saat ini berakhir', 'Available after the current plan ends')}</p>
              ) : plan.id === 'free' ? (
                <p className="mt-4 flex h-9 items-center justify-center text-[12.5px] text-ink-500">{t('Otomatis untuk setiap akun baru', 'Given to every new account')}</p>
              ) : (
                <button type="button" disabled={busy !== ''} onClick={() => void buy({ kind: 'plan', plan: plan.id as PaidTier }, plan.name)}
                  className={`mt-4 inline-flex h-9 w-full items-center justify-center rounded-full text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${plan.popular ? `${raisedGreen} ${pressGreen}` : 'border border-line-strong bg-white text-ink-800 hover:border-ink-300 hover:text-ink-950'}`}>
                  {busy === plan.id ? t('Membuka pembayaran…', 'Opening payment…') : t(`Pilih ${plan.name}`, `Choose ${plan.name}`)}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <TopUps t={t} canBuy={Boolean(billing?.checkoutOpen && running)} busy={busy} onBuy={(pack) => void buy({ kind: 'topup', pack }, t('Tambahan karakter', 'Character top-up'))} />

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
        <p>{t('Harga dalam Rupiah per bulan. Perpanjangan manual, tanpa penarikan otomatis.', 'Prices in Rupiah per month. Renewal is manual, with no automatic charge.')}</p>
        <p>{t('Kuota bulanan mengikuti periode paketmu: satu bulan kalender sejak paket aktif.', 'The monthly allowance follows your plan period: one calendar month from activation.')}</p>
      </footer>
    </Modal>
  );
}
