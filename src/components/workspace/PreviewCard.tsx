'use client';
import { useState } from 'react';
import { Check, CircleCheck, Columns2, Copy, Eye, EyeOff, Feather, Minus, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { changePercentage } from '@/lib/editor/metrics';
import { Button } from '@/components/ui/Button';
import { DiffText, useDiff } from './DiffText';
import { previewText, type Preview } from './types';

// Panel-side preview for whole-scope rewrites; inline quick actions render in InlineResult instead.
type Props = {
  preview: Preview; stale: boolean; busy: boolean; applying: boolean;
  onApply: () => void; onCompare: () => void; onDiscard: () => void; onRetry: () => void; onStronger: () => void; onReduce: () => void;
};

export function PreviewCard({ preview, stale, busy, applying, onApply, onCompare, onDiscard, onRetry, onStronger, onReduce }: Props) {
  const { t } = useLocale();
  const [showDiff, setShowDiff] = useState(true);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const result = previewText(preview);
  const parts = useDiff(preview.source, result);
  const unchanged = !!preview.output.no_change_needed || result.trim() === preview.source.trim();
  const exceeds = !!preview.output.exceeds_preservation && !unchanged;
  const humanize = preview.settings.mode === 'humanize';
  const scopeLabel = { selection: t('Teks terpilih', 'Selection'), paragraph: t('Paragraf', 'Paragraph'), document: t('Seluruh dokumen', 'Entire document') }[preview.scope];

  async function copy() {
    try { await navigator.clipboard.writeText(result); setCopied('done'); } catch { setCopied('failed'); }
    setTimeout(() => setCopied('idle'), 2000);
  }

  return (
    <section aria-label={t('Pratinjau hasil', 'Result preview')} className="animate-fade-up overflow-hidden rounded-xl border border-brand-200 bg-white">
      <header className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-3.5 py-2.5">
        <Eye size={15} className="text-brand-700" aria-hidden="true" />
        <p className="flex-1 text-[13px] font-semibold text-brand-900">{t('Pratinjau', 'Preview')} <span className="font-normal text-brand-700">· {t('belum diterapkan', 'not applied')}</span></p>
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-600 ring-1 ring-brand-100">{scopeLabel}</span>
      </header>

      <div className="space-y-3 p-3.5">
        {exceeds && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
            <p className="flex gap-2"><TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{t('Hasil ini mengubah lebih banyak dari batas yang kamu pilih.', 'This result changes more than your chosen limit.')}</p>
            <Button size="sm" className="mt-2" icon={Minus} disabled={busy || (preview.settings.strength === 'light' && preview.settings.preservation === 'conservative')} onClick={onReduce}>{t('Kurangi Perubahan', 'Reduce Changes')}</Button>
          </div>
        )}
        {stale && <p role="alert" className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"><TriangleAlert size={15} className="mt-0.5 shrink-0" />{t('Tulisan berubah sejak hasil dibuat. Buat ulang agar editan terbarumu aman.', 'The text changed after this result was made. Regenerate to keep your latest edits safe.')}</p>}

        {unchanged ? (
          <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-3 text-[13px] text-brand-900">
            <p className="flex items-center gap-2 font-semibold"><CircleCheck size={15} />{t('Teks ini sudah cukup sesuai dengan tujuan yang dipilih.', 'This text already fits the selected goal.')}</p>
            {preview.settings.strength !== 'strong' && <Button size="sm" className="mt-2.5" icon={Plus} disabled={busy} onClick={onStronger}>{t('Coba perubahan lebih kuat', 'Try a stronger change')}</Button>}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-500">≈ {changePercentage(preview.source, result)}% {t('berubah', 'changed')}</span>
              <button type="button" onClick={() => setShowDiff(!showDiff)} aria-pressed={showDiff} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-900">
                {showDiff ? <EyeOff size={13} /> : <Eye size={13} />}{showDiff ? t('Sembunyikan tanda', 'Hide markup') : t('Tandai perubahan', 'Show changes')}
              </button>
            </div>
            <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-lg bg-paper/60 px-3 py-2.5 font-serif text-[15px] leading-relaxed text-ink-900">
              {showDiff ? <DiffText parts={parts} /> : <p className="whitespace-pre-wrap">{result}</p>}
            </div>
          </>
        )}

        {!!preview.output.change_categories?.length && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-600">{t('Yang berubah', 'What changed')}</p>
            <ul className="flex flex-wrap gap-1.5">{preview.output.change_categories.map((item, index) => <li key={index} className="inline-flex items-center gap-1 rounded-md bg-paper-deep px-2 py-1 text-xs text-ink-700"><Check size={12} className="text-brand-600" aria-hidden="true" />{item}</li>)}</ul>
          </div>
        )}
        {!!preview.output.warnings?.length && (
          <ul className="space-y-1.5">{preview.output.warnings.map((warning, index) => <li key={index} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"><TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{warning}</li>)}</ul>
        )}
      </div>

      <footer className="space-y-2 border-t border-line bg-paper/40 p-3">
        <Button variant="primary" className="w-full" icon={Check} loading={applying} disabled={busy || stale || unchanged} onClick={onApply}>{t('Gunakan Hasil Ini', 'Use This Result')}</Button>
        <div className="flex flex-wrap gap-1.5 [&>*]:flex-1">
          <Button size="sm" icon={Columns2} disabled={busy} onClick={onCompare}>{t('Bandingkan', 'Compare')}</Button>
          <Button size="sm" icon={copied === 'done' ? Check : Copy} disabled={busy} onClick={() => void copy()}>{copied === 'done' ? t('Tersalin', 'Copied') : copied === 'failed' ? t('Gagal', 'Failed') : t('Salin', 'Copy')}</Button>
          <Button size="sm" icon={X} disabled={busy} onClick={onDiscard}>{t('Buang Hasil', 'Discard')}</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" icon={RefreshCw} disabled={busy} onClick={onRetry}>{t('Coba alternatif lain', 'Try another')}</Button>
          {humanize && <Button size="sm" variant="ghost" icon={Feather} disabled={busy} onClick={onStronger}>{t('Lebih natural', 'More natural')}</Button>}
          {humanize && !exceeds && !unchanged && <Button size="sm" variant="ghost" icon={Minus} disabled={busy} onClick={onReduce}>{t('Kurangi perubahan', 'Reduce changes')}</Button>}
        </div>
      </footer>
    </section>
  );
}
