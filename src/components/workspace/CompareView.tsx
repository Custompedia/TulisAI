'use client';
import { useState } from 'react';
import { ArrowLeftRight, Check, Columns2, Eye, LogOut, Minus, Plus, RotateCcw, Rows3, Timer } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { changePercentage, readingMinutes, wordDelta } from '@/lib/editor/metrics';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { DiffLegend, DiffText, useDiff } from './DiffText';
import { PREVIEW, WORKING } from './types';

type Option = { value: string; label: string };
type Props = {
  options: Option[]; a: string; b: string; before: string; after: string; loading: boolean; busy: boolean;
  onChange: (a: string, b: string) => void; onExit: () => void; onRestore: (versionId: string) => void; onApplyPreview?: () => void;
};

export function CompareView({ options, a, b, before, after, loading, busy, onChange, onExit, onRestore, onApplyPreview }: Props) {
  const { t } = useLocale();
  const [layout, setLayout] = useState<'inline' | 'side'>('inline');
  const parts = useDiff(before, after);
  const delta = wordDelta(before, after);
  const change = changePercentage(before, after);
  const readDelta = readingMinutes(after) - readingMinutes(before);
  const label = (value: string) => options.find((option) => option.value === value)?.label ?? value;
  const restorable = [a, b].find((value) => value !== WORKING && value !== PREVIEW);
  const identical = before === after;
  const size = identical ? t('Tidak ada perubahan', 'No changes') : change < 15 ? t('Perubahan kecil', 'Small change') : change < 45 ? t('Perubahan sedang', 'Moderate change') : t('Perubahan besar', 'Large change');

  return (
    <section aria-label={t('Bandingkan versi', 'Compare versions')} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-line bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"><Eye size={13} aria-hidden="true" />{t('Mode baca · editor dikunci', 'Read-only · editing paused')}</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <div className="hidden rounded-lg border border-line-strong p-0.5 xl:flex" role="radiogroup" aria-label={t('Tampilan', 'Layout')}>
              {([['inline', Rows3, t('Inline', 'Inline')], ['side', Columns2, t('Berdampingan', 'Side by side')]] as const).map(([value, Icon, text]) => (
                <button key={value} type="button" role="radio" aria-checked={layout === value} onClick={() => setLayout(value)} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${layout === value ? 'bg-ink-950 text-white' : 'text-ink-600 hover:text-ink-900'}`}><Icon size={13} aria-hidden="true" />{text}</button>
              ))}
            </div>
            {onApplyPreview && <Button size="sm" variant="primary" icon={Check} disabled={busy} onClick={onApplyPreview}>{t('Gunakan Hasil Ini', 'Use This Result')}</Button>}
            {restorable && <Button size="sm" icon={RotateCcw} disabled={busy} onClick={() => onRestore(restorable)}>{t('Jadikan versi ini aktif', 'Use this version as current')}</Button>}
            <Button size="sm" variant="dark" icon={LogOut} onClick={onExit}>{t('Keluar dari Bandingkan', 'Exit Compare')}</Button>
          </div>
        </div>
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Versi A (sebelum)', 'Version A (before)')}</p><Select label="A" value={a} disabled={busy || a === PREVIEW} options={options.filter((option) => option.value !== PREVIEW || a === PREVIEW)} onChange={(value) => onChange(value, b)} /></div>
          <Button size="md" variant="ghost" icon={ArrowLeftRight} aria-label={t('Tukar A dan B', 'Swap A and B')} disabled={busy} onClick={() => onChange(b, a)} className="justify-self-center"><span className="sm:sr-only">{t('Tukar', 'Swap')}</span></Button>
          <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Versi B (sesudah)', 'Version B (after)')}</p><Select label="B" value={b} disabled={busy || b === PREVIEW} options={options.filter((option) => option.value !== PREVIEW || b === PREVIEW)} onChange={(value) => onChange(a, value)} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-600">
          <span className="font-semibold text-ink-900">{size}</span>
          <span className="inline-flex items-center gap-1"><Plus size={13} className="text-brand-600" aria-hidden="true" />{delta.added} {t('kata ditambah', 'words added')}</span>
          <span className="inline-flex items-center gap-1"><Minus size={13} className="text-red-600" aria-hidden="true" />{delta.removed} {t('kata dihapus', 'words removed')}</span>
          <span>≈ {change}% {t('berubah', 'changed')}</span>
          <span className="inline-flex items-center gap-1"><Timer size={13} aria-hidden="true" />{readDelta === 0 ? t('waktu baca sama', 'same reading time') : `${readDelta > 0 ? '+' : ''}${readDelta} ${t('mnt baca', 'min read')}`}</span>
          <span className="ml-auto"><DiffLegend /></span>
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-paper px-3 py-6 sm:px-6">
        {loading ? <div className="flex justify-center py-20 text-ink-500"><Spinner size={20} /></div> : identical ? (
          <p className="mx-auto max-w-[780px] rounded-xl border border-line bg-white px-6 py-10 text-center text-sm text-ink-500">{t(`${label(a)} dan ${label(b)} identik.`, `${label(a)} and ${label(b)} are identical.`)}</p>
        ) : layout === 'side' ? (
          <div className="mx-auto grid max-w-[1400px] gap-4 xl:grid-cols-2">
            {(['before', 'after'] as const).map((side) => (
              <article key={side} className="rounded-xl border border-line bg-white px-8 py-8 shadow-sm">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.06em] text-ink-400">{side === 'before' ? `A · ${label(a)}` : `B · ${label(b)}`}</p>
                <DiffText parts={parts} side={side} className="font-serif text-[17px] leading-[1.8] text-ink-900" />
              </article>
            ))}
          </div>
        ) : (
          <article className="mx-auto max-w-[780px] rounded-xl border border-line bg-white px-6 py-8 shadow-sm sm:px-12 sm:py-12">
            <DiffText parts={parts} className="font-serif text-[17px] leading-[1.85] text-ink-900" />
          </article>
        )}
      </div>
    </section>
  );
}
