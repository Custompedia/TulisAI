'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Sparkles, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { INSTRUCTION_COUNTER_AT, INSTRUCTION_LIMIT } from '@/lib/writing/instruction';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { PaidLock, useRequiredTierName } from '@/components/app/PaidLock';

type Props = {
  busy: boolean;
  locked: boolean;
  /** What the instruction will act on, resolved by the workspace: the selection, or the paragraph at the caret. */
  target: { label: string; words: number } | null;
  onSubmit: (instruction: string) => void;
  onUpgrade: () => void;
};

// A dock at the bottom of the canvas: collapsed to a single button until it is needed, then a one-line
// instruction about the passage the writer is on. Results land on the text itself, never in a side panel.
export function InstructionDock({ busy, locked, target, onSubmit, onUpgrade }: Props) {
  const { t, locale } = useLocale();
  const tier = useRequiredTierName('freeform_prompt');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const [focused, setFocused] = useState(false);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  // Esc closes the dock; a click outside closes it only while it is still empty, so a draft is never lost.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === 'Escape') setOpen(false); return; }
      if (!box.current?.contains(event.target as Node) && !value.trim()) setOpen(false);
    };
    window.document.addEventListener('mousedown', close);
    window.document.addEventListener('keydown', close);
    return () => { window.document.removeEventListener('mousedown', close); window.document.removeEventListener('keydown', close); };
  }, [open, value]);

  const trimmed = value.trim();
  const remaining = INSTRUCTION_LIMIT - value.length;
  const canSend = !busy && !locked && !!target && trimmed.length > 0;

  function send() {
    if (!canSend) return;
    onSubmit(trimmed);
    setValue(''); setOpen(false);
  }

  // Leaving the dock puts it away again, but never while something is typed or the field still has focus.
  const leave = () => { if (!value.trim() && !focused) setOpen(false); };
  const wrapper = 'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-3';

  if (!open) {
    return (
      <div className={wrapper}>
        <button type="button" onMouseEnter={() => { if (!locked) setOpen(true); }} onFocus={() => { if (!locked) setOpen(true); }}
          onClick={() => (locked ? onUpgrade() : setOpen(true))}
          aria-label={locked ? t('Perintah AI — paket berbayar', 'AI instruction — paid plan') : t('Perintah AI', 'AI instruction')}
          title={locked ? t(`Perintah AI — buka dengan ${tier}`, `AI instructions — unlock with ${tier}`) : t('Perintahkan AI untuk bagian yang sedang kamu tulis', 'Tell the AI what to do with the passage you are on')}
          className={`pointer-events-auto grid h-9 w-9 place-items-center rounded-full border bg-white shadow-[0_1px_3px_rgb(31_32_29/0.12)] transition-colors ${locked ? 'border-line text-ink-400 hover:border-line-strong' : 'border-line text-brand-700 hover:border-brand-300 hover:bg-brand-50'}`}>
          {locked ? <PaidLock size={15} /> : <Sparkles size={16} aria-hidden="true" />}
        </button>
      </div>
    );
  }

  return (
    <div className={wrapper} onMouseLeave={leave}>
      <div ref={box} className="pointer-events-auto w-full max-w-[520px] rounded-full border border-line bg-white px-1 py-1 shadow-[0_1px_3px_rgb(31_32_29/0.12),0_10px_24px_-14px_rgb(31_32_29/0.35)] animate-fade-up">
        <div className="flex items-center gap-0.5">
          <Sparkles size={15} aria-hidden="true" className="ml-2 shrink-0 text-brand-700" />
          <input
            ref={input}
            type="text"
            value={value}
            maxLength={INSTRUCTION_LIMIT}
            disabled={busy || !target}
            aria-label={t('Perintah untuk AI', 'Instruction for the AI')}
            placeholder={target ? t('Mis. ubah ini ke English, atau persingkat ini…', 'E.g. translate this to English, or shorten this…') : t('Letakkan kursor di paragraf atau blok teks dulu.', 'Put the cursor in a paragraph or select text first.')}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); send(); } }}
            title={target ? t('Istilah terkunci, sitasi, dan angka tetap dijaga.', 'Locked terms, citations, and numbers stay protected.') : undefined}
            className="h-8 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed"
          />
          {value.length >= INSTRUCTION_COUNTER_AT && (
            <span aria-live="polite" className={`shrink-0 text-[11px] font-medium tabular-nums ${remaining <= 0 ? 'text-amber-800' : 'text-ink-400'}`}>
              {numberFormat(remaining, locale)}
            </span>
          )}
          {/* What it will act on, inline so the bar stays one line. */}
          {target && (
            <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-paper-deep px-2 py-0.5 text-[11px] font-medium text-ink-600 sm:inline">
              {target.label}{target.words > 0 && ` · ${numberFormat(target.words, locale)}w`}
            </span>
          )}
          <button type="button" aria-label={t('Tutup', 'Close')} onClick={() => { setValue(''); setOpen(false); }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-paper-deep hover:text-ink-800">
            <X size={14} aria-hidden="true" />
          </button>
          <button type="button" disabled={!canSend} aria-label={t('Jalankan perintah', 'Run the instruction')} onClick={send}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${canSend ? `${raisedGreen} ${pressGreen}` : 'bg-paper-deep text-ink-300'} disabled:cursor-not-allowed`}>
            {busy ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <ArrowUp size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
