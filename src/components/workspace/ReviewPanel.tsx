'use client';
import { ChartNoAxesColumn } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { changePercentage, countCharacters, countSentences, countWords, formatDuration, readingMinutes, speakingSeconds } from '@/lib/editor/metrics';

type Props = {
  text: string; original: string | null;
  // False for a skeleton or blank notebook: its Original is empty or just the outline, so "changed from" means nothing.
  showOriginal: boolean; hasChanges: boolean;
  // Script and caption are spoken, so they also get a speaking time.
  spoken: boolean;
  analytics: React.ReactNode;
};

export const ANALYTICS_SECTION_ID = 'notebook-analytics';

// Tinjau: stats, before & after, repeated words and the quality analysis, in that order. It replaces the old
// Info tab and the ⋯ Analisis entry; the outline and locked terms moved to the Dokumen panel.
export function ReviewPanel({ text, original, showOriginal, hasChanges, spoken, analytics }: Props) {
  const { t, locale } = useLocale();
  const n = (value: number) => numberFormat(value, locale);
  const stats: Array<[string, string]> = [
    [t('Kata', 'Words'), n(countWords(text))], [t('Karakter', 'Characters'), n(countCharacters(text))], [t('Kalimat', 'Sentences'), n(countSentences(text))],
    [t('Waktu baca', 'Reading time'), `≈ ${readingMinutes(text)} ${t('mnt', 'min')}`],
    ...(spoken ? [[t('Durasi bicara', 'Speaking time'), `≈ ${formatDuration(speakingSeconds(text), t)}`] as [string, string]] : []),
    ...(showOriginal ? [[t('Berubah dari Original', 'Changed from Original'), original === null ? '—' : hasChanges ? `${changePercentage(original, text)}%` : '0%'] as [string, string]] : []),
  ];

  return (
    <div className="scrollbar-thin h-full space-y-7 overflow-y-auto p-4">
      <section aria-label={t('Statistik notebook', 'Notebook stats')}>
        <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-ink-900"><ChartNoAxesColumn size={14} className="text-brand-700" aria-hidden="true" />{t('Statistik', 'Stats')}</h3>
        <dl className="divide-y divide-line rounded-xl border border-line bg-white">
          {stats.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-[13px]"><dt className="text-ink-500">{label}</dt><dd className="font-medium tabular-nums text-ink-900">{value}</dd></div>)}
        </dl>
      </section>
      <section id={ANALYTICS_SECTION_ID} aria-label={t('Analisis', 'Analytics')} className="scroll-mt-4">{analytics}</section>
    </div>
  );
}
