'use client';
import { ArrowRight, Check, ChevronRight, Languages, Sparkles, TextSelect } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { AI_SCOPE_LIMIT, SELECTION_LIMIT, type Mode, type Settings } from '@/lib/writing/settings';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import { Spinner } from '@/components/ui/Spinner';
import { CustomizePanel, ModeOptions } from '@/components/writing/WritingControls';
import { generateLabel, languageOptions, MODES, modeHint, modeIcon, modeLabel, modeTone, toneClass, type ModeTone } from '@/components/writing/modes';
import type { Scope } from './types';

type Props = {
  settings: Settings; onSettings: (settings: Settings) => void; scope: Scope; onScope: (scope: Scope) => void; hasSelection: boolean; scopeWords: number; scopeChars: number;
  detected: 'id' | 'en' | null; busy: boolean; generating: boolean; hasPreview: boolean;
  onGenerate: () => void; children?: React.ReactNode; canGenerate: boolean; customizeRequest: number;
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
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{children}</h3>
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

export function AssistantPanel({ settings, onSettings, scope, onScope, hasSelection, scopeWords, scopeChars, detected, busy, generating, hasPreview, onGenerate, children, canGenerate, customizeRequest }: Props) {
  const { t, locale } = useLocale();
  const languageName = detected === 'id' ? 'Indonesia' : detected === 'en' ? 'English' : t('belum jelas', 'unclear');
  const limit = scope === 'document' ? AI_SCOPE_LIMIT : SELECTION_LIMIT;
  const overLimit = scopeChars > limit;
  const needsSelection = scope === 'selection' && !hasSelection;
  const disabled = busy || !canGenerate || overLimit;
  const scopeLabel = { selection: t('teks terpilih', 'selected text'), paragraph: t('paragraf aktif', 'current paragraph'), document: t('seluruh dokumen', 'entire document') }[scope];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 p-4">
          {generating && (
            <div role="status" className="space-y-2.5 rounded-xl border border-line bg-paper p-3.5">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink-700"><Spinner size={14} className="text-brand-600" />{t('Menulis ulang dan memeriksa istilah terkunci…', 'Rewriting and checking locked terms…')}</p>
              <div className="h-2 w-full animate-pulse rounded bg-paper-deep" /><div className="h-2 w-11/12 animate-pulse rounded bg-paper-deep" /><div className="h-2 w-3/4 animate-pulse rounded bg-paper-deep" />
              <p className="text-[11px] text-ink-400">{t('Kamu tetap bisa mengedit selama menunggu.', 'You can keep editing while you wait.')}</p>
            </div>
          )}

          {children}

          <section aria-label={t('Mode penulisan', 'Writing mode')}>
            <SectionTitle>{t('Mode', 'Mode')}</SectionTitle>
            <ModeTiles value={settings.mode} disabled={busy} onChange={(mode) => onSettings({ ...settings, mode })} />
            <p className="mt-2 text-xs leading-relaxed text-ink-500">{modeHint(settings.mode, t)}</p>
          </section>

          <section aria-label={t('Pengaturan mode', 'Mode settings')}>
            <SectionTitle>{t('Pengaturan', 'Settings')}</SectionTitle>
            <div className="space-y-2">
              <ModeOptions compact settings={settings} disabled={busy} onChange={onSettings} />
              <div className="flex items-center gap-3">
                <label htmlFor="studio-language" className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] text-ink-600">
                  {t('Bahasa', 'Language')}
                  {settings.language === 'auto' && <span className="inline-flex items-center gap-1 truncate text-[11px] text-ink-400"><Languages size={11} aria-hidden="true" />{languageName}</span>}
                </label>
                <div className="w-[55%] shrink-0"><HintSelect size="sm" align="end" id="studio-language" label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={busy} onChange={(language) => onSettings({ ...settings, language })} options={languageOptions(t)} /></div>
              </div>
            </div>
            <div className="mt-3"><CustomizePanel key={customizeRequest} defaultOpen={customizeRequest > 0} settings={settings} disabled={busy} onChange={onSettings} /></div>
          </section>

          {!hasPreview && !generating && (
            <div className="flex flex-col items-center border-t border-line px-4 pb-2 pt-6 text-center">
              <Sparkles size={20} className="text-brand-600" aria-hidden="true" />
              <p className="mt-2 text-[13px] font-medium text-brand-800">{t('Hasil AI akan muncul di sini.', 'AI results will appear here.')}</p>
              <p className="mt-1 max-w-64 text-xs leading-relaxed text-ink-500">{t('Pilih mode dan cakupan, lalu jalankan dari tombol di bawah.', 'Pick a mode and scope, then run it from the button below.')}</p>
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 space-y-2.5 border-t border-line bg-white px-4 pb-4 pt-3">
        <Segmented<Scope> size="sm" label={t('Bagian yang diubah', 'Scope')} value={scope} disabled={busy} onChange={onScope}
          options={[{ value: 'selection', label: t('Pilihan', 'Selection') }, { value: 'paragraph', label: t('Paragraf', 'Paragraph') }, { value: 'document', label: t('Dokumen', 'Document') }]} />
        <p className={`flex items-center gap-1.5 text-xs ${needsSelection || overLimit ? 'text-amber-700' : 'text-ink-500'}`}>
          <TextSelect size={13} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {needsSelection ? t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.')
              : overLimit ? t(`Terlalu panjang — persingkat ${scope === 'selection' ? 'pilihan' : 'bagian ini'}.`, `Too long — shorten the ${scope === 'selection' ? 'selection' : 'scope'}.`)
              : `${scopeLabel} · ${numberFormat(scopeWords, locale)} ${t('kata', 'words')}`}
          </span>
          {(scope === 'selection' || overLimit) && <span className={`shrink-0 tabular-nums ${overLimit ? 'font-semibold' : 'text-ink-400'}`}>{numberFormat(scopeChars, locale)}/{numberFormat(limit, locale)}</span>}
        </p>
        <button type="button" onClick={onGenerate} disabled={disabled} title={generateLabel(settings.mode, t)}
          className={`inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors ${disabled ? 'bg-paper-deep text-ink-300' : `${raisedGreen} ${pressGreen}`}`}>
          {generating ? <><Spinner size={14} />{t('Memproses…', 'Working…')}</> : <>{generateLabel(settings.mode, t)}<ArrowRight size={15} aria-hidden="true" /></>}
        </button>
      </footer>
    </div>
  );
}
