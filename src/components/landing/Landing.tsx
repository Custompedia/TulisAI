'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight, ChartNoAxesColumn, Check, ChevronDown, Columns2, Eye, History, Languages, LayoutDashboard, LockKeyhole, Menu,
  MousePointerClick, PenLine, Repeat2, ShieldCheck, SlidersHorizontal, TextSelect, WandSparkles, X, type LucideIcon,
} from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { request } from '@/lib/client/api';
import type { Mode } from '@/lib/writing/settings';
import { Logo } from '@/components/ui/Logo';
import { buttonClass } from '@/components/ui/Button';
import { MODES, modeHint, modeIcon, modeLabel } from '@/components/writing/modes';
import { DiffText, useDiff } from '@/components/workspace/DiffText';
import { SAMPLES } from './examples';

function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { request('/api/me').then(() => setSignedIn(true)).catch(() => setSignedIn(false)); }, []);
  return signedIn;
}

function LocaleToggle({ tone }: { tone: 'light' | 'dark' }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div role="radiogroup" aria-label={t('Bahasa antarmuka', 'Interface language')} className={`flex rounded-lg p-0.5 text-xs font-semibold ${tone === 'light' ? 'bg-white/10' : 'bg-paper-deep'}`}>
      {(['id', 'en'] as const).map((value) => (
        <button key={value} type="button" role="radio" aria-checked={locale === value} onClick={() => setLocale(value)}
          className={`h-7 rounded-md px-2 ${locale === value ? (tone === 'light' ? 'bg-white text-ink-950' : 'bg-white text-ink-950 shadow-sm') : tone === 'light' ? 'text-white/70 hover:text-white' : 'text-ink-500 hover:text-ink-900'}`}>{value.toUpperCase()}</button>
      ))}
    </div>
  );
}

function Nav({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { const onScroll = () => setScrolled(window.scrollY > 24); onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); return () => window.removeEventListener('scroll', onScroll); }, []);
  const solid = scrolled || open;
  const links = [{ href: '#produk', label: t('Produk', 'Product') }, { href: '#cara-kerja', label: t('Cara Kerja', 'How it Works') }, { href: '#mode', label: t('Mode', 'Modes') }];
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${solid ? 'border-b border-line bg-white/95 backdrop-blur' : 'border-b border-transparent bg-transparent'}`}>
      <nav aria-label={t('Navigasi utama', 'Main navigation')} className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Logo tone={solid ? 'dark' : 'light'} />
        <ul className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((link) => <li key={link.href}><a href={link.href} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${solid ? 'text-ink-600 hover:text-ink-950' : 'text-white/80 hover:text-white'}`}>{link.label}</a></li>)}
        </ul>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <LocaleToggle tone={solid ? 'dark' : 'light'} />
          {signedIn ? (
            <Link href="/app" className={buttonClass(solid ? 'primary' : 'light')}><LayoutDashboard size={16} aria-hidden="true" />{t('Buka Dashboard', 'Open Dashboard')}</Link>
          ) : (
            <>
              <Link href="/login" className={`rounded-lg px-3 py-2 text-sm font-semibold ${solid ? 'text-ink-700 hover:text-ink-950' : 'text-white hover:text-white/80'}`}>{t('Masuk', 'Sign In')}</Link>
              <Link href="/register" className={buttonClass(solid ? 'primary' : 'light')}>{t('Mulai Menulis', 'Start Writing')}<ArrowRight size={16} aria-hidden="true" /></Link>
            </>
          )}
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? t('Tutup menu', 'Close menu') : t('Buka menu', 'Open menu')} className={`ml-auto grid h-10 w-10 place-items-center rounded-lg md:hidden ${solid ? 'text-ink-900 hover:bg-ink-100' : 'text-white hover:bg-white/10'}`}>{open ? <X size={20} /> : <Menu size={20} />}</button>
      </nav>
      {open && (
        <div className="border-t border-line bg-white px-5 pb-5 pt-2 md:hidden">
          <ul className="space-y-1">{links.map((link) => <li key={link.href}><a href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-ink-700 hover:bg-paper">{link.label}</a></li>)}</ul>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-4"><LocaleToggle tone="dark" />{!signedIn && <Link href="/login" className="text-sm font-semibold text-ink-700">{t('Masuk', 'Sign In')}</Link>}</div>
          <Link href={signedIn ? '/app' : '/register'} className={buttonClass('primary', 'lg', 'mt-4 w-full')}>{signedIn ? t('Buka Dashboard', 'Open Dashboard') : t('Mulai Menulis', 'Start Writing')}</Link>
        </div>
      )}
    </header>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  return (
    <section className="relative isolate flex min-h-[640px] items-center overflow-hidden bg-ink-950 h-dvh">
      <Image src="/images/hero-writing-desk.jpg" alt={t('Meja kerja dengan laptop, kopi, dan catatan tulisan tangan', 'Desk with a laptop, coffee, and handwritten notes')} fill priority unoptimized sizes="100vw" className="-z-20 object-cover object-[65%_center]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-ink-950/95 via-ink-950/75 to-ink-950/25" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-t from-ink-950/80 to-transparent" />
      <div className="mx-auto w-full max-w-6xl px-5 pt-16 sm:px-8">
        <div className="max-w-2xl animate-fade-up">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/85"><Languages size={14} aria-hidden="true" />{t('Bahasa Indonesia lebih dulu · juga English', 'Indonesian first · English too')}</p>
          <h1 className="mt-6 font-serif text-[40px] font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-[68px]">
            {t('Tulisanmu, lebih jelas.', 'Your writing, clearer.')}<br /><span className="text-brand-200">{t('Maknanya tetap milikmu.', 'The meaning stays yours.')}</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
            {t('Parafrase, akademik, dan humanize dalam satu ruang kerja — dengan pratinjau sebelum diterapkan, istilah yang dikunci, dan riwayat versi.', 'Paraphrase, academic, and humanize in one workspace — with previews before you apply, locked terms, and version history.')}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href={signedIn ? '/app' : '/register'} className={buttonClass('primary', 'lg')}><PenLine size={18} aria-hidden="true" />{t('Mulai Menulis', 'Start Writing')}</Link>
            <a href="#contoh" className={buttonClass('light', 'lg', 'bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/15')}><MousePointerClick size={18} aria-hidden="true" />{t('Coba Contoh', 'Try Example')}</a>
          </div>
          <ul className="mt-10 flex flex-wrap gap-2" aria-label={t('Mode penulisan', 'Writing modes')}>
            {MODES.filter((mode) => mode !== 'standard').map((mode) => { const Icon = modeIcon[mode]; return <li key={mode} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[13px] font-medium text-white/85"><Icon size={14} aria-hidden="true" />{modeLabel(mode, t)}</li>; })}
          </ul>
        </div>
      </div>
      <a href="#contoh" aria-label={t('Gulir ke contoh', 'Scroll to example')} className="absolute bottom-7 left-1/2 hidden -translate-x-1/2 text-white/60 hover:text-white sm:block"><ChevronDown size={26} className="animate-bounce" /></a>
    </section>
  );
}

function Highlighted({ text, locked }: { text: string; locked: string[] }) {
  const pattern = new RegExp(`(${locked.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{text.split(pattern).map((part, index) => (locked.includes(part) ? <mark key={index} className="ww-protected bg-transparent px-0.5 text-ink-900">{part}</mark> : <span key={index}>{part}</span>))}</>;
}

function Demo({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useLocale();
  const [mode, setMode] = useState<Exclude<Mode, 'custom'>>('academic');
  const [marked, setMarked] = useState(true);
  const sample = SAMPLES[locale];
  const example = sample.outputs[mode];
  const parts = useDiff(sample.source, example.after);
  return (
    <section id="contoh" className="scroll-mt-16 bg-paper py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionTitle eyebrow={t('Coba contoh', 'Try an example')} title={t('Satu teks, enam tujuan berbeda.', 'One text, six different goals.')} text={t('Pilih mode dan lihat apa yang berubah. Istilah yang dikunci dan sitasi tetap utuh.', 'Pick a mode and see what changes. Locked terms and citations stay intact.')} />
        <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_60px_-30px_rgb(10_16_36/0.35)]">
          <div className="scrollbar-thin flex gap-1.5 overflow-x-auto border-b border-line bg-paper/60 p-2.5" role="tablist" aria-label={t('Mode contoh', 'Example modes')}>
            {MODES.map((value) => { const Icon = modeIcon[value]; const active = value === mode; return (
              <button key={value} type="button" role="tab" aria-selected={active} onClick={() => setMode(value)} className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors ${active ? 'bg-ink-950 text-white' : 'text-ink-600 hover:bg-white hover:text-ink-900'}`}><Icon size={15} aria-hidden="true" />{modeLabel(value, t)}</button>
            ); })}
          </div>
          <div className="grid lg:grid-cols-2">
            <div className="border-b border-line p-6 sm:p-8 lg:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">{t('Sebelum', 'Before')}</p>
              <p className="mt-3 font-serif text-[17px] leading-[1.8] text-ink-700"><Highlighted text={sample.source} locked={sample.locked} /></p>
              <div className="mt-5 flex flex-wrap gap-1.5">{sample.locked.map((term) => <span key={term} className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"><LockKeyhole size={12} aria-hidden="true" />{term}</span>)}</div>
            </div>
            <div className="p-6 sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-700">{t('Sesudah', 'After')} · {modeLabel(mode, t)}</p>
                <button type="button" onClick={() => setMarked(!marked)} aria-pressed={marked} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900"><Columns2 size={14} aria-hidden="true" />{marked ? t('Sembunyikan tanda', 'Hide markup') : t('Tandai perubahan', 'Show changes')}</button>
              </div>
              <div className="mt-3 font-serif text-[17px] leading-[1.8] text-ink-900">{marked ? <DiffText parts={parts} /> : <p>{example.after}</p>}</div>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {example.changes.map((change) => <span key={change} className="inline-flex items-center gap-1 rounded-md bg-paper-deep px-2 py-1 text-xs text-ink-700"><Check size={12} className="text-emerald-600" aria-hidden="true" />{change}</span>)}
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800"><ShieldCheck size={12} aria-hidden="true" />{t('2 istilah terlindungi utuh', '2 protected terms intact')}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start justify-between gap-3 border-t border-line bg-paper/60 px-6 py-4 sm:flex-row sm:items-center sm:px-8">
            <p className="text-xs text-ink-500">{t('Contoh statis untuk ilustrasi — halaman ini tidak memanggil AI.', 'Static example for illustration — this page does not call the AI.')}</p>
            <Link href={signedIn ? '/app' : '/register'} className={buttonClass('primary', 'sm')}>{t('Coba dengan tulisanmu', 'Try with your own text')}<ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title, text, light = false }: { eyebrow: string; title: string; text?: string; light?: boolean }) {
  return (
    <div className="max-w-2xl">
      <p className={`text-xs font-bold uppercase tracking-[0.12em] ${light ? 'text-brand-300' : 'text-brand-700'}`}>{eyebrow}</p>
      <h2 className={`mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-[42px] ${light ? 'text-white' : 'text-ink-950'}`}>{title}</h2>
      {text && <p className={`mt-4 text-base leading-relaxed ${light ? 'text-white/70' : 'text-ink-500'}`}>{text}</p>}
    </div>
  );
}

function Feature({ icon: Icon, title, text, children, className = '' }: { icon: LucideIcon; title: string; text: string; children?: React.ReactNode; className?: string }) {
  return (
    <article className={`flex flex-col rounded-2xl border border-line bg-white p-6 sm:p-7 ${className}`}>
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon size={20} aria-hidden="true" /></span>
      <h3 className="mt-5 text-lg font-semibold text-ink-950">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{text}</p>
      {children && <div className="mt-6 flex-1">{children}</div>}
    </article>
  );
}

function Features() {
  const { t } = useLocale();
  const timeline: Array<[string, string]> = [[t('Original', 'Original'), 'border-ink-300 bg-ink-50 text-ink-700'], [t('Hasil AI', 'AI version'), 'border-brand-200 bg-brand-50 text-brand-800'], [t('Versi manual', 'Checkpoint'), 'border-emerald-200 bg-emerald-50 text-emerald-800']];
  return (
    <section id="produk" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionTitle eyebrow={t('Produk', 'Product')} title={t('Bukan sekadar parafrase. Ruang kerja yang membuatmu tetap memegang kendali.', 'Not just a paraphraser. A workspace that keeps you in control.')} />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Feature className="lg:col-span-2" icon={Eye} title={t('Pratinjau dulu, terapkan kalau cocok', 'Preview first, apply when it fits')} text={t('Hasil AI tidak pernah langsung menimpa dokumen. Gunakan, bandingkan, atau buang — keputusannya di tanganmu.', 'AI results never overwrite your document. Use, compare, or discard — the decision is yours.')}>
            <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
              <p className="text-xs font-semibold text-brand-800">{t('Pratinjau · belum diterapkan', 'Preview · not applied')}</p>
              <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink-800">{t('Penelitian ini ', 'This study ')}<del className="diff-del">{t('dimaksudkan guna melakukan analisis terhadap', 'is intended for carrying out an analysis of')}</del> <ins className="diff-add">{t('menganalisis', 'analyses')}</ins> {t('kepuasan pengguna.', 'user satisfaction.')}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white">{t('Gunakan Hasil Ini', 'Use This Result')}</span>
                <span className="rounded-md border border-line-strong bg-white px-2.5 py-1 text-xs font-semibold text-ink-700">{t('Bandingkan', 'Compare')}</span>
                <span className="rounded-md border border-line-strong bg-white px-2.5 py-1 text-xs font-semibold text-ink-700">{t('Buang Hasil', 'Discard')}</span>
              </div>
            </div>
          </Feature>
          <Feature icon={LockKeyhole} title={t('Kunci istilah & sitasi', 'Lock terms & citations')} text={t('Nama teori, variabel, dan sitasi dijaga persis. Jika AI mengubahnya, hasil ditolak otomatis.', 'Theory names, variables, and citations stay exact. If the AI changes them, the result is rejected.')}>
            <p className="font-serif text-[15px] leading-relaxed text-ink-700">{t('…dengan', '…using')} <mark className="ww-protected bg-transparent px-0.5 text-ink-900">Structural Equation Modeling</mark> {t('sesuai', 'following')} <mark className="ww-protected bg-transparent px-0.5 text-ink-900">(Hair et al., 2019)</mark>.</p>
          </Feature>
          <Feature icon={History} title={t('Riwayat versi yang aman', 'Safe version history')} text={t('Original selalu tersimpan. Memulihkan versi lama membuat versi baru, riwayat tidak pernah hilang.', 'The original is always kept. Restoring creates a new version; history is never lost.')}>
            <ol className="flex flex-wrap items-center gap-1.5">
              {timeline.map(([label, tone], index) => <li key={label} className="flex items-center gap-1.5">{index > 0 && <span className="h-px w-3 bg-line-strong" aria-hidden="true" />}<span className={`rounded-md border px-2 py-1 text-xs font-semibold ${tone}`}>{label}</span></li>)}
              <li className="flex items-center gap-1.5"><span className="h-px w-3 bg-line-strong" aria-hidden="true" /><span className="rounded-md bg-ink-950 px-2 py-1 text-xs font-semibold text-white">{t('Sekarang', 'Current')}</span></li>
            </ol>
          </Feature>
          <Feature icon={TextSelect} title={t('Ubah bagian kecil saja', 'Refine just a part')} text={t('Blok satu kata, frasa, atau kalimat, lalu minta alternatif — tanpa mengulang seluruh dokumen.', 'Select a word, phrase, or sentence and ask for alternatives — without redoing the whole document.')}>
            <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-ink-950 p-1">
              {[[Repeat2, t('Parafrase', 'Paraphrase')], [WandSparkles, t('Alternatif', 'Alternatives')], [LockKeyhole, t('Kunci', 'Lock')]].map(([Icon, label]) => { const I = Icon as LucideIcon; return <span key={String(label)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-100"><I size={12} aria-hidden="true" />{String(label)}</span>; })}
            </div>
          </Feature>
          <Feature icon={Columns2} title={t('Bandingkan kapan saja', 'Compare anytime')} text={t('Lihat kata yang ditambah dan dihapus antara dua versi, lengkap dengan persentase perubahan.', 'See words added and removed between any two versions, with a change percentage.')} />
          <Feature icon={ChartNoAxesColumn} title={t('Analisis tanpa biaya AI', 'Analytics without AI cost')} text={t('Jumlah kata, kalimat, waktu baca, dan pengulangan dihitung langsung di perangkatmu.', 'Words, sentences, reading time, and repetition are computed right on your device.')} />
        </div>
      </div>
    </section>
  );
}

function Steps() {
  const { t } = useLocale();
  const steps: Array<[LucideIcon, string, string]> = [
    [PenLine, t('Tulis atau tempel', 'Write or paste'), t('Mulai dari draft skripsi, email, atau caption. Jumlah kata langsung terhitung.', 'Start from a thesis draft, email, or caption. Word count updates instantly.')],
    [SlidersHorizontal, t('Pilih tujuan', 'Choose a goal'), t('Pilih mode. Butuh lebih spesifik? Buka "Sesuaikan" untuk format, panjang, dan pembaca.', 'Pick a mode. Need more? Open "Customize" for format, length, and audience.')],
    [Check, t('Tinjau, lalu terapkan', 'Review, then apply'), t('Periksa perubahan di pratinjau. Setiap hasil yang diterapkan tersimpan sebagai versi.', 'Check the changes in the preview. Every applied result is saved as a version.')],
  ];
  return (
    <section id="cara-kerja" className="scroll-mt-16 bg-paper py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionTitle eyebrow={t('Cara kerja', 'How it works')} title={t('Tiga langkah, tanpa perlu menulis prompt.', 'Three steps, no prompt writing needed.')} />
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {steps.map(([Icon, title, text], index) => (
            <li key={title} className="relative rounded-2xl border border-line bg-white p-7">
              <span className="font-serif text-5xl font-semibold text-paper-deep">{String(index + 1).padStart(2, '0')}</span>
              <span className="absolute right-7 top-7 grid h-10 w-10 place-items-center rounded-xl bg-ink-950 text-white"><Icon size={19} aria-hidden="true" /></span>
              <h3 className="mt-4 text-lg font-semibold text-ink-950">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Modes() {
  const { t } = useLocale();
  const fit: Record<Exclude<Mode, 'custom'>, string> = {
    standard: t('Semua jenis tulisan', 'Any kind of writing'), academic: t('Skripsi, tesis, jurnal', 'Theses, journals'), humanize: t('Draft yang terasa kaku', 'Drafts that feel stiff'),
    professional: t('Email, laporan, proposal', 'Emails, reports, proposals'), creative: t('Konten & caption', 'Content & captions'), simplify: t('Penjelasan untuk awam', 'Explaining to non-experts'),
  };
  return (
    <section id="mode" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionTitle eyebrow={t('Mode', 'Modes')} title={t('Pilih cara tulisanmu diperbaiki.', 'Choose how your writing improves.')} text={t('Semua mode bekerja di dokumen yang sama, dengan istilah terkunci dan riwayat versi yang sama.', 'Every mode works in the same document, with the same locked terms and version history.')} />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map((mode) => { const Icon = modeIcon[mode]; return (
            <article key={mode} className="group rounded-2xl border border-line p-6 transition-colors hover:border-brand-300 hover:bg-brand-50/30">
              <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-paper-deep text-ink-700 transition-colors group-hover:bg-brand-600 group-hover:text-white"><Icon size={19} aria-hidden="true" /></span><h3 className="text-lg font-semibold text-ink-950">{modeLabel(mode, t)}</h3></div>
              <p className="mt-3 text-[15px] text-ink-600">{modeHint(mode, t)}.</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Cocok untuk', 'Best for')}: <span className="normal-case tracking-normal text-ink-600">{fit[mode]}</span></p>
            </article>
          ); })}
        </div>
      </div>
    </section>
  );
}

function Trust({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  const pillars: Array<[LucideIcon, string, string]> = [
    [ShieldCheck, t('Tulisan aslimu selalu aman', 'Your original is always preserved'), t('Original tidak bisa terhapus dari riwayat, dan kegagalan AI tidak pernah mengosongkan teksmu.', 'The original cannot be removed from history, and an AI failure never clears your text.')],
    [SlidersHorizontal, t('Tanpa perlu menulis prompt', 'No prompt engineering required'), t('Pilih mode dan atur hasil lewat pilihan yang jelas — bukan kotak perintah kosong.', 'Pick a mode and shape results with clear options — not an empty prompt box.')],
    [Languages, t('Bahasa Indonesia lebih dulu', 'Bahasa Indonesia first'), t('Dirancang untuk kaidah tulisan Indonesia, dengan dukungan English di dokumen yang sama.', 'Designed for Indonesian writing conventions, with English support in the same document.')],
  ];
  return (
    <section className="bg-ink-950 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionTitle light eyebrow={t('Kenapa kami', 'Why us')} title={t('Dibuat untuk tulisan yang serius.', 'Built for writing that matters.')} />
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {pillars.map(([Icon, title, text]) => (
            <div key={title} className="border-t border-white/15 pt-6">
              <Icon size={24} className="text-brand-300" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-white/65">{text}</p>
            </div>
          ))}
        </div>
        <p className="mt-14 max-w-3xl rounded-xl border border-white/10 px-5 py-4 text-sm leading-relaxed text-white/60">{t('Kami tidak menjanjikan lolos detektor AI dan tidak menambahkan kesalahan agar tulisan terlihat "manusiawi". Fokus kami adalah tulisan yang jelas, natural, dan tetap setia pada maknanya.', 'We do not promise to bypass AI detectors, and we never add mistakes to make writing look "human". Our focus is writing that is clear, natural, and faithful to its meaning.')}</p>
        <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-2xl bg-brand-600 px-7 py-8 sm:flex-row sm:items-center sm:px-10">
          <div><h3 className="font-serif text-2xl font-semibold text-white sm:text-3xl">{t('Siap merapikan tulisanmu?', 'Ready to polish your writing?')}</h3><p className="mt-1.5 text-white/80">{t('Gratis untuk mulai. Tanpa kartu kredit.', 'Free to start. No credit card.')}</p></div>
          <Link href={signedIn ? '/app' : '/register'} className={buttonClass('light', 'lg')}>{t('Mulai Menulis', 'Start Writing')}<ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useLocale();
  return (
    <footer className="border-t border-white/10 bg-ink-950 pb-24 pt-10 md:pb-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Logo tone="light" />
        <nav aria-label={t('Tautan footer', 'Footer links')} className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
          <a href="#produk" className="hover:text-white">{t('Produk', 'Product')}</a><a href="#cara-kerja" className="hover:text-white">{t('Cara Kerja', 'How it Works')}</a>
          <Link href="/login" className="hover:text-white">{t('Masuk', 'Sign In')}</Link><Link href="/register" className="hover:text-white">{t('Daftar', 'Sign Up')}</Link>
        </nav>
        <p className="text-xs text-white/40">© 2026 AI Writing Workspace · {t('Foto', 'Photo')}: Unsplash</p>
      </div>
    </footer>
  );
}

function MobileCta({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  useEffect(() => { const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.7); onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); return () => window.removeEventListener('scroll', onScroll); }, []);
  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 p-3 backdrop-blur md:hidden">
      <Link href={signedIn ? '/app' : '/register'} className={buttonClass('primary', 'lg', 'w-full')}><PenLine size={18} aria-hidden="true" />{signedIn ? t('Buka Dashboard', 'Open Dashboard') : t('Mulai Menulis', 'Start Writing')}</Link>
    </div>
  );
}

export function Landing() {
  const signedIn = useSignedIn();
  return (
    <>
      <Nav signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} />
        <Demo signedIn={signedIn} />
        <Features />
        <Steps />
        <Modes />
        <Trust signedIn={signedIn} />
      </main>
      <Footer />
      <MobileCta signedIn={signedIn} />
    </>
  );
}
