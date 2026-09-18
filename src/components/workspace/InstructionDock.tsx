'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, PencilSparkles, X } from 'lucide-react';
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

// A small rounded tab under the canvas that grows into the instruction field on hover and shrinks back when the pointer leaves.
export function InstructionDock({ busy, locked, target, onSubmit, onUpgrade }: Props) {
  const { t, locale } = useLocale();
  const tier = useRequiredTierName('freeform_prompt');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open && target && !busy) input.current?.focus({ preventScroll: true }); }, [open, target, busy]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { input.current?.blur(); setOpen(false); } };
    window.document.addEventListener('keydown', close);
    return () => window.document.removeEventListener('keydown', close);
  }, [open]);

  const trimmed = value.trim();
  const remaining = INSTRUCTION_LIMIT - value.length;
  const canSend = !busy && !locked && !!target && trimmed.length > 0;

  // The draft stays in state, so shrinking the dock never throws away what was typed.
  function collapse() { input.current?.blur(); setOpen(false); }
  function expand() { if (!locked) setOpen(true); }
  function send() {
    if (!canSend) return;
    onSubmit(trimmed);
    setValue(''); collapse();
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-3">
      <div
        ref={box}
        onMouseEnter={expand}
        onMouseLeave={() => { if (!busy) collapse(); }}
        onFocus={expand}
        onBlur={(event) => { if (!box.current?.contains(event.relatedTarget as Node | null) && !busy) setOpen(false); }}
        style={{ width: open ? 'min(560px, 100%)' : 56 }}
        className={`pointer-events-auto relative flex items-center overflow-hidden border bg-white transition-[width,height,border-radius,box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'h-11 rounded-[22px] border-line shadow-[0_1px_3px_rgb(31_32_29/0.10),0_12px_28px_-16px_rgb(31_32_29/0.40)]' : 'h-8 rounded-xl border-line shadow-[0_1px_3px_rgb(31_32_29/0.12)] hover:border-line-strong'
        }`}
      >
        {/* Stays mounted while open so keyboard focus hands over to the field instead of being dropped. */}
        <button type="button" tabIndex={open ? -1 : 0} aria-hidden={open} onClick={() => (locked ? onUpgrade() : expand())}
          aria-label={locked ? t('Perintah AI — paket berbayar', 'AI instruction — paid plan') : t('Perintah AI', 'AI instruction')}
          title={locked ? t(`Perintah AI — buka dengan ${tier}`, `AI instructions — unlock with ${tier}`) : t('Perintahkan AI untuk bagian yang sedang kamu tulis', 'Tell the AI what to do with the passage you are on')}
          className={`absolute inset-0 grid place-items-center transition-opacity duration-100 ${open ? 'pointer-events-none opacity-0' : 'opacity-100'} ${locked ? 'text-ink-400' : 'text-brand-700'}`}>
          {locked ? <PaidLock size={15} /> : <PencilSparkles size={17} strokeWidth={2} aria-hidden="true" />}
        </button>
        <div aria-hidden={!open} className={`flex min-w-0 flex-1 items-center gap-1 pl-3.5 pr-1.5 transition-opacity duration-150 motion-reduce:transition-none ${open ? 'opacity-100 delay-75' : 'pointer-events-none opacity-0'}`}>
          <PencilSparkles size={17} aria-hidden="true" className="shrink-0 text-brand-700" />
          <input
            ref={input}
            type="text"
            value={value}
            tabIndex={open ? 0 : -1}
            maxLength={INSTRUCTION_LIMIT}
            disabled={busy || !target || !open}
            aria-label={t('Perintah untuk AI', 'Instruction for the AI')}
            placeholder={busy ? t('AI sedang mengerjakan…', 'The AI is working…') : target ? t('Deskripsikan perubahan yang ingin Anda buat…', 'Describe the change you want…') : t('Letakkan kursor di paragraf atau blok teks dulu.', 'Put the cursor in a paragraph or select text first.')}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); send(); } }}
            className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[14px] text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed"
          />
          {value.length >= INSTRUCTION_COUNTER_AT && (
            <span aria-live="polite" className={`shrink-0 text-[11px] font-medium tabular-nums ${remaining <= 0 ? 'text-amber-800' : 'text-ink-400'}`}>
              {numberFormat(remaining, locale)}
            </span>
          )}
          {target && (
            <span className="hidden shrink-0 whitespace-nowrap rounded-md bg-paper-deep px-2 py-0.5 text-[11px] font-medium text-ink-600 sm:inline">
              {target.label}{target.words > 0 && ` · ${numberFormat(target.words, locale)}w`}
            </span>
          )}
          {value && (
            <button type="button" tabIndex={open ? 0 : -1} aria-label={t('Hapus perintah', 'Clear instruction')} onClick={() => { setValue(''); input.current?.focus(); }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-paper-deep hover:text-ink-800">
              <X size={14} aria-hidden="true" />
            </button>
          )}
          <button type="button" tabIndex={open ? 0 : -1} disabled={!canSend} aria-label={t('Jalankan perintah', 'Run the instruction')} onClick={send}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${canSend ? `${raisedGreen} ${pressGreen}` : 'bg-paper-deep text-ink-300'} disabled:cursor-not-allowed`}>
            {busy ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <ArrowUp size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
