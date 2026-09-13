'use client';
import { useMemo } from 'react';
import { diffWords, type Change } from 'diff';
import { useLocale } from '@/lib/client/locale';

// Bounded word diff; very large inputs fall back to a whole-block replacement.
export function useDiff(before: string, after: string): Change[] {
  return useMemo(() => {
    const whole = [{ value: before, removed: true, added: false, count: 1 }, { value: after, added: true, removed: false, count: 1 }] as Change[];
    if (before === after) return [{ value: after, added: false, removed: false, count: 1 } as Change];
    if (before.length + after.length > 100_000) return whole;
    return diffWords(before, after, { maxEditLength: 4000, timeout: 150 }) ?? whole;
  }, [before, after]);
}

export function DiffText({ parts, side = 'both', className = '' }: { parts: Change[]; side?: 'both' | 'before' | 'after'; className?: string }) {
  const { t } = useLocale();
  return (
    <div className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => {
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
