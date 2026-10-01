'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, LayoutTemplate, ScanText, Upload } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { shownTitle } from '@/lib/writing/title';
import { errorText, request } from '@/lib/client/api';
import { numberFormat, relativeTime } from '@/lib/client/format';
import { shortDate, tierName } from '@/lib/client/quota';
import { useWritingStyles } from '@/lib/client/styles-store';
import { docTypeShort, skeletonOrder } from '@/lib/writing/doc-types';
import { asMode } from '@/lib/writing/settings';
import { notebookTone } from '@/lib/notebook/appearance';
import { requiredTierFor } from '@/lib/plans';
import { useEntitlements, useSessionGuard, useShell, type DocumentSummary } from '@/components/app/AppShell';
import { Composer } from '@/components/compose/Composer';
import { NotebookIcon } from '@/components/app/NotebookIcon';
import { KIND_ICONS } from '@/components/app/NewWritingDialog';
import { PaidLock, useRequiredTierName } from '@/components/app/PaidLock';
import { useCreateNotebook, type NewKind } from '@/components/app/new-writing';
import { COMPOSER_FOCUS_EVENT, COMPOSER_STYLE_EVENT, openPlans, requestNewWriting, showLockedFeature } from '@/components/app/shell-events';
import { HashLink } from '@/components/ui/HashLink';
import { Menu } from '@/components/ui/Menu';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { StyleMark } from '@/components/writing/StyleMark';
import { modeLabel, toneClass } from '@/components/writing/modes';

const CHIP = 'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-white px-3.5 text-[13px] font-medium text-ink-800 shadow-[0_1px_2px_rgb(31_32_29/0.04)] transition-colors hover:border-brand-300 hover:bg-brand-50/50 disabled:cursor-wait disabled:opacity-60';
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500';
const RECENT = 6;

export default function HomePage() {
  const { t } = useLocale();
  const { user, settings: prefs } = useShell();
  const guard = useSessionGuard();
  const { locale } = useLocale();
  const name = user.name.split(' ')[0] || user.name;
  const [recent, setRecent] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    request<{ items: DocumentSummary[] }>(`/api/documents?limit=${RECENT}`)
      .then((page) => { if (live) setRecent(page.items); })
      .catch((caught) => { if (live && !guard(caught)) { setRecent([]); setError(errorText(caught, locale === 'en')); } });
    return () => { live = false; };
  }, [guard, locale]);

  const firstVisit = recent !== null && recent.length === 0 && !error;
  return (
    <main className="mx-auto w-full max-w-[880px] space-y-9 px-4 pb-14 pt-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-medium leading-tight tracking-[-0.045em] text-ink-900 sm:text-[32px]">{t(`Hai, ${name}!`, `Hi, ${name}!`)}</h1>
        <p className="mt-1.5 text-[15px] text-ink-500">{t('Mulai dari kerangka, atau olah teks yang sudah ada.', 'Start from an outline, or work on text you already have.')}</p>
      </header>

      {firstVisit && <FirstVisit />}
      <SkeletonChips useCase={prefs.primaryUseCase} />

      <section aria-labelledby="home-compose">
        <h2 id="home-compose" className={`${SECTION_LABEL} mb-2.5`}>{t('Olah teks yang sudah ada', 'Work on existing text')}</h2>
        <Composer />
      </section>

      {recent === null ? (
        <section aria-label={t('Memuat notebook terakhir…', 'Loading recent notebooks…')} role="status" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[68px] animate-pulse rounded-xl bg-paper-deep" />)}
        </section>
      ) : recent.length > 0 && <Recent docs={recent} />}

      <div className="grid gap-4 md:grid-cols-2">
        <MySkills />
        <QuotaCard />
      </div>
      {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Notebook terakhir tidak bisa dimuat', 'Could not load recent notebooks')}>{error}</Toast>}
    </main>
  );
}

// One click makes a notebook with the outline and opens it; the same skeletons as the Tulis baru dialog.
function SkeletonChips({ useCase }: { useCase: string }) {
  const { t } = useLocale();
  const { create, busy, error, clearError } = useCreateNotebook();
  const order = skeletonOrder(useCase);
  const shown = order.slice(0, 5); const more = order.slice(5);
  const chip = (kind: NewKind, label: string) => {
    const Icon = KIND_ICONS[kind];
    return (
      <button key={kind} type="button" className={CHIP} disabled={busy !== null} aria-busy={busy === kind || undefined} onClick={() => void create(kind)}>
        {busy === kind ? <Spinner size={14} /> : <Icon size={15} aria-hidden="true" className="text-brand-700" />}{label}
      </button>
    );
  };
  return (
    <section aria-labelledby="home-skeletons">
      <h2 id="home-skeletons" className={`${SECTION_LABEL} mb-2.5`}>{t('Kerangka siap isi · tanpa AI', 'Ready-to-fill outlines · no AI')}</h2>
      <div className="flex flex-wrap gap-2">
        {shown.map((type) => chip(type, docTypeShort(type, t)))}
        {chip('blank', t('Kosong', 'Blank'))}
        <Menu label={t('Kerangka lainnya', 'More outlines')} align="start" disabled={busy !== null} triggerClassName={CHIP}
          trigger={<>{t('Lainnya', 'More')}<ChevronDown size={14} aria-hidden="true" /></>}
          items={more.map((type) => ({ label: docTypeShort(type, t), icon: KIND_ICONS[type], onSelect: () => void create(type) }))} />
      </div>
      {error && <Toast tone="error" onDismiss={clearError} dismissLabel={t('Tutup', 'Dismiss')} title={t('Notebook gagal dibuat', 'Could not create notebook')}>{error}</Toast>}
    </section>
  );
}

// Shown until the first notebook exists, in place of "Lanjutkan menulis".
function FirstVisit() {
  const { t } = useLocale();
  const { has } = useEntitlements();
  const importTier = useRequiredTierName('docx_import');
  const card = 'flex min-h-[112px] flex-col items-start gap-2 rounded-2xl border border-line bg-white p-4 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40';
  return (
    <section aria-label={t('Mulai di sini', 'Start here')} className="grid gap-3 sm:grid-cols-3">
      <button type="button" className={card} onClick={() => requestNewWriting()}>
        <LayoutTemplate size={20} aria-hidden="true" className="text-brand-700" /><span className="text-[14px] font-semibold text-ink-900">{t('Mulai dari kerangka', 'Start from an outline')}</span>
        <span className="text-xs leading-relaxed text-ink-500">{t('Artikel, script, esai, email… judul bagiannya sudah siap.', 'Article, script, essay, email… the section headings are ready.')}</span>
      </button>
      <button type="button" className={card} onClick={() => window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT))}>
        <ScanText size={20} aria-hidden="true" className="text-brand-700" /><span className="text-[14px] font-semibold text-ink-900">{t('Tempel & olah teks', 'Paste & work on text')}</span>
        <span className="text-xs leading-relaxed text-ink-500">{t('Parafrase, humanize, atau rapikan teks yang sudah ada.', 'Paraphrase, humanize, or polish text you already have.')}</span>
      </button>
      <button type="button" className={card} onClick={() => (has('docx_import') ? requestNewWriting() : showLockedFeature(requiredTierFor('docx_import')))}>
        <Upload size={20} aria-hidden="true" className={has('docx_import') ? 'text-brand-700' : 'text-ink-400'} />
        <span className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-900">{t('Impor DOCX', 'Import DOCX')}{!has('docx_import') && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-500"><PaidLock size={12} />{importTier}</span>}</span>
        <span className="text-xs leading-relaxed text-ink-500">{t('Bawa dokumen Word lengkap dengan tata letaknya.', 'Bring in a Word document with its layout.')}</span>
      </button>
    </section>
  );
}

function Recent({ docs }: { docs: DocumentSummary[] }) {
  const { t, locale } = useLocale();
  return (
    <section aria-labelledby="home-recent">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 id="home-recent" className={SECTION_LABEL}>{t('Lanjutkan menulis', 'Continue writing')}</h2>
        <Link href="/notebooks" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-800 hover:text-ink-900">{t('Lihat semua', 'See all')}<ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {docs.map((doc) => {
          const mode = asMode(doc.mode); const tone = toneClass[notebookTone(doc.color, doc.mode)];
          return (
            <li key={doc.id}>
              <Link href={`/notebooks/${doc.id}`} className="flex h-[68px] items-center gap-3 rounded-xl border border-line bg-white px-3 transition-colors hover:border-line-strong hover:bg-paper/60">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone.fill} ${tone.ink}`}><NotebookIcon icon={doc.icon} mode={doc.mode} size={19} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink-900">{shownTitle(doc.title, t)}</span>
                  <span className="block truncate text-xs text-ink-500">{t('Diedit', 'Edited')} {relativeTime(doc.updatedAt, locale)}{mode ? ` · ${modeLabel(mode, t)}` : ''}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Hidden for accounts with no skill and no Plus, so it never turns into an advert.
function MySkills() {
  const { t } = useLocale();
  const { has } = useEntitlements();
  const { styles, loading } = useWritingStyles();
  const locked = !has('saved_styles');
  if (loading || (styles.length === 0 && locked)) return null;
  return (
    <section aria-labelledby="home-skills" className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="home-skills" className={SECTION_LABEL}>{t('Skill saya', 'My skills')}</h2>
        <Link href="/skills" className="text-[13px] font-semibold text-brand-800 hover:text-ink-900">{t('Kelola', 'Manage')}</Link>
      </div>
      {styles.length === 0 ? <p className="text-[13px] text-ink-500">{t('Belum ada skill tersimpan.', 'No saved skills yet.')}</p> : (
        <div className="flex flex-wrap gap-2">
          {styles.map((style) => (
            <button key={style.id} type="button" onClick={() => (locked ? openPlans() : window.dispatchEvent(new CustomEvent(COMPOSER_STYLE_EVENT, { detail: style.id })))}
              className={`inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-line bg-white py-1 pl-1.5 pr-3 text-[13px] font-medium transition-colors hover:border-line-strong hover:bg-paper ${locked ? 'text-ink-500' : 'text-ink-800'}`}>
              {locked ? <PaidLock size={14} className="ml-1" /> : <StyleMark style={style} size={24} />}<span className="truncate">{style.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// Remaining characters, the per-run limit and the plan; "Lihat paket" stays a small secondary link.
function QuotaCard() {
  const { t, locale } = useLocale();
  const { usage } = useShell();
  const { tier, limits } = useEntitlements();
  if (!usage) return null;
  const oneTime = usage.characterScope === 'account';
  const paidUntil = usage.access?.paidUntil ?? null;
  return (
    <section aria-labelledby="home-quota" className="rounded-2xl border border-line bg-white p-4">
      <h2 id="home-quota" className={SECTION_LABEL}>{t('Karakter AI', 'AI characters')}</h2>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-950 tabular-nums">{numberFormat(usage.charactersRemaining, locale)}<span className="ml-1.5 text-sm font-medium text-ink-500">{oneTime ? t('sisa · sekali pakai', 'left · one-time') : t('sisa · bulan ini', 'left · this month')}</span></p>
      <p className="mt-1 text-[13px] text-ink-600">{t(`Maks. ${numberFormat(limits.runLimit, 'id')} karakter per proses`, `Up to ${numberFormat(limits.runLimit, 'en')} characters per run`)}</p>
      <p className="mt-0.5 text-[13px] text-ink-600">{t('Paket', 'Plan')} {tierName(tier, t)}{tier !== 'free' && paidUntil ? ` · ${t(`berlaku s.d. ${shortDate(paidUntil, 'id')}`, `valid until ${shortDate(paidUntil, 'en')}`)}` : ''}</p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <HashLink href="/settings#pemakaian" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-800 hover:text-ink-900">{t('Rincian pemakaian', 'Usage details')}<ArrowRight size={14} aria-hidden="true" /></HashLink>
        <button type="button" onClick={openPlans} className="text-[12px] font-medium text-ink-500 underline decoration-line-strong underline-offset-2 hover:text-ink-900">{t('Lihat paket', 'See plans')}</button>
      </div>
    </section>
  );
}
