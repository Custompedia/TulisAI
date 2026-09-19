'use client';
import { useState } from 'react';
import { ChevronDown, Columns2, Copy, History, PencilLine, RefreshCw, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { dateTime, relativeTime } from '@/lib/client/format';
import { modeFromPrompt } from '@/lib/writing/settings';
import { Button, pillButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { modeIcon, modeLabel } from '@/components/writing/modes';
import { kindIcon, kindTone, versionLabel } from './versions';
import type { Version } from './types';

type Filter = 'all' | 'ai' | 'manual';
type TextState = { status: 'loading' | 'ready' | 'error'; text: string };
type Props = {
  versions: Version[]; currentRevision: number | null; originalId: string | null; loading: boolean; hasMore: boolean; loadingMore: boolean; error: string; busy: boolean; canSave: boolean;
  onLoadMore: () => void; onRetry: () => void; onSave: () => void; loadText: (versionId: string) => Promise<string>;
  onCompare: (version: Version) => void; onRestore: (version: Version) => void; onRename: (version: Version) => void; onDuplicate: (version: Version) => void;
};

export function HistoryPanel({ versions, currentRevision, originalId, loading, hasMore, loadingMore, error, busy, canSave, onLoadMore, onRetry, onSave, loadText, onCompare, onRestore, onRename, onDuplicate }: Props) {
  const { t, locale } = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, TextState>>({});
  const shown = versions.filter((version) => filter === 'all' || (filter === 'ai') === (version.kind === 'ai_apply'));
  const scopeLabel = (value: string | null | undefined) => (value === 'selection' ? t('Teks terpilih', 'Selection') : value === 'document' ? t('Seluruh dokumen', 'Entire document') : null);

  function fetchText(versionId: string) {
    setTexts((state) => ({ ...state, [versionId]: { status: 'loading', text: '' } }));
    loadText(versionId).then((text) => setTexts((state) => ({ ...state, [versionId]: { status: 'ready', text } })), () => setTexts((state) => ({ ...state, [versionId]: { status: 'error', text: '' } })));
  }
  function toggle(version: Version) {
    const next = open === version.id ? null : version.id;
    setOpen(next);
    if (next && (!texts[next] || texts[next].status === 'error')) fetchText(next);
  }

  const chips: Array<[Filter, string]> = [['all', t('Semua', 'All')], ['ai', 'AI'], ['manual', 'Manual']];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-4 py-2.5">
        <div role="radiogroup" aria-label={t('Saring riwayat', 'Filter history')} className="flex gap-1">
          {chips.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={filter === value} onClick={() => setFilter(value)}
              className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors ${filter === value ? 'bg-brand-800 text-white' : 'border border-line bg-white text-ink-600 hover:border-line-strong hover:text-ink-900'}`}>{label}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" icon={Save} className="ml-auto" disabled={!canSave} onClick={onSave}>{t('Simpan Versi', 'Save Version')}</Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <ul className="space-y-3" role="status" aria-label={t('Memuat riwayat…', 'Loading history…')}>{[0, 1, 2].map((key) => <li key={key} className="h-14 animate-pulse rounded-lg bg-paper-deep" />)}</ul>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-paper-deep text-ink-500"><History size={18} aria-hidden="true" /></span>
            <p className="mt-3 text-[13px] font-semibold text-ink-800">{filter === 'all' ? t('Belum ada riwayat', 'No history yet') : filter === 'ai' ? t('Belum ada hasil AI yang diterapkan', 'No applied AI results yet') : t('Belum ada versi manual', 'No manual versions yet')}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{t('Hasil AI yang diterapkan dan versi yang kamu simpan muncul di sini.', 'Applied AI results and versions you save appear here.')}</p>
          </div>
        ) : (
          <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-line" aria-label={t('Linimasa versi', 'Version timeline')}>
            {shown.map((version) => {
              const Icon = kindIcon[version.kind]; const mode = modeFromPrompt(version.promptId); const ModeIcon = mode ? modeIcon[mode] : null;
              const expanded = open === version.id; const preview = texts[version.id]; const scope = scopeLabel(version.scopeType);
              return (
                <li key={version.id} className="relative pl-10">
                  <span className={`absolute left-0 top-2 grid h-8 w-8 place-items-center rounded-full border bg-white ${kindTone[version.kind]}`}><Icon size={14} aria-hidden="true" /></span>
                  <div className={`rounded-lg border transition-colors ${expanded ? 'border-line-strong bg-white' : 'border-transparent hover:bg-white'}`}>
                    <button type="button" onClick={() => toggle(version)} aria-expanded={expanded} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-ink-900">{versionLabel(version, t)}</span>
                          {version.revision === currentRevision && <span className="shrink-0 rounded bg-brand-50 px-1.5 py-px text-[10px] font-semibold text-brand-800 ring-1 ring-brand-100">{t('Saat ini', 'Current')}</span>}
                          {(version.id === originalId || version.kind === 'original') && <span className="shrink-0 rounded bg-paper-deep px-1.5 py-px text-[10px] font-semibold text-ink-600">Original</span>}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                          {mode && ModeIcon && <span className="inline-flex items-center gap-1 rounded bg-paper-deep px-1.5 py-px font-semibold text-ink-700"><ModeIcon size={11} aria-hidden="true" />{modeLabel(mode, t)}</span>}
                          {scope && <span className="rounded border border-line px-1.5 py-px font-medium">{scope}</span>}
                          <time dateTime={version.createdAt} title={dateTime(version.createdAt, locale)}>{relativeTime(version.createdAt, locale)}</time>
                        </span>
                      </span>
                      <ChevronDown size={15} className={`mt-0.5 shrink-0 text-ink-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    {expanded && (
                      <div className="space-y-2.5 border-t border-line px-2.5 py-2.5">
                        {!preview || preview.status === 'loading' ? <p role="status" className="flex items-center gap-2 text-xs text-ink-500"><Spinner size={12} />{t('Memuat isi…', 'Loading text…')}</p>
                          : preview.status === 'error' ? <p role="alert" className="flex items-center gap-2 text-xs text-red-700"><TriangleAlert size={13} aria-hidden="true" />{t('Isi versi gagal dimuat.', 'Could not load this version.')}<button type="button" className="font-semibold underline" onClick={() => fetchText(version.id)}>{t('Coba lagi', 'Retry')}</button></p>
                          : <p className="line-clamp-4 whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-ink-700">{preview.text.trim() || t('(kosong)', '(empty)')}</p>}
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" className={pillButton} disabled={busy} onClick={() => onCompare(version)}><Columns2 size={13} aria-hidden="true" />{t('Bandingkan dengan saat ini', 'Compare with current')}</button>
                          <button type="button" className={pillButton} disabled={busy} onClick={() => onRestore(version)}><RotateCcw size={13} aria-hidden="true" />{t('Pulihkan', 'Restore')}</button>
                          {version.kind !== 'original' && <button type="button" className={pillButton} disabled={busy} onClick={() => onRename(version)}><PencilLine size={13} aria-hidden="true" />{t('Ganti nama', 'Rename')}</button>}
                          <button type="button" className={pillButton} disabled={busy} onClick={() => onDuplicate(version)}><Copy size={13} aria-hidden="true" />{t('Duplikat', 'Duplicate')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {error && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><p className="flex-1">{error}</p>
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRetry}>{t('Coba lagi', 'Retry')}</Button>
          </div>
        )}
        {hasMore && !loading && <Button className="mt-3 w-full" size="sm" loading={loadingMore} disabled={loadingMore} onClick={onLoadMore}>{t('Muat lebih banyak', 'Load more')}</Button>}
      </div>
    </div>
  );
}
