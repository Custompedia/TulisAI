'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowUp, Loader2, PencilSparkles, Square, X } from 'lucide-react';
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
  /** Lets the workspace keep the target highlighted while focus sits in the field. */
  onOpenChange?: (open: boolean) => void;
  /** An instruction from this dock is being processed; the dock shows progress and a stop button. */
  running?: boolean;
  onStop?: () => void;
};

// A small rounded tab under the canvas that grows into the instruction field on hover; it shrinks back on leave only while empty.
export function InstructionDock({ busy, locked, target, onSubmit, onUpgrade, onOpenChange, running = false, onStop }: Props) {
  const { t, locale } = useLocale();
  const tier = useRequiredTierName('freeform_prompt');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open && target && !busy) input.current?.focus({ preventScroll: true }); }, [open, target, busy]);
  const notify = useEffectEvent((value: boolean) => onOpenChange?.(value));
  useEffect(() => { notify(open); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { input.current?.blur(); setOpen(false); } };
    window.document.addEventListener('keydown', close);
    return () => window.document.removeEventListener('keydown', close);
  }, [open]);

  const expanded = open || running;
  const trimmed = value.trim();
  const remaining = INSTRUCTION_LIMIT - value.length;
  const canSend = !busy && !locked && !!target && trimmed.length > 0;

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
        onMouseLeave={() => { if (!busy && !value.trim()) collapse(); }}
        onFocus={expand}
        onBlur={(event) => { if (!box.current?.contains(event.relatedTarget as Node | null) && !busy && !value.trim()) setOpen(false); }}
        style={{ width: expanded ? 'min(760px, 100%)' : 76 }}
        className={`pointer-events-auto relative flex items-center overflow-hidden rounded-full border transition-[width,height,background-color,box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none ${
          expanded ? 'h-14 border-line bg-white shadow-[0_2px_6px_rgb(31_32_29/0.08),0_16px_36px_-18px_rgb(31_32_29/0.45)]' : 'h-8 border-brand-100 bg-brand-50 hover:bg-brand-100'
        }`}
      >
        {/* Stays mounted while open so keyboard focus hands over to the field instead of being dropped. */}
        <button type="button" tabIndex={expanded ? -1 : 0} aria-hidden={expanded} onClick={() => (locked ? onUpgrade() : expand())}
          aria-label={locked ? t('Perintah AI — paket berbayar', 'AI instruction — paid plan') : t('Perintah AI', 'AI instruction')}
          title={locked ? t(`Perintah AI — buka dengan ${tier}`, `AI instructions — unlock with ${tier}`) : t('Perintahkan AI untuk bagian yang sedang kamu tulis', 'Tell the AI what to do with the passage you are on')}
          className={`absolute inset-0 grid place-items-center transition-opacity duration-100 ${expanded ? 'pointer-events-none opacity-0' : 'opacity-100'} ${locked ? 'text-ink-400' : 'text-brand-700'}`}>
          {locked ? <PaidLock size={15} /> : <PencilSparkles size={17} aria-hidden="true" />}
        </button>
        {running && (
          <div role="status" className="flex min-w-0 flex-1 items-center gap-3 pl-3.5 pr-2.5 animate-fade-up">
            <span aria-hidden="true" className="relative grid h-9 w-9 shrink-0 place-items-center text-brand-700">
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-brand-100 border-t-brand-600 motion-reduce:animate-none" />
              <PencilSparkles size={16} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-700">{t('Memproses…', 'Working…')}</span>
            {onStop && (
              <button type="button" onClick={onStop} aria-label={t('Hentikan', 'Stop')} title={t('Hentikan', 'Stop')}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-800 transition-colors hover:bg-brand-100">
                <Square size={13} fill="currentColor" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div aria-hidden={!open || running} className={`${running ? 'hidden' : 'flex'} min-w-0 flex-1 items-center gap-1.5 pl-5 pr-2.5 transition-opacity duration-150 motion-reduce:transition-none ${open ? 'opacity-100 delay-75' : 'pointer-events-none opacity-0'}`}>
          <PencilSparkles size={19} aria-hidden="true" className="shrink-0 text-brand-700" />
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
            className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed"
          />
          {value.length >= INSTRUCTION_COUNTER_AT && (
            <span aria-live="polite" className={`shrink-0 text-[11px] font-medium tabular-nums ${remaining <= 0 ? 'text-amber-800' : 'text-ink-400'}`}>
              {numberFormat(remaining, locale)}
            </span>
          )}
          {target && (
            <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-paper-deep px-2.5 py-1 text-[12px] font-medium text-ink-600 sm:inline">
              {target.label}{target.words > 0 && ` · ${numberFormat(target.words, locale)}w`}
            </span>
          )}
          {value && (
            <button type="button" tabIndex={open ? 0 : -1} aria-label={t('Hapus perintah', 'Clear instruction')} onClick={() => { setValue(''); input.current?.focus(); }}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-paper-deep hover:text-ink-800">
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <button type="button" tabIndex={open ? 0 : -1} disabled={!canSend} aria-label={t('Jalankan perintah', 'Run the instruction')} onClick={send}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors ${canSend ? `${raisedGreen} ${pressGreen}` : 'bg-paper-deep text-ink-300'} disabled:cursor-not-allowed`}>
            {busy ? <Loader2 size={17} aria-hidden="true" className="animate-spin" /> : <ArrowUp size={17} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
