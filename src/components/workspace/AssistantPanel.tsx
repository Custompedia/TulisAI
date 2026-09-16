'use client';
import { ArrowRight, ChevronRight, Languages, Sparkles, TextSelect } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { AI_SCOPE_LIMIT, SELECTION_LIMIT, type Mode, type Settings, type WritingLanguage } from '@/lib/writing/settings';
import { Button } from '@/components/ui/Button';
import { FieldLabel, Segmented } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { CustomizePanel, ModeOptions } from '@/components/writing/WritingControls';
import { generateLabel, MODES, modeHint, modeIcon, modeLabel, modeTone, requestSummary, toneClass, type ModeTone } from '@/components/writing/modes';
import type { Scope } from './types';

type Props = {
  settings: Settings; onSettings: (settings: Settings) => void; scope: Scope; onScope: (scope: Scope) => void; hasSelection: boolean; scopeWords: number; scopeChars: number;
  detected: 'id' | 'en' | null; busy: boolean; generating: boolean; hasPreview: boolean;
  onGenerate: () => void; children?: React.ReactNode; canGenerate: boolean;
};
type T = (id: string, en: string) => string;

const TILE_MODES: Mode[] = [...MODES, 'custom'];
const ringClass: Record<ModeTone, string> = {
  green: 'ring-mode-green-ink/40', blue: 'ring-mode-blue-ink/40', orange: 'ring-mode-orange-ink/40', slate: 'ring-mode-slate-ink/40', pink: 'ring-mode-pink-ink/40', gold: 'ring-mode-gold-ink/40', gray: 'ring-mode-gray-ink/40',
};
const tileLabel = (mode: Mode, t: T) => (mode === 'standard' ? t('Parafrase', 'Paraphrase') : modeLabel(mode, t));

function ModeTiles({ value, disabled, onChange }: { value: Mode; disabled: boolean; onChange: (mode: Mode) => void }) {
  const { t } = useLocale();
  return (
    <div role="radiogroup" aria-label={t('Mode penulisan', 'Writing mode')} className="grid grid-cols-2 gap-2">
      {TILE_MODES.map((mode) => {
        const Icon = modeIcon[mode]; const tone = toneClass[modeTone[mode]]; const active = mode === value;
        return (
          <button key={mode} type="button" role="radio" aria-checked={active} disabled={disabled} title={modeHint(mode, t)} onClick={() => onChange(mode)}
            className={`relative flex h-18 flex-col justify-between rounded-xl border py-2.5 pl-3 pr-7 text-left transition-shadow hover:shadow-[0_1px_3px_rgb(31_32_29/0.1)] disabled:opacity-50 disabled:hover:shadow-none ${tone.edge} ${active ? `${tone.fill} ring-2 ${ringClass[modeTone[mode]]}` : tone.light}`}>
            <Icon size={18} className={tone.ink} aria-hidden="true" />
            <span className="truncate text-[13px] font-medium text-ink-900">{tileLabel(mode, t)}</span>
            <ChevronRight size={15} className={`absolute right-2 top-1/2 -translate-y-1/2 ${tone.ink}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function AssistantPanel({ settings, onSettings, scope, onScope, hasSelection, scopeWords, scopeChars, detected, busy, generating, hasPreview, onGenerate, children, canGenerate }: Props) {
  const { t, locale } = useLocale();
  const languageName = detected === 'id' ? 'Indonesia' : detected === 'en' ? 'English' : t('belum jelas', 'unclear');
  const limit = scope === 'document' ? AI_SCOPE_LIMIT : SELECTION_LIMIT;
  const overLimit = scopeChars > limit;
  const scopeLabel = { selection: t('teks terpilih', 'selected text'), paragraph: t('paragraf aktif', 'current paragraph'), document: t('seluruh dokumen', 'entire document') }[scope];

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="flex min-h-full flex-col gap-4 p-4">
        <ModeTiles value={settings.mode} disabled={busy} onChange={(mode) => onSettings({ ...settings, mode })} />

        <section aria-label={t('Pengaturan mode', 'Mode settings')} className="space-y-4 rounded-xl border border-line bg-white p-4">
          <div>
            <h3 className="text-[13px] font-medium text-ink-900">{t('Pengaturan', 'Settings')} {tileLabel(settings.mode, t)}</h3>
            <p className="mt-0.5 text-xs text-ink-500">{modeHint(settings.mode, t)}</p>
          </div>

          <ModeOptions settings={settings} disabled={busy} onChange={onSettings} />

          <div>
            <FieldLabel>{t('Bagian yang diubah', 'Scope')}</FieldLabel>
            <Segmented<Scope> label={t('Bagian yang diubah', 'Scope')} value={scope} disabled={busy} onChange={onScope}
              options={[{ value: 'selection', label: t('Pilihan', 'Selection') }, { value: 'paragraph', label: t('Paragraf', 'Paragraph') }, { value: 'document', label: t('Dokumen', 'Document') }]} />
            <p className={`mt-2 flex items-center gap-1.5 text-xs ${(scope === 'selection' && !hasSelection) || overLimit ? 'text-amber-700' : 'text-ink-500'}`}>
              <TextSelect size={13} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{scope === 'selection' && !hasSelection ? t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.') : `${t('Mengubah', 'Rewriting')} ${scopeLabel} · ${numberFormat(scopeWords, locale)} ${t('kata', 'words')}`}</span>
              {(scope === 'selection' || overLimit) && <span className={`shrink-0 tabular-nums ${overLimit ? 'font-semibold' : 'text-ink-400'}`}>{numberFormat(scopeChars, locale)}/{numberFormat(limit, locale)}</span>}
            </p>
            {overLimit && <p className="mt-1 text-xs text-amber-700">{t(`Maks. ${numberFormat(limit, 'id')} karakter — persingkat ${scope === 'selection' ? 'pilihan' : 'bagian ini'}.`, `Max ${numberFormat(limit, 'en')} characters — shorten the ${scope === 'selection' ? 'selection' : 'scope'}.`)}</p>}
          </div>

          <div>
            <FieldLabel hint={settings.language === 'auto' ? <span className="inline-flex items-center gap-1"><Languages size={12} aria-hidden="true" />{languageName}</span> : undefined}>{t('Bahasa', 'Language')}</FieldLabel>
            <Segmented<WritingLanguage> label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={busy} onChange={(language) => onSettings({ ...settings, language })} options={[{ value: 'auto', label: 'Auto' }, { value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} size="sm" />
          </div>

          <CustomizePanel settings={settings} disabled={busy} onChange={onSettings} />

          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-xs leading-relaxed text-ink-500">{requestSummary(settings, t)}</p>
            <Button variant="primary" size="lg" className="w-full" iconRight={generating ? undefined : ArrowRight} loading={generating} disabled={busy || !canGenerate || overLimit} onClick={onGenerate}>
              {generating ? t('Sedang memproses…', 'Working…') : generateLabel(settings.mode, t)}
            </Button>
            <p className="text-center text-[11px] text-ink-400">{t('Hasil tampil sebagai pratinjau. Dokumen tidak berubah sampai kamu menerapkannya.', 'Results appear as a preview. Your document changes only when you apply.')}</p>
          </div>
        </section>

        {generating && (
          <div role="status" className="space-y-2.5 rounded-xl border border-line bg-white p-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-ink-700"><Spinner size={14} className="text-brand-600" />{t('Menulis ulang dan memeriksa istilah terkunci…', 'Rewriting and checking locked terms…')}</p>
            <div className="h-2.5 w-full animate-pulse rounded bg-paper-deep" /><div className="h-2.5 w-11/12 animate-pulse rounded bg-paper-deep" /><div className="h-2.5 w-3/4 animate-pulse rounded bg-paper-deep" />
            <p className="text-[11px] text-ink-400">{t('Kamu tetap bisa mengedit selama menunggu.', 'You can keep editing while you wait.')}</p>
          </div>
        )}

        {children}

        {!hasPreview && !generating && (
          <div className="mt-auto flex flex-col items-center px-6 pb-4 pt-8 text-center">
            <Sparkles size={20} className="text-brand-600" aria-hidden="true" />
            <p className="mt-2.5 text-[13px] font-medium text-ink-800">{t('Hasil AI akan muncul di sini', 'AI results will appear here')}</p>
            <p className="mt-1 max-w-64 text-xs leading-relaxed text-ink-500">{t('Pilih mode, blok teks atau pilih cakupan, lalu klik Perbaiki.', 'Pick a mode, select text or choose a scope, then click Improve.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
