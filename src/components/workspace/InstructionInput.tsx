'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, SlidersHorizontal } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { INSTRUCTION_COUNTER_AT, INSTRUCTION_LIMIT } from '@/lib/writing/instruction';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { LockedFeatureRow } from '@/components/app/PaidLock';

type Props = {
  busy: boolean;
  /** Locked on the free plan; the row then explains why instead of disappearing. */
  locked: boolean;
  /** Selection is longer than the plan allows, so a run would be refused anyway. */
  overLimit: boolean;
  onSubmit: (instruction: string) => void;
  onUpgrade: () => void;
  onCustomize: () => void;
};

const keep = (event: React.MouseEvent) => event.preventDefault();

// A single instruction about the selected passage. One line, hard-capped, and its own row under the quick actions.
export function InstructionInput({ busy, locked, overLimit, onSubmit, onUpgrade, onCustomize }: Props) {
  const { t, locale } = useLocale();
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // A new selection is a new question, so the draft never carries over.
  useEffect(() => () => setValue(''), []);

  const trimmed = value.trim();
  const remaining = INSTRUCTION_LIMIT - value.length;
  const showCounter = value.length >= INSTRUCTION_COUNTER_AT;
  const canSend = !busy && !overLimit && trimmed.length > 0;

  if (locked) {
    return (
      <LockedFeatureRow feature="freeform_prompt" onUpgrade={onUpgrade} className="border-t border-line px-2 py-1.5"
        label={t('Perintah AI bebas ada di paket berbayar.', 'Free-form AI instructions are on a paid plan.')} />
    );
  }

  function send() {
    if (!canSend) return;
    onSubmit(trimmed);
    setValue('');
  }

  return (
    <div className="border-t border-line px-1.5 pb-1.5 pt-1">
      <div className="flex items-center gap-1">
        <button type="button" aria-label={t('Sesuaikan di panel', 'Customize in the panel')} title={t('Sesuaikan di panel', 'Customize in the panel')} onMouseDown={keep} onClick={onCustomize}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 transition-colors hover:bg-paper-deep hover:text-ink-900">
          <SlidersHorizontal size={15} aria-hidden="true" />
        </button>
        <input
          ref={input}
          type="text"
          value={value}
          maxLength={INSTRUCTION_LIMIT}
          disabled={busy || overLimit}
          aria-label={t('Perintah untuk teks terpilih', 'Instruction for the selected text')}
          placeholder={overLimit ? t('Pilihan terlalu panjang untuk perintah.', 'The selection is too long for an instruction.') : t('Perintahkan AI untuk bagian ini…', 'Tell the AI what to do with this passage…')}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); send(); }
            if (event.key === 'Escape') { event.stopPropagation(); setValue(''); input.current?.blur(); }
          }}
          className="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed disabled:placeholder:text-ink-300"
        />
        {showCounter && (
          <span aria-live="polite" className={`shrink-0 text-[11px] font-medium tabular-nums ${remaining <= 0 ? 'text-amber-800' : 'text-ink-400'}`}>
            {numberFormat(remaining, locale)}
          </span>
        )}
        <button type="button" disabled={!canSend} aria-label={t('Jalankan perintah', 'Run the instruction')} onMouseDown={keep} onClick={send}
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${canSend ? `${raisedGreen} ${pressGreen}` : 'bg-paper-deep text-ink-300'} disabled:cursor-not-allowed`}>
          {busy ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <ArrowUp size={15} aria-hidden="true" />}
        </button>
      </div>
      {/* Says up front what the guards will refuse, instead of letting the run fail and explaining afterwards. */}
      <p className="px-1 pt-0.5 text-[11px] text-ink-400">{t('Istilah terkunci, sitasi, dan angka tetap dijaga.', 'Locked terms, citations, and numbers stay protected.')}</p>
    </div>
  );
}
