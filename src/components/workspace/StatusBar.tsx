'use client';
import { useMemo } from 'react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { countCharacters, countWords, formatDuration, readingMinutes, speakingSeconds } from '@/lib/editor/metrics';

// Kata · karakter · waktu baca · durasi bicara (Script/Caption) · hal x/y, counted on the device. A click opens Tinjau.
export function StatusBar({ text, spoken, page, onOpen }: { text: string; spoken: boolean; page: { current: number; total: number } | null; onOpen: () => void }) {
  const { t, locale } = useLocale();
  const n = (value: number) => numberFormat(value, locale);
  // Counted when the text changes, not on every render: the bar re-renders with each keystroke.
  const counts = useMemo(() => ({ words: countWords(text), characters: countCharacters(text), reading: readingMinutes(text), speaking: speakingSeconds(text) }), [text]);
  const parts = [
    `${n(counts.words)} ${t('kata', 'words')}`,
    `${n(counts.characters)} ${t('kar', 'chars')}`,
    `${counts.reading} ${t('mnt baca', 'min read')}`,
    ...(spoken ? [`${formatDuration(counts.speaking, t)} ${t('bicara', 'spoken')}`] : []),
    ...(page ? [`${t('hal', 'page')} ${n(page.current)}/${n(page.total)}`] : []),
  ];
  return (
    <button type="button" onClick={onOpen} title={t('Buka Tinjau', 'Open Review')}
      className="flex h-8 w-full shrink-0 items-center gap-2 overflow-hidden border-t border-line bg-white px-4 text-left text-[12px] tabular-nums text-ink-500 transition-colors hover:bg-paper hover:text-ink-800">
      {parts.map((part, index) => <span key={index} className={`shrink-0 whitespace-nowrap ${index > 1 && index < parts.length - 1 ? 'hidden sm:inline' : ''}`}>{index > 0 && <span aria-hidden="true" className="mr-2 text-ink-300">·</span>}{part}</span>)}
    </button>
  );
}
