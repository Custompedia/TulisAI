'use client';
import { ArrowRight, ChevronDown, Languages, LockKeyhole, PanelRightClose, RefreshCw, TextSelect, TriangleAlert, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import type { Settings, WritingLanguage } from '@/lib/writing/settings';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { CustomizePanel, ModeOptions, ModePicker } from '@/components/writing/WritingControls';
import { generateLabel, requestSummary } from '@/components/writing/modes';
import type { Scope, Term } from './types';

type Props = {
  settings: Settings; onSettings: (settings: Settings) => void; scope: Scope; onScope: (scope: Scope) => void; hasSelection: boolean; scopeWords: number;
  detected: 'id' | 'en' | null; busy: boolean; generating: boolean; aiError: string; onRetry: () => void; onDismissError: () => void;
  onGenerate: () => void; onClose: () => void; children?: React.ReactNode; terms: Term[]; text: string; onUnlock: (term: Term) => void; canGenerate: boolean;
};

export function AssistantPanel({ settings, onSettings, scope, onScope, hasSelection, scopeWords, detected, busy, generating, aiError, onRetry, onDismissError, onGenerate, onClose, children, terms, text, onUnlock, canGenerate }: Props) {
  const { t, locale } = useLocale();
  const languageName = detected === 'id' ? 'Indonesia' : detected === 'en' ? 'English' : t('belum jelas', 'unclear');
  const scopeLabel = { selection: t('teks terpilih', 'selected text'), paragraph: t('paragraf aktif', 'current paragraph'), document: t('seluruh dokumen', 'entire document') }[scope];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="flex-1 text-sm font-semibold text-ink-900">{t('Asisten AI', 'AI assistant')}</h2>
        <IconButton icon={PanelRightClose} label={t('Tutup panel AI', 'Close AI panel')} onClick={onClose} />
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Mode', 'Mode')}</p>
          <ModePicker value={settings.mode} includeCustom layout="grid" disabled={busy} onChange={(mode) => onSettings({ ...settings, mode })} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Bagian yang diubah', 'Scope')}</p>
          <Segmented<Scope> label={t('Bagian yang diubah', 'Scope')} value={scope} disabled={busy} onChange={onScope}
            options={[{ value: 'selection', label: t('Pilihan', 'Selection') }, { value: 'paragraph', label: t('Paragraf', 'Paragraph') }, { value: 'document', label: t('Dokumen', 'Document') }]} />
          <p className={`mt-2 flex items-center gap-1.5 text-xs ${scope === 'selection' && !hasSelection ? 'text-amber-700' : 'text-ink-500'}`}>
            <TextSelect size={13} aria-hidden="true" />
            {scope === 'selection' && !hasSelection ? t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.') : `${t('Mengubah', 'Rewriting')} ${scopeLabel} · ${numberFormat(scopeWords, locale)} ${t('kata', 'words')}`}
          </p>
        </div>

        <ModeOptions settings={settings} disabled={busy} onChange={onSettings} />

        <div>
          <p className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Bahasa', 'Language')}{settings.language === 'auto' && <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-ink-500"><Languages size={12} />{languageName}</span>}</p>
          <Segmented<WritingLanguage> label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={busy} onChange={(language) => onSettings({ ...settings, language })} options={[{ value: 'auto', label: 'Auto' }, { value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} size="sm" />
        </div>

        <CustomizePanel settings={settings} disabled={busy} onChange={onSettings} />

        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-ink-500">{requestSummary(settings, t)}</p>
          <Button variant="primary" size="lg" className="w-full" iconRight={generating ? undefined : ArrowRight} loading={generating} disabled={busy || !canGenerate} onClick={onGenerate}>
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

        {aiError && !generating && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-[13px] text-red-900">
            <div className="flex gap-2"><TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><p className="flex-1">{aiError}</p><button type="button" onClick={onDismissError} aria-label={t('Tutup', 'Dismiss')} className="-m-1 grid h-6 w-6 place-items-center rounded hover:bg-black/5"><X size={14} /></button></div>
            <Button size="sm" className="mt-2.5" icon={RefreshCw} onClick={onRetry}>{t('Coba lagi', 'Retry')}</Button>
          </div>
        )}

        {children}

        <details className="group rounded-xl border border-line bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3">
            <LockKeyhole size={15} className="text-amber-600" aria-hidden="true" />
            <span className="flex-1 text-[13px] font-semibold text-ink-800">{t('Istilah yang tidak boleh diubah', 'Protected terms')}</span>
            <span className="rounded-md bg-amber-50 px-1.5 text-xs font-semibold text-amber-800">{terms.length}</span>
            <ChevronDown size={15} className="text-ink-400 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-line px-3.5 py-3">
            {terms.length === 0 ? (
              <p className="text-xs leading-relaxed text-ink-500">{t('Blok istilah di editor lalu pilih "Kunci Istilah". Sitasi seperti (Davis, 1989) otomatis dilindungi.', 'Select a term in the editor, then choose "Lock Term". Citations like (Davis, 1989) are protected automatically.')}</p>
            ) : (
              <ul className="space-y-1.5">
                {terms.map((term) => (
                  <li key={term.id} className="flex items-center gap-2 rounded-lg bg-paper/70 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800">{term.term}{!text.includes(term.term) && <span className="ml-1 text-[11px] font-normal text-ink-400">· {t('tidak ada di teks', 'not in text')}</span>}</span>
                    <IconButton size="sm" icon={X} label={`${t('Buka kunci', 'Unlock')} ${term.term}`} disabled={busy} onClick={() => onUnlock(term)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
