'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, ClipboardList, Clapperboard, File, GraduationCap, Mail, MessageSquareText, Newspaper, RotateCcw, ScanText,
  ShoppingBag, SlidersHorizontal, Sparkles, Upload, X, type LucideIcon,
} from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { useWritingStyles } from '@/lib/client/styles-store';
import { DOC_TYPES, defaultTitle, docTypeLabel, type DocType } from '@/lib/writing/doc-types';
import { requiredTierFor } from '@/lib/plans';
import type { WritingLanguage } from '@/lib/writing/settings';
import type { NotebookAppearance } from '@/lib/notebook/appearance';
import { Composer } from '@/components/compose/Composer';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { requestSummary } from '@/components/writing/modes';
import { StyleMark } from '@/components/writing/StyleMark';
import { AppearanceFields } from './AppearancePicker';
import { useEntitlements } from './AppShell';
import { PaidLock, useRequiredTierName } from './PaidLock';
import { showLockedFeature } from './shell-events';
import { useCreateNotebook, type NewKind } from './new-writing';

export const DOC_TYPE_ICONS: Record<DocType, LucideIcon> = {
  article: Newspaper, script: Clapperboard, caption: MessageSquareText, essay: GraduationCap, report: ClipboardList, email: Mail, product: ShoppingBag, story: BookOpen,
};
export const KIND_ICONS: Record<NewKind, LucideIcon> = { ...DOC_TYPE_ICONS, blank: File };

export type Step = 'pick' | 'rewrite' | 'skill';
type Props = { initialStep: Step; initialStyleId?: string; onClose: () => void; onImport: () => void };

const CARD = 'group relative flex min-h-[76px] w-full flex-col items-start gap-1.5 rounded-xl border border-line bg-white p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-wait disabled:opacity-60';

// "Tulis baru": at most two clicks to an open notebook. A skeleton or Kosong card creates straight away;
// Olah teks, Impor DOCX and Pakai skill have a second step. Phones get the same cards as a full-screen sheet.
export function NewWritingDialog({ initialStep, initialStyleId, onClose, onImport }: Props) {
  const { t, locale } = useLocale();
  const { has } = useEntitlements();
  const { styles, loading: stylesLoading } = useWritingStyles();
  const { create, busy, error, clearError } = useCreateNotebook();
  const [step, setStep] = useState<Step>(initialStep);
  const [styleId, setStyleId] = useState<string | undefined>(initialStyleId);
  const [options, setOptions] = useState<NewKind | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const importTier = useRequiredTierName('docx_import');
  const skillTier = useRequiredTierName('saved_styles');
  const pagedTier = useRequiredTierName('advanced_notebook');
  const canImport = has('docx_import');
  const canSkill = has('saved_styles');

  useEffect(() => { const node = ref.current; if (node && !node.open) node.showModal(); return () => node?.close(); }, []);

  const title = step === 'rewrite' ? t('Olah teks yang sudah ada', 'Work on existing text') : step === 'skill' ? t('Pakai skill', 'Use a skill') : options ? t('Opsi notebook', 'Notebook options') : t('Tulis baru', 'New writing');
  const back = step !== 'pick' || options ? () => { if (options) setOptions(null); else { setStep('pick'); setStyleId(undefined); } } : null;
  const busyAny = busy !== null;

  const pickCard = (kind: NewKind) => { void create(kind); };
  const pickImport = () => { if (canImport) onImport(); else showLockedFeature(requiredTierFor('docx_import')); };
  const pickSkill = () => { if (canSkill) setStep('skill'); else showLockedFeature(requiredTierFor('saved_styles')); };

  return (
    <dialog ref={ref} aria-labelledby="new-writing-title" onCancel={(event) => { event.preventDefault(); if (!busyAny) onClose(); }}
      onClick={(event) => { if (event.target === ref.current && !busyAny) onClose(); }}
      className="m-0 h-dvh max-h-none w-full max-w-none border-0 bg-white p-0 text-ink-900 shadow-2xl backdrop:bg-ink-900/40 sm:m-auto sm:h-auto sm:max-h-[min(88vh,calc(100dvh-4rem))] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-line">
      <div className="flex h-full max-h-[inherit] flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3.5 sm:px-6">
          {back && <button type="button" onClick={back} disabled={busyAny} aria-label={t('Kembali', 'Back')} title={t('Kembali', 'Back')} className="-ml-1.5 grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40"><ArrowLeft size={18} aria-hidden="true" /></button>}
          <h2 id="new-writing-title" className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} disabled={busyAny} aria-label={t('Batal', 'Cancel')} title={t('Batal', 'Cancel')} className="-mr-1.5 grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40"><X size={18} aria-hidden="true" /></button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {step === 'rewrite' ? (
            <Composer embedded />
          ) : step === 'skill' ? (
            styleId ? <Composer embedded initialStyleId={styleId} /> : (
              <div>
                <p className="mb-3 text-sm text-ink-600">{t('Pilih skill, lalu tempel teks yang ingin diolah dengan gaya itu.', 'Pick a skill, then paste the text you want to work on in that style.')}</p>
                {stylesLoading ? <div className="grid gap-2 sm:grid-cols-2" role="status">{[0, 1].map((key) => <div key={key} className="h-16 animate-pulse rounded-xl bg-paper-deep" />)}</div>
                  : styles.length === 0 ? <p className="rounded-xl border border-dashed border-line-strong bg-paper/60 px-4 py-3 text-sm text-ink-600">{t('Belum ada skill tersimpan. Buat skill di halaman Skill, lalu kembali ke sini.', 'No saved skills yet. Create one on the Skill page, then come back here.')}</p>
                  : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {styles.map((style) => (
                        <li key={style.id}>
                          <button type="button" onClick={() => setStyleId(style.id)} className={`${CARD} flex-row items-center gap-3`}>
                            <StyleMark style={style} size={32} />
                            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-ink-900">{style.name}</span><span className="block truncate text-xs text-ink-500">{style.description || requestSummary(style.settings, t)}</span></span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )
          ) : options ? (
            <OptionsForm kind={options} busy={busy === options} canPaged={has('advanced_notebook')} pagedTier={pagedTier} defaultName={defaultTitle(options === 'blank' ? null : options, new Date(), locale)}
              onCreate={(value) => void create(options, value)} />
          ) : (
            <>
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{t('Kerangka siap isi · tanpa AI', 'Ready-to-fill outlines · no AI')}</p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DOC_TYPES.map((type) => (
                  <li key={type}><KindCard kind={type} label={docTypeLabel(type, t)} busy={busy === type} disabled={busyAny} onPick={() => pickCard(type)} onOptions={() => setOptions(type)} /></li>
                ))}
              </ul>
              <p className="mb-2.5 mt-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{t('Atau mulai dari', 'Or start from')}</p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <li><KindCard kind="blank" label={t('Kosong', 'Blank')} busy={busy === 'blank'} disabled={busyAny} onPick={() => pickCard('blank')} onOptions={() => setOptions('blank')} /></li>
                <li><ActionCard icon={ScanText} label={t('Olah teks', 'Work on text')} hint={t('Tempel teks, pilih mode', 'Paste text, pick a mode')} disabled={busyAny} onPick={() => setStep('rewrite')} /></li>
                <li><ActionCard icon={Upload} label={t('Impor DOCX', 'Import DOCX')} hint={canImport ? t('Dibuka di kanvas Halaman', 'Opens on the Page canvas') : importTier} locked={!canImport} disabled={busyAny} onPick={pickImport} /></li>
                <li><ActionCard icon={Sparkles} label={t('Pakai skill', 'Use a skill')} hint={canSkill ? t('Gaya tulisan tersimpan', 'A saved writing style') : skillTier} locked={!canSkill} disabled={busyAny} onPick={pickSkill} /></li>
              </ul>
              <p className="mt-5 text-xs leading-relaxed text-ink-500">{t('Kerangka hanya berisi judul bagian. AI Tulis Lab mengolah teks yang sudah kamu tulis; ia tidak menulis dari nol.', 'An outline holds section headings only. Tulis Lab’s AI works on text you have written; it does not write from scratch.')}</p>
            </>
          )}
        </div>
        {(step !== 'pick' || options) && (
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-paper/60 px-4 py-3 sm:px-6">
            <Button onClick={onClose} disabled={busyAny}>{t('Batal', 'Cancel')}</Button>
            {back && <Button onClick={back} disabled={busyAny} icon={ArrowLeft}>{t('Kembali', 'Back')}</Button>}
            {options && <Button variant="primary" type="submit" form="new-writing-options" loading={busy === options} disabled={busyAny}>{t('Buat notebook', 'Create notebook')}</Button>}
          </footer>
        )}
      </div>
      {error && <Toast tone="error" onDismiss={clearError} dismissLabel={t('Tutup', 'Dismiss')} title={t('Notebook gagal dibuat', 'Could not create notebook')}>{error}</Toast>}
    </dialog>
  );
}

function KindCard({ kind, label, busy, disabled, onPick, onOptions }: { kind: NewKind; label: string; busy: boolean; disabled: boolean; onPick: () => void; onOptions: () => void }) {
  const { t } = useLocale();
  const Icon = KIND_ICONS[kind];
  return (
    <div className="relative">
      <button type="button" onClick={onPick} disabled={disabled} aria-busy={busy || undefined} className={CARD}>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">{busy ? <Spinner size={15} /> : <Icon size={17} aria-hidden="true" />}</span>
        <span className="pr-10 text-[13.5px] font-semibold leading-snug text-ink-900">{label}</span>
      </button>
      <button type="button" onClick={onOptions} disabled={disabled} title={t(`Opsi untuk ${label}`, `Options for ${label}`)} aria-label={t(`Opsi untuk ${label}`, `Options for ${label}`)}
        className="absolute right-1.5 top-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-ink-500 transition-colors hover:bg-paper-deep hover:text-ink-900 disabled:opacity-40">
        <SlidersHorizontal size={12} aria-hidden="true" />{t('Opsi', 'Options')}
      </button>
    </div>
  );
}

function ActionCard({ icon: Icon, label, hint, locked, disabled, onPick }: { icon: LucideIcon; label: string; hint: string; locked?: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} disabled={disabled} className={`${CARD} ${locked ? 'text-ink-500' : ''}`}>
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${locked ? 'bg-paper-deep text-ink-400' : 'bg-brand-50 text-brand-700'}`}><Icon size={17} aria-hidden="true" /></span>
      <span className={`text-[13.5px] font-semibold leading-snug ${locked ? 'text-ink-600' : 'text-ink-900'}`}>{label}</span>
      <span className="flex items-center gap-1 text-[11.5px] text-ink-500">{locked && <PaidLock size={11} />}{hint}</span>
    </button>
  );
}

type OptionValue = { title: string; language: WritingLanguage; color: string | null; icon: string | null; paged: boolean };

// Title, icon & colour, language and the Halaman canvas; the canvas flag is only offered, and sent, with advanced_notebook.
function OptionsForm({ kind, busy, canPaged, pagedTier, defaultName, onCreate }: { kind: NewKind; busy: boolean; canPaged: boolean; pagedTier: string; defaultName: string; onCreate: (value: OptionValue) => void }) {
  const { t } = useLocale();
  const [name, setName] = useState(defaultName);
  const [language, setLanguage] = useState<WritingLanguage>('auto');
  const [appearance, setAppearance] = useState<NotebookAppearance>({ color: null, icon: null });
  const [paged, setPaged] = useState(false);
  const Icon = KIND_ICONS[kind];
  return (
    <form id="new-writing-options" onSubmit={(event) => { event.preventDefault(); onCreate({ title: name, language, color: appearance.color, icon: appearance.icon, paged: canPaged && paged }); }} className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-800"><Icon size={16} aria-hidden="true" className="text-brand-700" />{kind === 'blank' ? t('Notebook kosong', 'Blank notebook') : docTypeLabel(kind, t)}</div>
      <div>
        <label htmlFor="new-writing-title-input" className="text-[13px] font-semibold text-ink-700">{t('Judul', 'Title')}</label>
        <input id="new-writing-title-input" autoFocus className={`${inputClass} mt-1.5`} value={name} maxLength={180} disabled={busy} onChange={(event) => setName(event.target.value)} />
      </div>
      <div>
        <label htmlFor="new-writing-language" className="text-[13px] font-semibold text-ink-700">{t('Bahasa tulisan', 'Writing language')}</label>
        <select id="new-writing-language" className={`${inputClass} mt-1.5`} value={language} disabled={busy} onChange={(event) => setLanguage(event.target.value as WritingLanguage)}>
          <option value="auto">{t('Auto (ikuti akun)', 'Auto (account default)')}</option><option value="id">Indonesia</option><option value="en">English</option>
        </select>
      </div>
      <div>
        <p className="text-[13px] font-semibold text-ink-700">{t('Ikon & warna', 'Icon & colour')}</p>
        <div className="mt-1.5 overflow-hidden rounded-xl border border-line bg-white">
          <AppearanceFields color={appearance.color} icon={appearance.icon} mode={null} onSelect={setAppearance} gridHeight="max-h-36"
            trailing={<button type="button" onClick={() => setAppearance({ color: null, icon: null })} disabled={!appearance.color && !appearance.icon}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-ink-500 outline-none hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40"><RotateCcw size={13} aria-hidden="true" />{t('Default', 'Default')}</button>} />
        </div>
      </div>
      <label className={`flex items-center gap-2.5 text-[13px] ${canPaged ? 'text-ink-800' : 'text-ink-500'}`}>
        <input type="checkbox" checked={canPaged && paged} disabled={!canPaged || busy} onChange={(event) => setPaged(event.target.checked)} className="h-4 w-4 accent-brand-700" />
        {t('Buka di kanvas Halaman', 'Open on the Page canvas')}
        {!canPaged && <span className="inline-flex items-center gap-1 text-[12px] text-ink-500"><PaidLock size={12} />{pagedTier}</span>}
      </label>
    </form>
  );
}
