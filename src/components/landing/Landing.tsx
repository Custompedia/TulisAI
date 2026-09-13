'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronDown, Columns2, Feather, FileText, History, LockKeyhole, Menu, PanelLeft, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { request } from '@/lib/client/api';
import { Logo } from '@/components/ui/Logo';
import { MODES, modeIcon, modeLabel } from '@/components/writing/modes';
import { DiffText, useDiff } from '@/components/workspace/DiffText';
import type { Mode } from '@/lib/writing/settings';
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

function LocaleToggle() {
  const { locale, setLocale, t } = useLocale();
  return <div className={styles.locale} role="group" aria-label={t('Bahasa antarmuka', 'Interface language')}>
    {(['id', 'en'] as const).map(value => <button type="button" key={value} aria-pressed={locale === value} onClick={() => setLocale(value)}>{value.toUpperCase()}</button>)}
  </div>;
}

function Nav({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const links = [{ href: '#produk', label: t('Produk', 'Product') }, { href: '#cara-kerja', label: t('Cara Kerja', 'How It Works') }, { href: '#mode', label: t('Mode', 'Modes') }, { href: '#faq', label: 'FAQ' }];
  return <header className={styles.header} onKeyDown={event => { if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); } }}>
    <nav className={styles.nav} aria-label={t('Navigasi utama', 'Main navigation')}>
      <div className={styles.brand}><Logo /></div>
      <div className={styles.navLinks}>{links.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}</div>
      <div className={styles.navActions}><LocaleToggle />{!signedIn && <Link className={styles.signIn} href="/login">{t('Masuk', 'Sign In')}</Link>}<StartLink signedIn={signedIn} /></div>
      <button ref={toggle} type="button" className={styles.menuToggle} aria-expanded={open} aria-controls="landing-menu" aria-label={open ? t('Tutup menu', 'Close menu') : t('Buka menu', 'Open menu')} onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      <div id="landing-menu" className={styles.mobileMenu} hidden={!open}>
        {links.map(link => <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}
        <LocaleToggle />{!signedIn && <Link href="/login">{t('Masuk', 'Sign In')}</Link>}<StartLink signedIn={signedIn} />
      </div>
    </nav>
  </header>;
}

function ProtectedText({ text, locked }: { text: string; locked: string[] }) {
  const pattern = new RegExp(`(${locked.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{text.split(pattern).map((part, index) => locked.includes(part) ? <mark key={index} className={styles.protected}>{part}</mark> : <span key={index}>{part}</span>)}</>;
}

function EditorDemo({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useLocale();
  const [mode, setMode] = useState<DemoMode>('academic');
  const [compare, setCompare] = useState(false);
  const sample = SAMPLES[locale];
  const result = sample.outputs[mode];
  const diff = useDiff(sample.source, result.after);
  const ModeIcon = modeIcon[mode];
  return <div id="contoh" className={styles.demoFrame}>
    <div className={styles.demo}>
      <div className={styles.editorTop}>
        <span className={styles.editorIdentity}><span className={styles.tinyLogo}><Feather size={13} aria-hidden="true" /></span><span>AI Writing</span><PanelLeft size={14} aria-hidden="true" /></span>
        <span className={styles.documentName}><FileText size={14} aria-hidden="true" />{t('Draf penelitian', 'Research draft')}</span>
        <span className={styles.demoBadge}><span />{t('Contoh interaktif', 'Interactive example')}</span>
      </div>
      <div className={styles.editorBody}>
        <aside className={styles.editorSidebar} aria-label={t('Ilustrasi ruang kerja', 'Workspace illustration')}>
          <span className={styles.sidebarHeading}>{t('RUANG KERJA', 'WORKSPACE')}</span>
          <span className={styles.sidebarActive}><FileText size={14} aria-hidden="true" />{t('Dokumen saya', 'My documents')}</span>
          <span className={styles.sidebarItem}><History size={14} aria-hidden="true" />{t('Riwayat versi', 'Version history')}</span>
          <div className={styles.sidebarDocument}><span className={styles.documentIcon}><FileText size={20} aria-hidden="true" /></span><strong>{t('Draf penelitian', 'Research draft')}</strong><small>{t('Bahasa Indonesia', 'English')}</small></div>
          <div className={styles.sidebarBottom}><ShieldCheck size={16} aria-hidden="true" /><p>{t('Tulisan asli tetap ada. Selalu.', 'Your original stays. Always.')}</p></div>
        </aside>
        <div className={styles.editorContent}>
          <div className={styles.editorToolbar}>
            <span>{t('Dokumen', 'Document')} <ChevronDown size={11} aria-hidden="true" /></span><i /><span aria-hidden="true"><b>B</b><em>I</em><u>U</u></span><i /><span className={styles.toolbarText}>{t('Teks asli', 'Original text')}</span>
            <button type="button" aria-pressed={compare} aria-controls="landing-preview" onClick={() => setCompare(!compare)}><Columns2 size={13} aria-hidden="true" />{compare ? t('Tutup perbandingan', 'Close comparison') : t('Bandingkan', 'Compare')}</button>
          </div>
          <div className={styles.editorPanels}>
            <article className={styles.document}>
              <div className={styles.paperMeta}><span>{t('DRAF / 001', 'DRAFT / 001')}</span><span><span className={styles.statusDot} />{t('Versi asli', 'Original version')}</span></div>
              <h2>{t('Teknologi dan cara kita belajar', 'Technology and how we learn')}</h2>
              <p className={styles.paperSubtitle}>{t('Latar belakang penelitian', 'Research background')}</p>
              <p className={styles.paperText}><ProtectedText text={sample.source} locked={sample.locked} /></p>
              <div className={styles.paperRule} /><div className={styles.paperRuleShort} />
              <div className={styles.lockedTerms}><span><LockKeyhole size={12} aria-hidden="true" />{t('Istilah & sitasi terlindungi', 'Protected terms & citations')}</span>{sample.locked.map(term => <small key={term}>{term}</small>)}</div>
            </article>
            <aside className={styles.assistant} aria-label={t('Contoh saran AI', 'Example AI suggestion')}>
              <div className={styles.assistantTitle}><span className={styles.tinyLogo}><Sparkles size={13} aria-hidden="true" /></span><strong>{t('Asisten menulis', 'Writing assistant')}</strong><span className={styles.assistantDot} /></div>
              <p className={styles.modePrompt}>{t('Mau dibawa ke arah mana?', 'Where will your words go?')}</p>
              <div className={styles.modeButtons} role="group" aria-label={t('Mode contoh', 'Example modes')}>{MODES.map(value => { const Icon = modeIcon[value]; return <button type="button" key={value} aria-pressed={value === mode} onClick={() => setMode(value)}><Icon size={13} aria-hidden="true" />{modeLabel(value, t)}</button>; })}</div>
              <div id="landing-preview" className={styles.suggestion} aria-live="polite" aria-atomic="true">
                <div className={styles.suggestionLabel}><ModeIcon size={13} aria-hidden="true" /><strong>{modeLabel(mode, t)}</strong><span>{compare ? t('Perubahan', 'Changes') : t('Pratinjau', 'Preview')}</span></div>
                {compare ? <DiffText parts={diff} className={styles.resultText} /> : <p className={styles.resultText}><ProtectedText text={result.after} locked={sample.locked} /></p>}
                <div className={styles.resultChecks}>{result.changes.map(change => <span key={change}><Check size={11} aria-hidden="true" />{change}</span>)}</div>
              </div>
              <p className={styles.protectionStatus}><ShieldCheck size={12} aria-hidden="true" />{t('2 istilah terlindungi tetap utuh', '2 protected terms kept intact')}</p>
              <Link className={styles.demoCta} href={signedIn ? '/app' : '/register'}>{t('Coba dengan tulisanmu', 'Try with your own text')}<ArrowRight size={13} aria-hidden="true" /></Link>
            </aside>
          </div>
          <div className={styles.editorBottom}><span><History size={12} aria-hidden="true" />{t('Versi asli', 'Original version')}<span className={styles.versionLine} /><span className={styles.versionCurrent}>{t('Pratinjau AI', 'AI preview')}</span></span><small>{t('Contoh ilustrasi', 'Illustrative example')}</small></div>
        </div>
      </div>
    </div>
  </div>;
}

function Hero({ signedIn }: { signedIn: boolean }) {
  const { t } = useLocale();
  return <section className={styles.hero} aria-labelledby="hero-title">
    <Image className={styles.heroArt} src="/images/landing/hero.webp" alt="" width={1536} height={1024} sizes="100vw" priority />
    <div className={styles.heroCopy}>
      <span className={styles.eyebrow}><span />{t('RUANG UNTUK IDE, KENDALI UNTUKMU', 'ROOM FOR IDEAS, CONTROL FOR YOU')}</span>
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
    <div className={styles.footerCard}>
      <div className={styles.footerTop}><div className={styles.footerAbout}><div className={styles.brand}><Logo /></div><p>{t('Ruang kerja untuk merawat ide, merapikan kata, dan menemukan suara tulisanmu.', 'A workspace to nurture ideas, refine words, and find your writing voice.')}</p></div>
        <nav aria-label={t('Navigasi produk', 'Product navigation')}><strong>{t('Produk', 'Product')}</strong><a href="#produk">{t('Fitur', 'Features')}</a><a href="#cara-kerja">{t('Cara Kerja', 'How It Works')}</a><a href="#mode">{t('Mode Penulisan', 'Writing Modes')}</a></nav>
        <nav aria-label={t('Navigasi bantuan', 'Help navigation')}><strong>{t('Jelajahi', 'Explore')}</strong><a href="#contoh">{t('Coba Contoh', 'Try Example')}</a><a href="#faq">FAQ</a></nav>
        <nav aria-label={t('Navigasi akun', 'Account navigation')}><strong>{t('Ruang Kerjamu', 'Your Workspace')}</strong>{signedIn ? <Link href="/app">Dashboard</Link> : <><Link href="/login">{t('Masuk', 'Sign In')}</Link><Link href="/register">{t('Mulai Menulis', 'Start Writing')}</Link></>}</nav>
      </div>
      <p className={styles.copyright}>© {new Date().getFullYear()} AI Writing Workspace. {t('Semua hak dilindungi.', 'All rights reserved.')}</p>
      <div className={styles.wordmark} aria-hidden="true">AI Writing</div>
    </div>
    <Image className={styles.footerArt} src="/images/landing/footer.webp" alt="" width={1536} height={1024} sizes="100vw" />
  </footer>;
}

export function Landing() {
  const signedIn = useSignedIn();
  const { t } = useLocale();
  return <div className={styles.page}><div className={styles.canvas}><a className={styles.skipLink} href="#main-content">{t('Lewati ke konten', 'Skip to content')}</a><Nav signedIn={signedIn} /><main id="main-content"><Hero signedIn={signedIn} /><SupportingSections /><Closing signedIn={signedIn} /></main><Footer signedIn={signedIn} /></div></div>;
}
