'use client';
import { Info, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { changePercentage, countSentences, countWords, readingMinutes, repeatedWords } from '@/lib/editor/metrics';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import type { Quality, QualityBand, QualityDimension } from './types';

type Props = {
  text: string; original: string | null; scopeLabel: string; quality: Quality | null; stale: boolean; loading: boolean; error: string;
  blockedReason: string | null; onAnalyze: () => void;
};

const BANDS: QualityBand[] = ['rendah', 'sedang', 'tinggi'];

export function AnalyticsPanel({ text, original, scopeLabel, quality, stale, loading, error, blockedReason, onAnalyze }: Props) {
  const { t, locale } = useLocale();
  const n = (value: number) => numberFormat(value, locale);
  const repeated = repeatedWords(text);
  const views: Record<QualityBand, { label: string; tone: string }> = {
    rendah: { label: t('Rendah', 'Low'), tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
    sedang: { label: t('Sedang', 'Medium'), tone: 'bg-paper-deep text-ink-700 ring-line-strong' },
    tinggi: { label: t('Tinggi', 'High'), tone: 'bg-brand-50 text-brand-800 ring-brand-100' },
    tidak_berlaku: { label: t('Tidak berlaku', 'Not applicable'), tone: 'bg-white text-ink-400 ring-line' },
  };
  const band = (value: QualityBand | undefined) => (value && Object.hasOwn(views, value) ? views[value] : views.tidak_berlaku);
  const dimensions: Array<[QualityDimension, string]> = [['clarity', t('Kejelasan', 'Clarity')], ['naturalness', t('Kenaturalan', 'Naturalness')], ['formality', t('Formalitas', 'Formality')], ['academic_fit', t('Kesesuaian akademik', 'Academic fit')]];
  const items = quality?.dimensions ?? quality;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 text-[13px] font-medium text-ink-900">{t('Sebelum & sesudah', 'Before & after')}</h3>
        <p className="mb-2.5 text-xs text-ink-500">{t('Dihitung langsung di perangkatmu, tanpa AI.', 'Computed on your device, without AI.')}</p>
        {original === null ? <p className="text-[13px] text-ink-500">{t('Original belum termuat.', 'The original is not loaded.')}</p> : (
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="grid grid-cols-3 bg-paper px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400"><span /><span>Original</span><span>{t('Sekarang', 'Current')}</span></div>
            {[[t('Kata', 'Words'), countWords(original), countWords(text)], [t('Kalimat', 'Sentences'), countSentences(original), countSentences(text)], [t('Menit baca', 'Minutes'), readingMinutes(original), readingMinutes(text)]].map(([label, before, after]) => (
              <div key={String(label)} className="grid grid-cols-3 border-t border-line px-3 py-2 text-[13px]"><span className="text-ink-500">{label}</span><span className="text-ink-700">{n(Number(before))}</span><span className="font-semibold text-ink-900">{n(Number(after))}</span></div>
            ))}
            <div className="border-t border-line bg-brand-50 px-3 py-2 text-[13px] text-brand-800">≈ <b>{changePercentage(original, text)}%</b> {t('berubah dari Original', 'changed from the Original')}</div>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-medium text-ink-900">{t('Kata yang sering diulang', 'Frequently repeated words')}</h3>
        {repeated.length === 0 ? <p className="text-[13px] text-ink-500">{t('Tidak ada pengulangan menonjol.', 'No notable repetition.')}</p> : (
          <ul className="flex flex-wrap gap-1.5">{repeated.map((item) => <li key={item.word} className="rounded-md bg-paper-deep px-2 py-1 text-xs text-ink-700"><b className="font-semibold">{item.word}</b> ×{item.count}</li>)}</ul>
        )}
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-ink-900"><Sparkles size={15} className="text-brand-600" aria-hidden="true" />{t('Analisis kualitas', 'Quality analysis')}<span className="rounded bg-paper-deep px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">{t('indikatif', 'indicative')}</span></h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">{t('Opsional dan hanya berjalan saat kamu meminta. Hasilnya indikatif — bukan nilai akademik, deteksi AI, atau cek plagiarisme.', 'Optional and runs only when you ask. Results are indicative — not an academic grade, AI detection, or plagiarism check.')}</p>
        {loading && !quality && (
          <div role="status" className="mt-4 space-y-2"><div className="h-3 w-3/4 animate-pulse rounded bg-paper-deep" /><div className="h-3 w-full animate-pulse rounded bg-paper-deep" /><div className="h-3 w-2/3 animate-pulse rounded bg-paper-deep" /></div>
        )}
        {quality && items && (
          <div className="mt-4 space-y-3.5">
            {stale && <p className="flex gap-1.5 text-xs text-amber-800"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{t('Tulisan sudah berubah sejak dianalisis.', 'The text changed since this analysis.')}</p>}
            {dimensions.map(([key, label]) => {
              const item = items[key]; const view = band(item?.value); const active = item?.value && item.value !== 'tidak_berlaku';
              return (
                <div key={key}>
                  <div className="flex items-center justify-between gap-2"><p className="text-[13px] font-semibold text-ink-800">{label}</p><span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ${view.tone}`}>{view.label}</span></div>
                  {active && <div className="mt-1.5 grid grid-cols-3 gap-1" aria-hidden="true">{BANDS.map((value, index) => <span key={value} className={`h-1.5 rounded-full ${index <= BANDS.indexOf(item.value) ? 'bg-brand-400' : 'bg-paper-deep'}`} />)}</div>}
                  {item?.reason && <p className="mt-1 text-xs leading-relaxed text-ink-500">{item.reason}</p>}
                </div>
              );
            })}
            {(quality.warnings ?? []).map((warning, index) => <p key={index} className="flex gap-1.5 text-xs text-amber-800"><Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{warning}</p>)}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-[13px] text-red-700">{error}</p>}
        {blockedReason && <p className="mt-3 text-[13px] text-amber-800">{blockedReason}</p>}
        <Button className="mt-4 w-full" variant={quality ? 'secondary' : 'primary'} icon={quality ? RefreshCw : Sparkles} loading={loading} disabled={loading || Boolean(blockedReason)} onClick={onAnalyze}>
          {loading ? t('Menganalisis…', 'Analysing…') : quality ? t('Analisis ulang', 'Analyse again') : t('Analisis kualitas', 'Analyse quality')}
        </Button>
        <p className="mt-2 text-center text-[11px] text-ink-400">{loading ? <Spinner size={11} className="mr-1 inline" /> : null}{t('Bagian dianalisis', 'Analysing')}: {scopeLabel} · {t('memakai 1 kuota AI', 'uses 1 AI request')}</p>
      </section>
    </div>
  );
}
