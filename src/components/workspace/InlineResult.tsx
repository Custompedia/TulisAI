'use client';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { posToDOMRect } from '@tiptap/core';
import { Check, Eye, EyeOff, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { changePercentage } from '@/lib/editor/metrics';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { DiffText, useDiff } from './DiffText';
import { getInlineTarget } from './inline-target';
import { previewText, type Preview } from './types';

export type InlineStatus = 'loading' | 'ready' | 'error';
type Props = {
  editor: Editor; label: string; status: InlineStatus; preview: Preview | null; message: string; stale: boolean; busy: boolean; applying: boolean;
  onApply: (alternative?: number) => void; onRetry?: () => void; onDiscard: () => void;
};
type Placement = { top: number; left: number; width: number };

const MAX_WIDTH = 480;
const GAP = 8;

// Anchors the card below the highlighted target inside the editor canvas; follows edits and resizes.
function usePlacement(editor: Editor, ref: RefObject<HTMLDivElement | null>): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const canvas = ref.current?.offsetParent;
      if (!(canvas instanceof HTMLElement)) return;
      const target = getInlineTarget(editor.state) ?? { from: editor.state.selection.from, to: editor.state.selection.to };
      const rect = posToDOMRect(editor.view, target.from, target.to); const box = canvas.getBoundingClientRect();
      const width = Math.min(MAX_WIDTH, box.width);
      setPlacement({ top: rect.bottom - box.top + GAP, left: Math.max(0, Math.min(rect.left - box.left, box.width - width)), width });
    };
    place();
    editor.on('transaction', place); window.addEventListener('resize', place);
    return () => { editor.off('transaction', place); window.removeEventListener('resize', place); };
  }, [editor, ref]);
  return placement;
}

function Lines() {
  return <div role="status" className="space-y-2 py-1"><div className="h-2.5 w-full animate-pulse rounded bg-paper-deep" /><div className="h-2.5 w-10/12 animate-pulse rounded bg-paper-deep" /><div className="h-2.5 w-7/12 animate-pulse rounded bg-paper-deep" /></div>;
}

function Result({ preview, alternative }: { preview: Preview; alternative: number }) {
  const { t } = useLocale();
  const [showDiff, setShowDiff] = useState(true);
  const result = previewText(preview, alternative);
  const parts = useDiff(preview.source, result);
  return (
    <div className="space-y-2">
      <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-lg bg-paper/70 px-3 py-2.5 font-serif text-[15px] leading-relaxed text-ink-900">
        {showDiff ? <DiffText parts={parts} /> : <p className="whitespace-pre-wrap">{result}</p>}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-500">≈ {changePercentage(preview.source, result)}% {t('berubah', 'changed')}</span>
        <button type="button" onClick={() => setShowDiff(!showDiff)} aria-pressed={showDiff} className="inline-flex items-center gap-1 font-semibold text-ink-500 hover:text-ink-900">
          {showDiff ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}{showDiff ? t('Sembunyikan tanda', 'Hide markup') : t('Tandai perubahan', 'Show changes')}
        </button>
      </div>
    </div>
  );
}

function Alternatives({ options, disabled, onPick }: { options: NonNullable<Preview['output']['alternatives']>; disabled: boolean; onPick: (index: number) => void }) {
  const { t } = useLocale();
  return (
    <div>
      <p className="mb-1.5 text-xs text-ink-500">{t('Klik salah satu untuk langsung mengganti teks.', 'Click one to replace the text right away.')}</p>
      <ul className="space-y-1">
        {options.map((option, index) => (
          <li key={index}>
            <button type="button" disabled={disabled} onClick={() => onPick(index)}
              className="flex w-full items-start gap-2.5 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent">
              <span className="min-w-0 flex-1 font-serif text-[15px] leading-relaxed text-ink-900">{option.text}</span>
              {option.variation_level && <span className="mt-1 shrink-0 rounded bg-paper-deep px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-500">{option.variation_level.replace(/_/g, ' ')}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InlineResult({ editor, label, status, preview, message, stale, busy, applying, onApply, onRetry, onDiscard }: Props) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const discard = useRef(onDiscard);
  const placement = usePlacement(editor, ref);
  discard.current = onDiscard;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); discard.current(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (status === 'loading') return;
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (status === 'ready') primary.current?.focus({ preventScroll: true });
  }, [status]);

  const ready = status === 'ready' && preview !== null;
  const alternatives = ready ? preview.output.alternatives : undefined;
  const unchanged = ready && !alternatives && (!!preview.output.no_change_needed || previewText(preview).trim() === preview.source.trim());
  const exceeds = ready && !!preview.output.exceeds_preservation && !unchanged;
  const warnings = ready ? preview.output.warnings?.slice(0, 2) ?? [] : [];
  const canApply = ready && !unchanged && !stale && !busy;

  return (
    <div ref={ref} role="dialog" aria-label={label} aria-busy={status === 'loading' || undefined} style={placement ?? { visibility: 'hidden' }}
      className="absolute z-20 max-w-full overflow-hidden rounded-2xl border border-line bg-white font-sans shadow-[0_2px_6px_rgb(0_0_0/0.05),0_16px_36px_-12px_rgb(0_0_0/0.22)] animate-fade-up">
      <header className="flex h-10 items-center gap-2 border-b border-line bg-paper px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">{label}</span>
        {status === 'loading' && <Spinner size={14} className="text-brand-600" />}
        <button type="button" onClick={onDiscard} aria-label={status === 'loading' ? t('Batalkan', 'Cancel') : t('Tutup', 'Close')} title={status === 'loading' ? t('Batalkan (Esc)', 'Cancel (Esc)') : t('Tutup (Esc)', 'Close (Esc)')} className="-mr-1 grid h-7 w-7 place-items-center rounded-md text-ink-500 hover:bg-paper-deep hover:text-ink-900"><X size={15} aria-hidden="true" /></button>
      </header>

      <div className="space-y-2.5 p-3">
        {status === 'loading' && <><p className="text-[13px] text-ink-600">{t('Menulis ulang dan memeriksa istilah terkunci…', 'Rewriting and checking locked terms…')}</p><Lines /></>}
        {status === 'error' && <p role="alert" className="flex gap-2 text-[13px] leading-relaxed text-red-800"><TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{message}</p>}
        {ready && stale && <p role="alert" className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"><TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{t('Tulisan berubah sejak hasil dibuat. Coba lagi agar hasilnya sesuai.', 'The text changed after this result was made. Try again for an up-to-date result.')}</p>}
        {ready && alternatives && <Alternatives options={alternatives} disabled={!canApply || applying} onPick={onApply} />}
        {ready && !alternatives && unchanged && <p className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-[13px] font-medium text-brand-900"><Check size={15} className="shrink-0" aria-hidden="true" />{t('Teks ini sudah sesuai. Tidak ada yang perlu diubah.', 'This text already fits. Nothing needs to change.')}</p>}
        {ready && !alternatives && !unchanged && <Result preview={preview} alternative={0} />}
        {exceeds && <p className="flex gap-2 text-xs text-amber-800"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{t('Hasil ini mengubah lebih banyak dari batas yang kamu pilih.', 'This result changes more than your chosen limit.')}</p>}
        {warnings.map((warning, index) => <p key={index} className="flex gap-2 text-xs text-amber-800"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{warning}</p>)}
      </div>

      {status !== 'loading' && (
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-line bg-paper/40 px-3 py-2">
          {ready && !alternatives && !unchanged && <Button ref={primary} size="sm" variant="primary" icon={Check} loading={applying} disabled={!canApply} onClick={() => onApply()}>{t('Ganti teks', 'Replace text')}</Button>}
          {onRetry && <Button size="sm" variant="ghost" icon={RefreshCw} disabled={busy} onClick={onRetry}>{alternatives ? t('Alternatif lain', 'Other alternatives') : t('Coba lagi', 'Try again')}</Button>}
          <Button size="sm" variant="ghost" icon={X} disabled={busy} className="ml-auto" onClick={onDiscard}>{t('Buang', 'Discard')}</Button>
        </footer>
      )}
    </div>
  );
}
