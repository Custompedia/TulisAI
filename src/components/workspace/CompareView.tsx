'use client';
import { useId, useState } from 'react';
import { ArrowLeftRight, Check, ChevronDown, Columns2, CopyCheck, Info, Lock, RotateCcw, Rows3, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { changePercentage, readingMinutes, wordDelta } from '@/lib/editor/metrics';
import { IconButton, pillButton, pressGreen, raisedGreen } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { DiffLegend, DiffText, useDiff } from './DiffText';
import { PREVIEW, SOURCE, WORKING } from './types';

type Option = { value: string; label: string };
type Props = {
  options: Option[]; a: string; b: string; before: string; after: string; loading: boolean; busy: boolean; applying: boolean;
  /** Advanced mode: the diff is shown on the same page surface as the canvas, and defaults to side by side. */
  paged: boolean; pageStyle?: React.CSSProperties;
  onChange: (a: string, b: string) => void; onExit: () => void; onRestore: (versionId: string) => void; onApplyPreview?: () => void;
};

const DIFF_TEXT = 'text-[16px] leading-relaxed text-ink-900';

function Picker({ prefix, value, options, disabled, onChange }: { prefix: string; value: string; options: Option[]; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="relative flex h-8 w-full min-w-0 items-center rounded-full border border-line bg-white pl-3 pr-8 text-[13px] shadow-[0_1px_2px_rgb(31_32_29/0.04)] transition-colors focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 hover:border-line-strong has-disabled:opacity-60">
      <span className="shrink-0 text-ink-500">{prefix}:</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pl-1 font-medium text-ink-900 outline-none disabled:cursor-not-allowed">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-ink-400" />
    </label>
  );
}

export function CompareView({ options, a, b, before, after, loading, busy, applying, paged, pageStyle, onChange, onExit, onRestore, onApplyPreview }: Props) {
  const { t } = useLocale();
  const legendId = useId();
  // Side by side by default in advanced mode, so the two versions read as two documents rather than one merged run.
  const [layout, setLayout] = useState<'inline' | 'side'>(paged ? 'side' : 'inline');
  const parts = useDiff(before, after);
  const delta = wordDelta(before, after);
  const change = changePercentage(before, after);
  const readDelta = readingMinutes(after) - readingMinutes(before);
  const identical = before === after;
  const restorable = b !== WORKING && b !== PREVIEW && b !== SOURCE ? b : null;
  const sideOptions = (side: string) => options.filter((option) => option.value !== PREVIEW || side === PREVIEW);
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
  const size = change < 15 ? t('Perubahan kecil', 'Small change') : change < 45 ? t('Perubahan sedang', 'Moderate change') : t('Perubahan besar', 'Large change');
  const chip = 'inline-flex h-6 items-center rounded-full px-2 text-xs font-medium tabular-nums';

  return (
    <section aria-label={t('Bandingkan versi', 'Compare versions')} className="@container flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line bg-white px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold text-ink-800"><Columns2 size={15} className="shrink-0 text-brand-700" aria-hidden="true" />{t('Membandingkan', 'Comparing')}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <div role="radiogroup" aria-label={t('Tampilan', 'Layout')} className="inline-flex rounded-full border border-line bg-paper p-0.5">
              {([['inline', Rows3, t('Inline', 'Inline')], ['side', Columns2, t('Berdampingan', 'Side by side')]] as const).map(([value, Icon, text]) => (
                <button key={value} type="button" role="radio" aria-checked={layout === value} aria-label={text} title={text} onClick={() => setLayout(value)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors ${layout === value ? 'bg-white text-ink-900 shadow-[0_1px_2px_rgb(31_32_29/0.08)] ring-1 ring-line' : 'text-ink-500 hover:text-ink-900'}`}>
                  <Icon size={13} aria-hidden="true" /><span className="hidden @md:inline">{text}</span>
                </button>
              ))}
            </div>
            <IconButton size="sm" icon={X} label={t('Keluar dari Bandingkan', 'Exit Compare')} onClick={onExit} />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-1 items-center gap-1.5 @xl:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)]">
          <Picker prefix={t('Sebelum', 'Before')} value={a} options={sideOptions(a)} disabled={busy || a === PREVIEW} onChange={(value) => onChange(value, b)} />
          <IconButton size="sm" icon={ArrowLeftRight} label={t('Tukar sebelum dan sesudah', 'Swap before and after')} disabled={busy} onClick={() => onChange(b, a)} className="justify-self-center rotate-90 @xl:rotate-0" />
          <Picker prefix={t('Sesudah', 'After')} value={b} options={sideOptions(b)} disabled={busy || b === PREVIEW} onChange={(value) => onChange(a, value)} />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-paper/60 px-4 py-2 sm:px-6">
        {loading ? <span className="inline-flex items-center gap-2 text-xs text-ink-500"><Spinner size={12} />{t('Menghitung perubahan…', 'Measuring changes…')}</span>
          : identical ? <span className="text-xs text-ink-500">{t('Tidak ada perubahan di antara kedua versi.', 'Nothing changed between these versions.')}</span>
          : (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={`${chip} bg-brand-50 text-brand-800 ring-1 ring-brand-100`}>+{delta.added} {t('kata', 'words')}</span>
              <span className={`${chip} bg-red-50 text-red-700 ring-1 ring-red-100`}>−{delta.removed} {t('kata', 'words')}</span>
              <span className={`${chip} bg-white text-ink-700 ring-1 ring-line`} title={size}>≈{change}% {t('berubah', 'changed')}</span>
              <span className={`${chip} bg-white text-ink-700 ring-1 ring-line`}>{readDelta === 0 ? t('waktu baca sama', 'same reading time') : `${readDelta > 0 ? '+' : ''}${readDelta} ${t('mnt baca', 'min read')}`}</span>
            </span>
          )}
        <span className="ml-auto flex items-center gap-2 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1" title={t('Editor dikunci selama membandingkan.', 'Editing is paused while comparing.')}><Lock size={12} aria-hidden="true" /><span className="hidden @2xl:inline">{t('Editor dikunci selama membandingkan.', 'Editing is paused while comparing.')}</span></span>
          {!loading && !identical && (
            <span className="group relative">
              <button type="button" aria-label={t('Keterangan warna', 'Colour legend')} aria-describedby={legendId} className="grid h-6 w-6 place-items-center rounded-full text-ink-400 hover:bg-white hover:text-ink-800"><Info size={14} aria-hidden="true" /></button>
              <span id={legendId} role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-lg border border-line bg-white px-3 py-2 shadow-[0_8px_24px_-8px_rgb(31_32_29/0.25)] group-focus-within:block group-hover:block"><DiffLegend /></span>
            </span>
          )}
        </span>
      </div>

      {loading ? (
        <div role="status" className="flex flex-1 flex-col items-center justify-center gap-2 bg-white text-sm text-ink-500"><Spinner size={20} />{t('Memuat versi…', 'Loading versions…')}</div>
      ) : identical ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-white px-6 text-center">
          <CopyCheck size={28} strokeWidth={1.6} className="text-ink-300" aria-hidden="true" />
          <p className="mt-3 text-[15px] font-medium text-ink-700">{t('Kedua versi sama persis.', 'Both versions are identical.')}</p>
          <p className="mt-1 text-xs text-ink-500">{t('Pilih versi lain di atas untuk melihat perubahan.', 'Pick another version above to see changes.')}</p>
        </div>
      ) : layout === 'side' ? (
        <div style={paged ? pageStyle : undefined}
          className={`grid min-h-0 flex-1 grid-rows-2 divide-y divide-line @2xl:grid-cols-2 @2xl:grid-rows-1 @2xl:divide-x @2xl:divide-y-0 ${paged ? 'ww-paged-surface' : 'bg-white'}`}>
          {(['before', 'after'] as const).map((side) => (
            <div key={side} className="scrollbar-thin min-h-0 min-w-0 overflow-y-auto">
              <p className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-line bg-white/95 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500 sm:px-8"><span className="shrink-0">{side === 'before' ? t('Sebelum', 'Before') : t('Sesudah', 'After')}</span><span className="truncate normal-case tracking-normal text-ink-700" title={labelOf(side === 'before' ? a : b)}>{labelOf(side === 'before' ? a : b)}</span></p>
              {paged
                ? <div className="px-4 py-4"><DiffText parts={parts} side={side} className="ww-paged-doc ww-paged-doc-fit" /></div>
                : <DiffText parts={parts} side={side} className={`px-5 py-5 sm:px-8 ${DIFF_TEXT}`} />}
            </div>
          ))}
        </div>
      ) : (
        <div style={paged ? pageStyle : undefined}
          className={`scrollbar-thin min-h-0 flex-1 overflow-y-auto ${paged ? 'ww-paged-surface px-4 py-7' : 'bg-white px-5 py-6 sm:px-10 sm:py-8'}`}>
          {paged
            ? <DiffText parts={parts} className="ww-paged-doc" />
            : <DiffText parts={parts} className={`mx-auto max-w-[760px] ${DIFF_TEXT}`} />}
        </div>
      )}

      {!loading && (restorable || onApplyPreview) && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-white px-4 py-2.5 sm:px-6">
          {restorable && <button type="button" className={`${pillButton} h-8 px-3 text-[13px]`} disabled={busy} onClick={() => onRestore(restorable)}><RotateCcw size={14} aria-hidden="true" />{t('Jadikan versi ini aktif', 'Use this version as current')}</button>}
          {onApplyPreview && (
            <button type="button" disabled={busy} aria-busy={applying || undefined} onClick={onApplyPreview} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60 ${raisedGreen} ${pressGreen}`}>
              {applying ? <Spinner size={14} /> : <Check size={15} aria-hidden="true" />}{t('Terapkan hasil AI', 'Apply AI result')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
