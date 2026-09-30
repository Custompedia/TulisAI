'use client';
import { Fragment, useState } from 'react';
import { Check, Copy, GraduationCap, PenLine, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Button } from '@/components/ui/Button';
import { draftPlainText, type Preview } from './types';

// Placeholders the draft left for the writer ([angka], [sumber], [contoh]…) stand out so none is missed.
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[[^[\]\n]{1,120}\])/u);
  return <>{parts.map((part, index) => (/^\[.*\]$/u.test(part) ? <mark key={index} className="rounded bg-amber-100 px-0.5 text-amber-900">{part}</mark> : <Fragment key={index}>{part}</Fragment>))}</>;
}

type Props = { preview: Preview; stale: boolean; busy: boolean; applying: boolean; onApply: () => void; onDiscard: () => void; onRetry: () => void };

// UX 3: the pratinjau of a Draf dari brief result. It is always labelled as a draft to check, and for Esai / Skripsi
// it says plainly that sources and figures are the writer's own work.
export function DraftCard({ preview, stale, busy, applying, onApply, onDiscard, onRetry }: Props) {
  const { t } = useLocale();
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const blocks = preview.output.blocks ?? [];
  const academic = preview.draft?.academic === true;
  async function copy() {
    try { await navigator.clipboard.writeText(draftPlainText(blocks)); setCopied('done'); } catch { setCopied('failed'); }
    setTimeout(() => setCopied('idle'), 2000);
  }
  return (
    <section aria-label={t('Pratinjau draf', 'Draft preview')} className="animate-fade-up overflow-hidden rounded-xl border border-brand-200 bg-white">
      <header className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-3.5 py-2.5">
        <PenLine size={15} className="text-brand-700" aria-hidden="true" />
        <p className="flex-1 text-[13px] font-semibold text-brand-900">{t('Draf', 'Draft')} <span className="font-normal text-brand-700">· {t('belum diterapkan', 'not applied')}</span></p>
        {preview.draft?.heading && <span className="max-w-[45%] truncate rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-600 ring-1 ring-brand-100" title={preview.draft.heading}>{preview.draft.heading}</span>}
      </header>
      <div className="space-y-3 p-3.5">
        <p role="note" className={`flex gap-2 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ${academic ? 'border border-amber-200 bg-amber-50 text-amber-900' : 'bg-paper text-ink-700'}`}>
          {academic ? <GraduationCap size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <TriangleAlert size={15} className="mt-0.5 shrink-0 text-ink-500" aria-hidden="true" />}
          <span>{academic
            ? t('Kerangka draf untuk tugas akademik, bukan tulisan jadi. AI tidak mencarikan sumber: isi setiap [sumber] dan [angka] dari bacaanmu sendiri, lalu tulis ulang dengan kata-katamu. Tulisan akhirnya tanggung jawabmu.', 'A draft skeleton for academic work, not finished writing. The AI finds no sources: fill every [source] and [figure] from your own reading, then rewrite it in your own words. The final text is your responsibility.')
            : t('Draf untuk kamu periksa. Isi setiap [placeholder] dengan data dan sumbermu sendiri sebelum dipakai.', 'A draft for you to check. Fill every [placeholder] with your own data and sources before using it.')}</span>
        </p>
        {stale && <p role="alert" className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"><TriangleAlert size={15} className="mt-0.5 shrink-0" />{t('Tulisan berubah sejak draf dibuat. Buat ulang agar draf masuk di tempat yang benar.', 'The text changed after this draft was made. Make it again so it lands in the right place.')}</p>}
        <div className="scrollbar-thin max-h-80 space-y-2 overflow-y-auto rounded-lg bg-paper/60 px-3 py-2.5 font-serif text-[15px] leading-relaxed text-ink-900">
          {blocks.map((block, index) => block.type === 'subheading' ? <h4 key={index} className="font-sans text-[14px] font-semibold"><Marked text={block.text} /></h4>
            : block.type === 'bullet_list' ? <ul key={index} className="list-disc space-y-0.5 pl-5">{block.items.map((item, key) => <li key={key}><Marked text={item} /></li>)}</ul>
            : block.type === 'numbered_list' ? <ol key={index} className="list-decimal space-y-0.5 pl-5">{block.items.map((item, key) => <li key={key}><Marked text={item} /></li>)}</ol>
            : <p key={index}><Marked text={block.text} /></p>)}
        </div>
        {!!preview.output.warnings?.length && (
          <ul className="space-y-1.5">{preview.output.warnings.map((warning, index) => <li key={index} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"><TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{warning}</li>)}</ul>
        )}
      </div>
      <footer className="space-y-2 border-t border-line bg-paper/40 p-3">
        <Button variant="primary" className="w-full" icon={Check} loading={applying} disabled={busy || stale} onClick={onApply}>{t('Gunakan draf ini', 'Use this draft')}</Button>
        <div className="flex flex-wrap gap-1.5 [&>*]:flex-1">
          <Button size="sm" icon={copied === 'done' ? Check : Copy} disabled={busy} onClick={() => void copy()}>{copied === 'done' ? t('Tersalin', 'Copied') : copied === 'failed' ? t('Gagal', 'Failed') : t('Salin', 'Copy')}</Button>
          <Button size="sm" icon={X} disabled={busy} onClick={onDiscard}>{t('Buang', 'Discard')}</Button>
          <Button size="sm" icon={RefreshCw} disabled={busy} onClick={onRetry}>{t('Tulis ulang', 'Write again')}</Button>
        </div>
      </footer>
    </section>
  );
}
