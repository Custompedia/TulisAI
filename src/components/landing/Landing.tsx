'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Bot, Check, ChevronRight, Columns2, Copy, EllipsisVertical, Eye, EyeOff, Feather, History, Info, Languages, Lock, Menu, PanelRightClose, Plus, Redo2, RefreshCw, Save, ShieldCheck, TextSelect, Undo2, X, type LucideIcon } from 'lucide-react';
import { LocaleScope, useLocale } from '@/lib/client/locale';
import { request } from '@/lib/client/api';
import { numberFormat } from '@/lib/client/format';
import { changePercentage, countWords, wordDelta } from '@/lib/editor/metrics';
import { Button, IconButton, buttonClass, pressGreen, raisedGreen } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { MODES, generateLabel, languageOptions, modeHint, modeIcon, modeLabel, modeTone, toneClass, type ModeTone } from '@/components/writing/modes';
import { CustomizePanel, ModeOptions } from '@/components/writing/WritingControls';
import { HintSelect } from '@/components/ui/HintSelect';
import { DiffText, useDiff } from '@/components/workspace/DiffText';
import { SaveStatus } from '@/components/workspace/SaveStatus';
import { defaults, type Mode, type Settings } from '@/lib/writing/settings';
import { SAMPLES } from './examples';
import { SupportingSections } from './LandingSections';
import styles from './Landing.module.css';

type DemoMode = Exclude<Mode, 'custom'>;

function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let active = true;
    request('/api/me').then(() => { if (active) setSignedIn(true); }).catch(() => { if (active) setSignedIn(false); });
    return () => { active = false; };
  }, []);
  return signedIn;
}

function StartLink({ signedIn, arrow = false }: { signedIn: boolean; arrow?: boolean }) {
  const { t } = useLocale();
  return <Link className={styles.primary} href={signedIn ? '/app' : '/register'}>{signedIn ? t('Buka Dashboard', 'Open Dashboard') : t('Mulai Menulis', 'Start Writing')}{arrow && <ArrowRight size={15} aria-hidden="true" />}</Link>;
}

function Nav({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 32);
    const desktop = window.matchMedia('(min-width: 801px)');
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    update();
    window.addEventListener('scroll', update, { passive: true });
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('scroll', update);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, []);
  const toggle = useRef<HTMLButtonElement>(null);
  const links = [{ href: '#produk', label: t('Produk', 'Product') }, { href: '#cara-kerja', label: t('Cara Kerja', 'How It Works') }, { href: '#mode', label: t('Mode', 'Modes') }, { href: '#faq', label: 'FAQ' }];
  return <header className={styles.header} data-scrolled={scrolled || open} onKeyDown={event => { if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); } }}>
    <nav className={styles.nav} aria-label={t('Navigasi utama', 'Main navigation')}>
      <div className={styles.brand}><Logo /></div>
      <div className={styles.navLinks}>{links.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}</div>
      <div className={styles.navActions}>{!signedIn && <Link className={styles.signIn} href="/login">{t('Masuk', 'Sign In')}</Link>}<StartLink signedIn={signedIn} /></div>
      <button ref={toggle} type="button" className={styles.menuToggle} aria-expanded={open} aria-controls="landing-menu" aria-label={open ? t('Tutup menu', 'Close menu') : t('Buka menu', 'Open menu')} onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      <div id="landing-menu" className={styles.mobileMenu} hidden={!open}>
        {links.map(link => <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}
        {!signedIn && <Link href="/login">{t('Masuk', 'Sign In')}</Link>}<StartLink signedIn={signedIn} />
      </div>
    </nav>
  </header>;
}

function ProtectedText({ text, locked }: { text: string; locked: string[] }) {
  const pattern = new RegExp(`(${locked.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{text.split(pattern).map((part, index) => locked.includes(part) ? <mark key={index} className="ww-protected">{part}</mark> : <span key={index}>{part}</span>)}</>;
}

const ringClass: Record<ModeTone, string> = { green: 'ring-mode-green-ink/40', blue: 'ring-mode-blue-ink/40', orange: 'ring-mode-orange-ink/40', slate: 'ring-mode-slate-ink/40', pink: 'ring-mode-pink-ink/40', gold: 'ring-mode-gold-ink/40', gray: 'ring-mode-gray-ink/40' };
const hoverClass: Record<ModeTone, string> = { green: 'hover:border-mode-green-edge', blue: 'hover:border-mode-blue-edge', orange: 'hover:border-mode-orange-edge', slate: 'hover:border-mode-slate-edge', pink: 'hover:border-mode-pink-edge', gold: 'hover:border-mode-gold-edge', gray: 'hover:border-mode-gray-edge' };

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{children}</h3>{aside}</div>;
}

// Static replica of the notebook screen: same header, writing panel, Studio panel, preview card, and mode tiles as the real workspace.
function EditorDemo({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useLocale();
  const [settings, setSettings] = useState<Settings>({ ...defaults, mode: 'academic' });
  const mode = settings.mode as DemoMode;
  const setMode = (value: DemoMode) => setSettings((current) => ({ ...current, mode: value }));
  const [compare, setCompare] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const sample = SAMPLES[locale];
  const result = sample.outputs[mode];
  const diff = useDiff(sample.source, result.after);
  const words = countWords(sample.source);
  const change = changePercentage(sample.source, result.after);
  const delta = wordDelta(sample.source, result.after);
  const startHref = signedIn ? '/app' : '/register';
  const title = t('Draf penelitian', 'Research draft');
  const chip = 'inline-flex h-6 items-center rounded-md px-2 text-xs font-medium';
  const compareLabel = compare ? t('Keluar dari Bandingkan', 'Exit Compare') : t('Bandingkan', 'Compare');
  const tabs: Array<[LucideIcon, string, boolean]> = [[Bot, t('Asisten', 'Assistant'), true], [History, t('Riwayat', 'History'), false], [Info, 'Info', false]];

  return <div id="contoh" className={styles.demoFrame}>
    <div className={`${styles.demo} flex flex-col font-sans text-ink-900`}>
      <header className="flex h-14 shrink-0 items-center gap-2 bg-shell px-3 sm:px-4">
        <span className="shrink-0"><Logo href="#contoh" compact /></span>
        <span className="ml-1 flex h-10 min-w-0 max-w-xl flex-1 items-center truncate rounded-lg px-2 text-[20px] font-medium tracking-[-0.01em] text-ink-950">{title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span aria-hidden="true" className="hidden h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-[13px] font-medium text-ink-800 sm:inline-flex"><Plus size={16} />Notebook</span>
          <div className="hidden items-center gap-1 lg:flex">
            <Button size="sm" variant="ghost" icon={Copy} disabled>{t('Salin', 'Copy')}</Button>
            <button type="button" aria-pressed={compare} aria-controls={compare ? 'landing-compare' : undefined} title={compareLabel} onClick={() => setCompare(!compare)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors ${compare ? 'border-brand-300 bg-brand-50 text-brand-800 ring-2 ring-brand-200' : 'border-line bg-white text-ink-700 hover:border-line-strong hover:bg-paper hover:text-ink-900'}`}>
              <Columns2 size={15} aria-hidden="true" />{t('Bandingkan', 'Compare')}
            </button>
            <Button size="sm" variant="ghost" icon={Save} disabled>{t('Simpan versi', 'Save version')}</Button>
          </div>
          <IconButton icon={EllipsisVertical} label={t('Menu lainnya', 'More')} disabled />
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800"><span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />{t('Contoh interaktif', 'Interactive example')}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 px-3 pb-3 md:grid-cols-[62fr_38fr]">
        <main aria-label={t('Tulisan', 'Writing')} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line pl-4 pr-3">
            <h3 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink-900">{t('Tulisan', 'Writing')}</h3>
            {!compare && <span className="flex shrink-0 items-center"><IconButton size="sm" icon={Undo2} label={t('Urungkan', 'Undo')} disabled /><IconButton size="sm" icon={Redo2} label={t('Ulangi', 'Redo')} disabled /></span>}
            <span className="hidden shrink-0 rounded-md bg-paper-deep px-2 py-0.5 text-xs text-ink-600 tabular-nums sm:inline"><b className="font-semibold text-ink-800">{numberFormat(words, locale)}</b> {t('kata', 'words')}</span>
            <SaveStatus state="saved" />
          </header>
          {compare ? (
            <div id="landing-compare" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-paper/60 px-4 py-2 sm:px-6">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={`${chip} bg-brand-50 text-brand-800 ring-1 ring-brand-100`}>+{delta.added} {t('kata', 'words')}</span>
                  <span className={`${chip} bg-red-50 text-red-700 ring-1 ring-red-100`}>−{delta.removed} {t('kata', 'words')}</span>
                  <span className={`${chip} bg-white text-ink-700 ring-1 ring-line`}>≈{change}% {t('berubah', 'changed')}</span>
                </span>
                <span className="ml-auto flex items-center gap-2 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" />{t('Editor dikunci selama membandingkan.', 'Editing is paused while comparing.')}</span>
                  <IconButton size="sm" icon={X} label={t('Keluar dari Bandingkan', 'Exit Compare')} onClick={() => setCompare(false)} />
                </span>
              </div>
              <div className="scrollbar-thin grid min-h-0 flex-1 divide-y divide-line overflow-y-auto bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                {(['before', 'after'] as const).map(side => (
                  <div key={side} className="min-w-0">
                    <p className="border-b border-line bg-paper/40 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{side === 'before' ? t('Versi asli', 'Original version') : t('Pratinjau AI', 'AI preview')}</p>
                    <DiffText parts={diff} side={side} className="px-5 py-5 text-[16px] leading-[1.75] text-ink-900 sm:px-8" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10 sm:py-8">
              <article className="mx-auto max-w-[760px] text-[16px] leading-[1.75] text-ink-900">
                <p><ProtectedText text={sample.source} locked={sample.locked} /></p>
                <div aria-hidden="true" className="mt-6 space-y-2.5"><span className="block h-3 w-[92%] rounded bg-paper-deep" /><span className="block h-3 w-[78%] rounded bg-paper-deep" /><span className="block h-3 w-[48%] rounded bg-paper-deep" /></div>
              </article>
            </div>
          )}
        </main>

        <section aria-label="Studio" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
          <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pl-2 pr-2">
            <div className="flex h-full min-w-0 flex-1 items-stretch gap-1">
              {tabs.map(([Icon, label, active]) => (
                <span key={label} aria-current={active ? 'true' : undefined} className={`relative inline-flex min-w-0 items-center gap-1.5 px-2.5 text-[13px] font-medium ${active ? 'text-ink-900 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-700' : 'text-ink-500'}`}>
                  <Icon size={14} aria-hidden="true" className="shrink-0" /><span className="truncate">{label}</span>
                </span>
              ))}
            </div>
            <IconButton size="sm" icon={PanelRightClose} label={t('Ciutkan Studio', 'Collapse Studio')} disabled />
          </header>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 p-4">
            <section id="landing-preview" aria-label={t('Pratinjau hasil', 'Result preview')} aria-live="polite" className="overflow-hidden rounded-xl border border-brand-200 bg-white">
              <header className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-3.5 py-2.5">
                <Eye size={15} className="text-brand-700" aria-hidden="true" />
                <p className="flex-1 text-[13px] font-semibold text-brand-900">{t('Pratinjau', 'Preview')} <span className="font-normal text-brand-700">· {t('belum diterapkan', 'not applied')}</span></p>
                <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-600 ring-1 ring-brand-100">{t('Seluruh dokumen', 'Entire document')}</span>
              </header>
              <div className="space-y-3 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-500">≈ {change}% {t('berubah', 'changed')}</span>
                  <button type="button" onClick={() => setShowDiff(!showDiff)} aria-pressed={showDiff} aria-controls="landing-preview" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-900">
                    {showDiff ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}{showDiff ? t('Sembunyikan tanda', 'Hide markup') : t('Tandai perubahan', 'Show changes')}
                  </button>
                </div>
                <div className="rounded-lg bg-paper/60 px-3 py-2.5 font-serif text-[15px] leading-relaxed text-ink-900">
                  {showDiff ? <DiffText parts={diff} /> : <p className="whitespace-pre-wrap"><ProtectedText text={result.after} locked={sample.locked} /></p>}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-ink-600">{t('Yang berubah', 'What changed')}</p>
                  <ul className="flex flex-wrap gap-1.5">{result.changes.map(item => <li key={item} className="inline-flex items-center gap-1 rounded-md bg-paper-deep px-2 py-1 text-xs text-ink-700"><Check size={12} className="text-brand-600" aria-hidden="true" />{item}</li>)}</ul>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-brand-800"><ShieldCheck size={13} aria-hidden="true" />{t('2 istilah terlindungi tetap utuh', '2 protected terms kept intact')}</p>
              </div>
              <footer className="space-y-2 border-t border-line bg-paper/40 p-3">
                <Link href={startHref} className={buttonClass('primary', 'md', 'w-full')}><Check size={17} aria-hidden="true" />{t('Gunakan Hasil Ini', 'Use This Result')}</Link>
                <div className="flex flex-wrap gap-1.5 [&>*]:flex-1">
                  <Button size="sm" icon={Columns2} aria-pressed={compare} onClick={() => setCompare(!compare)}>{t('Bandingkan', 'Compare')}</Button>
                  <Button size="sm" icon={Copy} disabled>{t('Salin', 'Copy')}</Button>
                  <Button size="sm" icon={X} disabled>{t('Buang Hasil', 'Discard')}</Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" icon={RefreshCw} disabled>{t('Coba alternatif lain', 'Try another')}</Button>
                </div>
              </footer>
            </section>

            <section aria-label={t('Mode penulisan', 'Writing mode')}>
              <SectionTitle>{t('Mode', 'Mode')}</SectionTitle>
              <div role="radiogroup" aria-label={t('Mode penulisan', 'Writing mode')} className="grid grid-cols-2 gap-2">
                {MODES.map(value => {
                  const Icon = modeIcon[value]; const tone = toneClass[modeTone[value]]; const active = value === mode;
                  return <button key={value} type="button" role="radio" aria-checked={active} title={modeHint(value, t)} onClick={() => setMode(value)}
                    className={`group relative flex h-[60px] min-w-0 flex-col justify-between rounded-xl border py-2.5 pl-3 pr-7 text-left transition-colors ${active ? `${tone.fill} ${tone.edge} ring-1 ${ringClass[modeTone[value]]}` : `border-transparent ${tone.light} ${hoverClass[modeTone[value]]}`}`}>
                    <Icon size={16} className={`shrink-0 ${tone.ink}`} aria-hidden="true" />
                    <span className={`truncate text-[13px] ${active ? 'font-semibold text-ink-900' : 'font-medium text-ink-800'}`}>{modeLabel(value, t)}</span>
                    {active ? <Check size={15} className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${tone.ink}`} aria-hidden="true" /> : <ChevronRight size={15} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
                  </button>;
                })}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-500">{modeHint(mode, t)}</p>
            </section>

            <section aria-label={t('Pengaturan mode', 'Mode settings')}>
              <SectionTitle aside={<span className="text-[11px] text-ink-500">{t('untuk', 'for')} {modeLabel(mode, t)}</span>}>{t('Pengaturan', 'Settings')}</SectionTitle>
              <div className="space-y-2">
                <ModeOptions compact settings={settings} onChange={setSettings} />
                <div className="flex items-center gap-3">
                  <label htmlFor="landing-language" className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] text-ink-600">
                    {t('Bahasa', 'Language')}
                    {settings.language === 'auto' && <span className="inline-flex items-center gap-1 truncate text-[11px] text-ink-500"><Languages size={11} aria-hidden="true" />{locale === 'id' ? 'Indonesia' : 'English'}</span>}
                  </label>
                  <div className="w-[55%] shrink-0"><HintSelect size="sm" align="end" id="landing-language" label={t('Bahasa tulisan', 'Writing language')} value={settings.language} options={languageOptions(t)} onChange={(language) => setSettings({ ...settings, language })} /></div>
                </div>
              </div>
              <div className="mt-3"><CustomizePanel settings={settings} onChange={setSettings} /></div>
            </section>
          </div>
          </div>

          <footer className="shrink-0 space-y-2.5 border-t border-line bg-white px-4 pb-4 pt-3">
            <Segmented size="sm" label={t('Bagian yang diubah', 'Scope')} value="document" onChange={() => undefined} options={[{ value: 'selection', label: t('Pilihan', 'Selection') }, { value: 'paragraph', label: t('Paragraf', 'Paragraph') }, { value: 'document', label: t('Dokumen', 'Document') }]} />
            <p className="flex items-center gap-1.5 text-xs text-ink-500"><TextSelect size={13} className="shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t('seluruh dokumen', 'entire document')} · {numberFormat(words, locale)} {t('kata', 'words')}</span></p>
            <Link href={startHref} className={`inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold ${raisedGreen} ${pressGreen}`}>{generateLabel(mode, t)}<ArrowRight size={15} aria-hidden="true" /></Link>
          </footer>
        </section>
      </div>
    </div>
  </div>;
}

function Hero({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  return <section className={styles.hero} aria-labelledby="hero-title">
    <Image className={styles.heroArt} src="/images/landing/hero.webp" alt="" width={1536} height={1024} sizes="100vw" priority />
    <div className={styles.heroCopy}>
      <h1 id="hero-title">{t('Tulisanmu, lebih jelas.', 'Your writing, clearer.')}<br />{t('Maknanya tetap milikmu.', 'The meaning stays yours.')}</h1>
      <p>{t('Parafrase dan sempurnakan tulisan dalam satu ruang kerja.', 'Paraphrase and refine your writing in one workspace.')}<br className={styles.desktopBreak} /> {t('Pilih gaya, lihat perubahan, dan tetap pegang kendali.', 'Choose a style, see the changes, and stay in control.')}</p>
      <div className={styles.heroActions}><StartLink signedIn={signedIn} arrow /><a href="#contoh" className={styles.exampleLink}>{t('Coba Contoh', 'Try Example')}<ArrowDown size={14} aria-hidden="true" /></a></div>
    </div>
    <EditorDemo signedIn={signedIn} />
  </section>;
}

function Closing({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  return <section className={styles.closing} aria-labelledby="closing-title"><span className={styles.closingMark}><Feather size={25} aria-hidden="true" /></span><h2 id="closing-title">{t('Beri ruang untuk', 'Make room for')}<br />{t('tulisan yang lebih baik.', 'better writing.')}</h2><p>{t('Dari draf pertama hingga kata yang terasa tepat.', 'From a first draft to words that feel just right.')}<br />{t('Mulai dengan tulisan yang sudah kamu punya.', 'Start with the writing you already have.')}</p><StartLink signedIn={signedIn} arrow /></section>;
}

function Footer({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  return <footer className={styles.footer}>
    <div className={styles.footerInner}>
      <div className={styles.footerTop}><div className={styles.footerAbout}><div className={styles.brand}><Logo /></div><p>{t('Ruang kerja untuk merawat ide, merapikan kata, dan menemukan suara tulisanmu.', 'Clearer writing. Your voice, preserved.')}</p></div>
        <nav aria-label={t('Navigasi produk', 'Product navigation')}><strong>{t('Produk', 'Product')}</strong><a href="#produk">{t('Fitur', 'Features')}</a><a href="#cara-kerja">{t('Cara Kerja', 'How It Works')}</a><a href="#mode">{t('Mode Penulisan', 'Writing Modes')}</a></nav>
        <nav aria-label={t('Navigasi bantuan', 'Help navigation')}><strong>{t('Jelajahi', 'Explore')}</strong><a href="#contoh">{t('Coba Contoh', 'Try Example')}</a><a href="#faq">FAQ</a></nav>
        <nav aria-label={t('Navigasi akun', 'Account navigation')}><strong>{t('Ruang Kerjamu', 'Your Workspace')}</strong>{signedIn ? <Link href="/app">Dashboard</Link> : <><Link href="/login">{t('Masuk', 'Sign In')}</Link><Link href="/register">{t('Mulai Menulis', 'Start Writing')}</Link></>}</nav>
      </div>
    </div>
  </footer>;
}

function LandingContent() {
  const signedIn = useSignedIn();
  const { t } = useLocale();
  return <div id="page-top" lang="en" className={styles.page}><div className={styles.canvas}><a className={styles.skipLink} href="#main-content">{t('Lewati ke konten', 'Skip to content')}</a><Nav signedIn={signedIn} /><main id="main-content"><Hero signedIn={signedIn} /><SupportingSections /></main><div className={styles.ending}><Image className={styles.endingArt} src="/images/landing/hero.webp" alt="" width={1536} height={1024} sizes="100vw" /><Closing signedIn={signedIn} /><Footer signedIn={signedIn} /></div></div></div>;
}

export function Landing() {
  return <LocaleScope locale="en"><LandingContent /></LocaleScope>;
}
