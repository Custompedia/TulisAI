'use client';
import { ArrowRight, BookmarkPlus, Check, ChevronRight, Languages, PencilLine, Plus, RefreshCw, Sparkles, TextSelect, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { notebookTone } from '@/lib/notebook/appearance';
import { AI_SCOPE_LIMIT, SELECTION_LIMIT, type Mode, type Settings } from '@/lib/writing/settings';
import { STYLE_LIMIT, type WritingStyle } from '@/lib/writing/styles';
import { NotebookIcon } from '@/components/app/NotebookIcon';
import { Alert } from '@/components/ui/Alert';
import { Button, pillButton, pressGreen, raisedGreen } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import { Spinner } from '@/components/ui/Spinner';
import { CustomizePanel, ModeOptions } from '@/components/writing/WritingControls';
import { generateLabel, languageOptions, MODES, modeHint, modeIcon, modeLabel, modeTone, requestSummary, toneClass, type ModeTone } from '@/components/writing/modes';
import { rememberSettings, tabForSettings, tabSettings, type AssistantTab, type TabMemory } from './assistant-tabs';
import type { Scope } from './types';

type Props = {
  settings: Settings; onSettings: (settings: Settings) => void; scope: Scope; onScope: (scope: Scope) => void; hasSelection: boolean; scopeWords: number; scopeChars: number;
  detected: 'id' | 'en' | null; busy: boolean; generating: boolean; error: string;
  onGenerate: () => void; onRetry: () => void; onDismissError: () => void; children?: React.ReactNode; canGenerate: boolean; customizeRequest: number;
  styles: WritingStyle[]; stylesLoading: boolean; stylesError: string; onRetryStyles: () => void; onApplyStyle: (style: WritingStyle) => void; onCreateStyle: () => void; onEditStyle: (style: WritingStyle) => void; onSaveAsStyle: () => void;
  suggestion: WritingStyle | null; onDismissSuggestion: () => void;
};
const ringClass: Record<ModeTone, string> = {
  green: 'ring-mode-green-ink/40', blue: 'ring-mode-blue-ink/40', orange: 'ring-mode-orange-ink/40', slate: 'ring-mode-slate-ink/40', pink: 'ring-mode-pink-ink/40', gold: 'ring-mode-gold-ink/40', gray: 'ring-mode-gray-ink/40',
};
const hoverClass: Record<ModeTone, string> = {
  green: 'hover:border-mode-green-edge', blue: 'hover:border-mode-blue-edge', orange: 'hover:border-mode-orange-edge', slate: 'hover:border-mode-slate-edge', pink: 'hover:border-mode-pink-edge', gold: 'hover:border-mode-gold-edge', gray: 'hover:border-mode-gray-edge',
};

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{children}</h3>
      {aside}
    </div>
  );
}

function ModeTiles({ value, disabled, onChange }: { value: Mode; disabled: boolean; onChange: (mode: Mode) => void }) {
  const { t } = useLocale();
  return (
    <div role="radiogroup" aria-label={t('Mode penulisan', 'Writing mode')} className="grid grid-cols-2 gap-2">
      {MODES.map((mode) => {
        const Icon = modeIcon[mode]; const tone = toneClass[modeTone[mode]]; const active = mode === value;
        return (
          <button key={mode} type="button" role="radio" aria-checked={active} disabled={disabled} title={modeHint(mode, t)} onClick={() => onChange(mode)}
            className={`group relative flex h-[60px] min-w-0 flex-col justify-between rounded-xl border py-2.5 pl-3 pr-7 text-left transition-colors disabled:opacity-50 ${active ? `${tone.fill} ${tone.edge} ring-1 ${ringClass[modeTone[mode]]}` : `border-transparent ${tone.light} ${hoverClass[modeTone[mode]]}`}`}>
            <Icon size={16} className={`shrink-0 ${tone.ink}`} aria-hidden="true" />
            <span className={`truncate text-[13px] ${active ? 'font-semibold text-ink-900' : 'font-medium text-ink-800'}`}>{modeLabel(mode, t)}</span>
            {active ? <Check size={15} className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${tone.ink}`} aria-hidden="true" /> : <ChevronRight size={15} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

const TILE = 'group relative flex h-[60px] min-w-0 flex-col justify-between rounded-xl border py-2.5 pl-3 pr-8 text-left transition-colors disabled:opacity-50';

// Skill tiles mirror the mode tiles; the pencil edits the skill without applying it.
function SkillTiles({ styles, activeId, disabled, full, onPick, onEdit, onCreate }: { styles: WritingStyle[]; activeId: string | null; disabled: boolean; full: boolean; onPick: (style: WritingStyle) => void; onEdit: (style: WritingStyle) => void; onCreate: () => void }) {
  const { t } = useLocale();
  return (
    <div className="grid grid-cols-2 gap-2">
      {styles.map((style) => {
        const name = notebookTone(style.color, style.settings.mode); const tone = toneClass[name]; const active = style.id === activeId;
        return (
          <div key={style.id} className="relative">
            <button type="button" aria-pressed={active} disabled={disabled} title={`${style.name}${style.description ? ` · ${style.description}` : ''} · ${requestSummary(style.settings, t)}`} onClick={() => onPick(style)}
              className={`${TILE} w-full ${active ? `${tone.fill} ${tone.edge} ring-1 ${ringClass[name]}` : `border-transparent ${tone.light} ${hoverClass[name]}`}`}>
              <NotebookIcon icon={style.icon} mode={style.settings.mode} size={16} className={tone.ink} />
              <span className={`truncate text-[13px] ${active ? 'font-semibold text-ink-900' : 'font-medium text-ink-800'}`}>{style.name}</span>
              {active && <Check size={15} className={`absolute bottom-2.5 right-2 ${tone.ink}`} aria-hidden="true" />}
            </button>
            <button type="button" disabled={disabled} onClick={() => onEdit(style)} aria-label={t(`Ubah skill ${style.name}`, `Edit skill ${style.name}`)} title={t('Ubah skill', 'Edit skill')}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md text-ink-400 transition-colors hover:bg-white/70 hover:text-ink-900 focus-visible:bg-white/70 focus-visible:text-ink-900 disabled:opacity-40">
              <PencilLine size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button type="button" disabled={disabled || full} onClick={onCreate} title={full ? t(`Maksimal ${STYLE_LIMIT} skill tersimpan.`, `You can save at most ${STYLE_LIMIT} skills.`) : t('Buat skill baru', 'Create a new skill')}
        className={`${TILE} border-dashed border-line-strong bg-white text-ink-600 hover:border-ink-300 hover:text-ink-900`}>
        <Plus size={16} className="text-ink-400" aria-hidden="true" />
        <span className="truncate text-[13px] font-medium">{t('Buat skill', 'Create skill')}</span>
      </button>
    </div>
  );
}

export function AssistantPanel({ settings, onSettings, scope, onScope, hasSelection, scopeWords, scopeChars, detected, busy, generating, error, onGenerate, onRetry, onDismissError, children, canGenerate, customizeRequest, styles, stylesLoading, stylesError, onRetryStyles, onApplyStyle, onCreateStyle, onEditStyle, onSaveAsStyle, suggestion, onDismissSuggestion }: Props) {
  const { t, locale } = useLocale();
  const [tab, setTab] = useState<AssistantTab>(() => tabForSettings(settings));
  // Each tab keeps its own configuration: the last manual mode setup and the last applied skill.
  const memory = useRef<TabMemory>({ mode: settings.styleId ? null : settings, styleId: settings.styleId });
  memory.current = rememberSettings(tab, settings, memory.current);
  // Follows the notebook into the Skills tab once its settings come from a saved skill.
  useEffect(() => { if (settings.styleId) setTab('skills'); }, [settings.styleId]);
  const activeStyle = styles.find((item) => item.id === settings.styleId) ?? null;
  const skillView = tab === 'skills' && activeStyle !== null;
  function chooseTab(next: AssistantTab) {
    if (next === tab) return;
    setTab(next);
    const value = tabSettings(next, settings, memory.current, styles);
    if (JSON.stringify(value) !== JSON.stringify(settings)) onSettings(value);
  }
  const languageName = detected === 'id' ? 'Indonesia' : detected === 'en' ? 'English' : t('belum jelas', 'unclear');
  const limit = scope === 'document' ? AI_SCOPE_LIMIT : SELECTION_LIMIT;
  const overLimit = scopeChars > limit;
  const needsSelection = scope === 'selection' && !hasSelection;
  const disabled = busy || !canGenerate || overLimit;
  const scopeLabel = { selection: t('teks terpilih', 'selected text'), paragraph: t('paragraf aktif', 'current paragraph'), document: t('seluruh dokumen', 'entire document') }[scope];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {generating && (
            <div role="status" className="space-y-2.5 rounded-xl border border-line bg-paper p-3.5">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink-700"><Spinner size={14} className="text-brand-600" />{t('Menulis ulang dan memeriksa istilah terkunci…', 'Rewriting and checking locked terms…')}</p>
              <div className="h-2 w-full animate-pulse rounded bg-paper-deep" /><div className="h-2 w-11/12 animate-pulse rounded bg-paper-deep" /><div className="h-2 w-3/4 animate-pulse rounded bg-paper-deep" />
              <p className="text-[11px] text-ink-500">{t('Kamu tetap bisa mengedit selama menunggu.', 'You can keep editing while you wait.')}</p>
            </div>
          )}

          {children}

          {suggestion && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5">
              <Sparkles size={14} className="shrink-0 text-brand-700" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-xs text-ink-700">{t(`Pakai skill “${suggestion.name}”?`, `Use the “${suggestion.name}” skill?`)}</p>
              <span className="flex shrink-0 items-center gap-1">
                <Button size="sm" disabled={busy} onClick={() => { onDismissSuggestion(); onApplyStyle(suggestion); }}>{t('Pakai', 'Use')}</Button>
                <button type="button" onClick={onDismissSuggestion} aria-label={t('Abaikan saran skill', 'Ignore the skill suggestion')} title={t('Abaikan', 'Ignore')}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100/70 hover:text-ink-900"><X size={15} aria-hidden="true" /></button>
              </span>
            </div>
          )}

          <section aria-label={t('Mode dan skill', 'Mode and skills')}>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="w-44 shrink-0">
                <Segmented<'mode' | 'skills'> size="sm" label={t('Pilih mode atau skill', 'Choose a mode or a skill')} value={tab} disabled={busy} onChange={chooseTab}
                  options={[{ value: 'mode', label: 'Mode' }, { value: 'skills', label: 'Skills' }]} />
              </div>
              {tab === 'skills' && (
                <button type="button" onClick={onSaveAsStyle} disabled={busy || stylesLoading || styles.length >= STYLE_LIMIT} className={pillButton}
                  title={styles.length >= STYLE_LIMIT ? t(`Maksimal ${STYLE_LIMIT} skill tersimpan.`, `You can save at most ${STYLE_LIMIT} skills.`) : t('Simpan pengaturan ini sebagai skill', 'Save these settings as a skill')}>
                  <BookmarkPlus size={13} aria-hidden="true" />{t('Simpan sebagai skill', 'Save as skill')}
                </button>
              )}
            </div>
            {tab === 'mode' ? (
              <>
                <ModeTiles value={settings.mode} disabled={busy} onChange={(mode) => onSettings({ ...settings, mode, styleId: null, sample: '' })} />
                <p className="mt-2 text-xs leading-relaxed text-ink-500">{modeHint(settings.mode, t)}</p>
              </>
            ) : stylesLoading ? (
              <div role="status" aria-label={t('Memuat skill…', 'Loading skills…')} className="grid grid-cols-2 gap-2">
                <div className="h-[60px] animate-pulse rounded-xl bg-paper-deep" /><div className="h-[60px] animate-pulse rounded-xl bg-paper-deep" />
              </div>
            ) : stylesError ? (
              <Alert tone="error" actions={<Button size="sm" icon={RefreshCw} onClick={onRetryStyles}>{t('Coba lagi', 'Retry')}</Button>}>{stylesError}</Alert>
            ) : styles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line-strong bg-paper/60 px-3.5 py-3">
                <p className="text-xs leading-relaxed text-ink-500">{t('Belum ada skill tersimpan. Simpan pengaturan yang sering dipakai agar bisa dipanggil sekali klik.', 'No saved skills yet. Save the settings you use often to apply them in one click.')}</p>
                <Button size="sm" className="mt-2.5" icon={Plus} disabled={busy} onClick={onCreateStyle}>{t('Buat skill', 'Create skill')}</Button>
              </div>
            ) : (
              <>
                <SkillTiles styles={styles} activeId={settings.styleId} disabled={busy} full={styles.length >= STYLE_LIMIT} onPick={onApplyStyle} onEdit={onEditStyle} onCreate={onCreateStyle} />
                {!activeStyle && <p className="mt-2 text-xs leading-relaxed text-ink-500">{t('Pilih satu skill untuk dipakai di notebook ini.', 'Pick a skill to use in this notebook.')}</p>}
              </>
            )}
          </section>

          <section aria-label={t('Pengaturan', 'Settings')}>
            <SectionTitle aside={<span className="truncate text-[11px] text-ink-500">{skillView ? t('dari skill', 'from the skill') : `${t('untuk', 'for')} ${modeLabel(settings.mode, t)}`}</span>}>{t('Pengaturan', 'Settings')}</SectionTitle>
            {skillView && activeStyle ? (
              <div className="space-y-2">
                <div className="rounded-xl border border-line bg-paper px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <NotebookIcon icon={activeStyle.icon} mode={activeStyle.settings.mode} size={15} className={toneClass[notebookTone(activeStyle.color, activeStyle.settings.mode)].ink} />
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">{activeStyle.name}</p>
                    <button type="button" disabled={busy} onClick={() => onEditStyle(activeStyle)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-brand-800 transition-colors hover:bg-brand-50 disabled:opacity-50">{t('Ubah skill', 'Edit skill')}</button>
                  </div>
                  {activeStyle.description && <p className="mt-1 truncate text-xs text-ink-500">{activeStyle.description}</p>}
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{requestSummary(settings, t)}</p>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-500">{t('Semua kontrol ikut dari skill ini. Untuk mengatur sendiri, pindah ke tab Mode.', 'Every control comes from this skill. Switch to the Mode tab to set them yourself.')}</p>
                <div className="flex items-center gap-3">
                  <label htmlFor="studio-language" className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] text-ink-600">
                    {t('Bahasa', 'Language')}
                    {settings.language === 'auto' && <span className="inline-flex items-center gap-1 truncate text-[11px] text-ink-500"><Languages size={11} aria-hidden="true" />{languageName}</span>}
                  </label>
                  <div className="w-[55%] shrink-0"><HintSelect size="sm" align="end" id="studio-language" label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={busy} onChange={(language) => onSettings({ ...settings, language })} options={languageOptions(t)} /></div>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <ModeOptions compact settings={settings} disabled={busy} onChange={onSettings} />
                  <div className="flex items-center gap-3">
                    <label htmlFor="studio-language" className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] text-ink-600">
                      {t('Bahasa', 'Language')}
                      {settings.language === 'auto' && <span className="inline-flex items-center gap-1 truncate text-[11px] text-ink-500"><Languages size={11} aria-hidden="true" />{languageName}</span>}
                    </label>
                    <div className="w-[55%] shrink-0"><HintSelect size="sm" align="end" id="studio-language" label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={busy} onChange={(language) => onSettings({ ...settings, language })} options={languageOptions(t)} /></div>
                  </div>
                </div>
                <div className="mt-3"><CustomizePanel key={customizeRequest} defaultOpen={customizeRequest > 0} settings={settings} disabled={busy} onChange={onSettings} /></div>
              </>
            )}
          </section>
        </div>
      </div>

      <footer className="shrink-0 space-y-2.5 border-t border-line bg-white px-4 pb-4 pt-3">
        {error && !generating && (
          <Alert tone="error" onDismiss={onDismissError} dismissLabel={t('Tutup', 'Dismiss')} actions={<Button size="sm" icon={RefreshCw} onClick={onRetry}>{t('Coba lagi', 'Retry')}</Button>}>{error}</Alert>
        )}
        <SectionTitle aside={(scope === 'selection' || overLimit) && <span className={`text-[11px] tabular-nums ${overLimit ? 'font-semibold text-amber-700' : 'text-ink-500'}`}>{numberFormat(scopeChars, locale)}/{numberFormat(limit, locale)}</span>}>{t('Bagian yang diubah', 'Scope')}</SectionTitle>
        <Segmented<Scope> size="sm" label={t('Bagian yang diubah', 'Scope')} value={scope} disabled={busy} onChange={onScope}
          options={[{ value: 'selection', label: t('Pilihan', 'Selection') }, { value: 'paragraph', label: t('Paragraf', 'Paragraph') }, { value: 'document', label: t('Dokumen', 'Document') }]} />
        <p className={`flex items-center gap-1.5 text-xs ${needsSelection || overLimit ? 'text-amber-700' : 'text-ink-500'}`}>
          <TextSelect size={13} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {needsSelection ? t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.')
              : overLimit ? t(`Terlalu panjang — persingkat ${scope === 'selection' ? 'pilihan' : 'bagian ini'}.`, `Too long — shorten the ${scope === 'selection' ? 'selection' : 'scope'}.`)
              : `${scopeLabel} · ${numberFormat(scopeWords, locale)} ${t('kata', 'words')}`}
          </span>
        </p>
        <button type="button" onClick={onGenerate} disabled={disabled} title={generateLabel(settings.mode, t)}
          className={`inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors ${disabled ? 'bg-paper-deep text-ink-300' : `${raisedGreen} ${pressGreen}`}`}>
          {generating ? <><Spinner size={14} />{t('Memproses…', 'Working…')}</> : <>{generateLabel(settings.mode, t)}<ArrowRight size={15} aria-hidden="true" /></>}
        </button>
      </footer>
    </div>
  );
}
