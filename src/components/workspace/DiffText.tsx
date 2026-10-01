'use client';
import { useMemo } from 'react';
import { diffArrays, diffWords, type Change } from 'diff';
import { useLocale } from '@/lib/client/locale';

// `skipped` marks unchanged paragraphs folded away (or, with `truncated`, changes past what is shown).
export type DiffPart = Change & { skipped?: number; truncated?: boolean };

// Word diffs up to 100,000 characters. Past that (two versions of a thesis), paragraphs are compared instead, with a
// bounded edit budget, unchanged stretches folded to two paragraphs of context on each side, and at most
// MAX_SHOWN characters drawn, so comparing two 2,000-page versions never freezes the tab.
const WORD_DIFF_LIMIT = 100_000;
const CONTEXT = 2;
const MAX_SHOWN = 400_000;

export function diffParts(before: string, after: string): DiffPart[] {
  if (before === after) return [{ value: after, added: false, removed: false, count: 1 } as DiffPart];
  if (before.length + after.length <= WORD_DIFF_LIMIT) {
    const whole = [{ value: before, removed: true, added: false, count: 1 }, { value: after, added: true, removed: false, count: 1 }] as DiffPart[];
    return diffWords(before, after, { maxEditLength: 4000, timeout: 150 }) ?? whole;
  }
  const changes = diffArrays(before.split('\n'), after.split('\n'), { maxEditLength: 4000, timeout: 600 });
  const parts: DiffPart[] = [];
  let shown = 0;
  const push = (part: DiffPart) => { parts.push(part); shown += part.value.length; };
  const lines = (items: string[]) => items.map((line) => `${line}\n`).join('');
  if (!changes) {
    // Too different to align paragraph by paragraph: each side's beginning, marked as replaced.
    push({ value: before.slice(0, MAX_SHOWN / 2), removed: true, added: false, count: 1 });
    push({ value: after.slice(0, MAX_SHOWN / 2), added: true, removed: false, count: 1 });
    parts.push({ value: '', added: false, removed: false, count: 0, truncated: true, skipped: 0 });
    return parts;
  }
  changes.forEach((change, index) => {
    if (shown > MAX_SHOWN) return;
    const items = change.value;
    if (change.added || change.removed) { push({ value: lines(items), added: !!change.added, removed: !!change.removed, count: items.length }); return; }
    const head = index === 0 ? 0 : CONTEXT; const tail = index === changes.length - 1 ? 0 : CONTEXT;
    if (items.length <= head + tail + 1) { push({ value: lines(items), added: false, removed: false, count: items.length }); return; }
    if (head) push({ value: lines(items.slice(0, head)), added: false, removed: false, count: head });
    parts.push({ value: '', added: false, removed: false, count: 0, skipped: items.length - head - tail });
    if (tail) push({ value: lines(items.slice(items.length - tail)), added: false, removed: false, count: tail });
  });
  if (shown > MAX_SHOWN) parts.push({ value: '', added: false, removed: false, count: 0, truncated: true, skipped: 0 });
  return parts;
}

export function useDiff(before: string, after: string): DiffPart[] {
  return useMemo(() => diffParts(before, after), [before, after]);
}

export function DiffText({ parts, side = 'both', className = '' }: { parts: DiffPart[]; side?: 'both' | 'before' | 'after'; className?: string }) {
  const { t, locale } = useLocale();
  return (
    <div className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => {
        if (part.truncated) return <span key={index} className="my-2 block font-sans text-[12px] text-ink-500">{t('Perbedaan berikutnya tidak ditampilkan: dokumennya terlalu panjang untuk dibandingkan seluruhnya.', 'Further differences are not shown: the documents are too long to compare in full.')}</span>;
        if (part.skipped) return <span key={index} className="my-2 block font-sans text-[12px] text-ink-400">⋯ {new Intl.NumberFormat(locale).format(part.skipped)} {t('paragraf tidak berubah', 'unchanged paragraphs')} ⋯</span>;
        if (part.added) return side === 'before' ? null : <ins key={index} className="diff-add"><span className="sr-only">[{t('ditambahkan', 'added')}: </span>{part.value}<span className="sr-only">]</span></ins>;
        if (part.removed) return side === 'after' ? null : <del key={index} className="diff-del"><span className="sr-only">[{t('dihapus', 'removed')}: </span>{part.value}<span className="sr-only">]</span></del>;
        return <span key={index}>{part.value}</span>;
      })}
    </div>
  );
}

export function DiffLegend() {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
      <span className="inline-flex items-center gap-1.5"><ins className="diff-add px-1">abc</ins>{t('ditambahkan', 'added')}</span>
      <span className="inline-flex items-center gap-1.5"><del className="diff-del px-1">abc</del>{t('dihapus', 'removed')}</span>
    </div>
  );
}
