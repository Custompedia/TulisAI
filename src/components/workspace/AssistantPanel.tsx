'use client';
import { ArrowRight, Languages, TextSelect } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { AI_SCOPE_LIMIT, SELECTION_LIMIT, type Settings, type WritingLanguage } from '@/lib/writing/settings';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { CustomizePanel, ModeOptions, ModePicker } from '@/components/writing/WritingControls';
import { generateLabel, requestSummary } from '@/components/writing/modes';
import type { Scope } from './types';

type Props = {
  settings: Settings; onSettings: (settings: Settings) => void; scope: Scope; onScope: (scope: Scope) => void; hasSelection: boolean; scopeWords: number; scopeChars: number;
  detected: 'id' | 'en' | null; busy: boolean; generating: boolean;
  onGenerate: () => void; children?: React.ReactNode; canGenerate: boolean;
};

export function AssistantPanel({ settings, onSettings, scope, onScope, hasSelection, scopeWords, scopeChars, detected, busy, generating, onGenerate, children, canGenerate }: Props) {
  const { t, locale } = useLocale();
  const languageName = detected === 'id' ? 'Indonesia' : detected === 'en' ? 'English' : t('belum jelas', 'unclear');
  const limit = scope === 'document' ? AI_SCOPE_LIMIT : SELECTION_LIMIT;
  const overLimit = scopeChars > limit;
  const scopeLabel = { selection: t('teks terpilih', 'selected text'), paragraph: t('paragraf aktif', 'current paragraph'), document: t('seluruh dokumen', 'entire document') }[scope];

  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Mode', 'Mode')}</p>
          <ModePicker value={settings.mode} includeCustom layout="grid" disabled={busy} onChange={(mode) => onSettings({ ...settings, mode })} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Bagian yang diubah', 'Scope')}</p>
          <Segmented<Scope> label={t('Bagian yang diubah', 'Scope')} value={scope} disabled={busy} onChange={onScope}
            options={[{ value: 'selection', label: t('Pilihan', 'Selection') }, { value: 'paragraph', label: t('Paragraf', 'Paragraph') }, { value: 'document', label: t('Dokumen', 'Document') }]} />
          <p className={`mt-2 flex items-center gap-1.5 text-xs ${(scope === 'selection' && !hasSelection) || overLimit ? 'text-amber-700' : 'text-ink-500'}`}>
            <TextSelect size={13} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{scope === 'selection' && !hasSelection ? t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.') : `${t('Mengubah', 'Rewriting')} ${scopeLabel} · ${numberFormat(scopeWords, locale)} ${t('kata', 'words')}`}</span>
            {(scope === 'selection' || overLimit) && <span className={`shrink-0 tabular-nums ${overLimit ? 'font-semibold' : 'text-ink-400'}`}>{numberFormat(scopeChars, locale)}/{numberFormat(limit, locale)}</span>}
          </p>
          {overLimit && <p className="mt-1 text-xs text-amber-700">{t(`Maks. ${numberFormat(limit, 'id')} karakter — persingkat ${scope === 'selection' ? 'pilihan' : 'bagian ini'}.`, `Max ${numberFormat(limit, 'en')} characters — shorten the ${scope === 'selection' ? 'selection' : 'scope'}.`)}</p>}
        </div>

        <ModeOptions settings={settings} disabled={busy} onChange={onSettings} />

        <div>
          <p className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Bahasa', 'Language')}{settings.language === 'auto' && <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-ink-500"><Languages size={12} />{languageName}</span>}</p>
          <Segmented<WritingLanguage> label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={busy} onChange={(language) => onSettings({ ...settings, language })} options={[{ value: 'auto', label: 'Auto' }, { value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} size="sm" />
        </div>

        <CustomizePanel settings={settings} disabled={busy} onChange={onSettings} />

        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-ink-500">{requestSummary(settings, t)}</p>
          <Button variant="primary" size="lg" className="w-full" iconRight={generating ? undefined : ArrowRight} loading={generating} disabled={busy || !canGenerate || overLimit} onClick={onGenerate}>
            {generating ? t('Sedang memproses…', 'Working…') : generateLabel(settings.mode, t)}
          </Button>
          <p className="text-center text-[11px] text-ink-400">{t('Hasil tampil sebagai pratinjau. Dokumen tidak berubah sampai kamu menerapkannya.', 'Results appear as a preview. Your document changes only when you apply.')}</p>
        </div>

        {generating && (
          <div role="status" className="space-y-2.5 rounded-xl border border-line bg-white p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-700"><Spinner size={14} className="text-brand-600" />{t('Menulis ulang dan memeriksa istilah terkunci…', 'Rewriting and checking locked terms…')}</p>
            <div className="h-2.5 w-full animate-pulse rounded bg-paper-deep" /><div className="h-2.5 w-11/12 animate-pulse rounded bg-paper-deep" /><div className="h-2.5 w-3/4 animate-pulse rounded bg-paper-deep" />
            <p className="text-[11px] text-ink-400">{t('Kamu tetap bisa mengedit selama menunggu.', 'You can keep editing while you wait.')}</p>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
