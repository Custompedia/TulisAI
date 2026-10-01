'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowUp, Languages, List, ListOrdered, Loader2, Maximize2, PencilSparkles, Square, StepForward, X, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { INSTRUCTION_COUNTER_AT, INSTRUCTION_LIMIT } from '@/lib/writing/instruction';
import { FREEFORM_RESERVE_FACTOR } from '@/lib/plans';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { PaidLock, useRequiredTierName } from '@/components/app/PaidLock';

type Props = {
  busy: boolean;
  locked: boolean;
  /** What the instruction will act on, resolved by the workspace: the selection, or the paragraph at the caret. */
  target: { label: string; words: number; chars?: number } | null;
  onSubmit: (instruction: string) => void;
  onUpgrade: () => void;
  /** Lets the workspace keep the target highlighted while focus sits in the field. */
  onOpenChange?: (open: boolean) => void;
  /** An instruction from this dock is being processed; the dock shows progress and a stop button. */
  running?: boolean;
  onStop?: () => void;
};

// Ready-made instructions. Every Perintah AI run holds FREEFORM_RESERVE_FACTOR x the target before the provider is
// called and is charged MAX(source, output) up to that hold, so the chips that lengthen the text (grows) are safe:
// a short balance is refused before the call, never after it. None of them may invent figures or citations.
export const DOCK_CHIPS = [
  { id: 'bullets', grows: false, label: ['Jadikan poin', 'Make bullets'], instruction: ['Jadikan daftar poin tanpa menambah isi baru.', 'Turn this into a bulleted list without adding anything new.'] },
  { id: 'english', grows: false, label: ['Terjemahkan ke English', 'Translate to English'], instruction: ['Terjemahkan ke bahasa Inggris.', 'Translate this into English.'] },
  { id: 'expand', grows: true, label: ['Kembangkan', 'Expand'], instruction: ['Kembangkan teks ini dengan penjelasan yang lebih lengkap, paling banyak dua kali panjangnya. Jangan menambah angka, data, nama, atau sitasi baru.', 'Expand this text with a fuller explanation, at most twice its length. Do not add new figures, data, names or citations.'] },
  { id: 'continue', grows: true, label: ['Lanjutkan', 'Continue'], instruction: ['Pertahankan teks ini persis apa adanya, lalu lanjutkan dengan satu paragraf baru yang meneruskan alurnya, tidak lebih panjang dari teks aslinya. Jangan menambah angka, data, nama, atau sitasi baru.', 'Keep this text exactly as it is, then continue it with one new paragraph that follows its flow, no longer than the original. Do not add new figures, data, names or citations.'] },
  { id: 'hooks', grows: true, label: ['3 versi hook', '3 hook versions'], instruction: ['Tulis 3 versi hook pembuka yang berbeda untuk teks ini sebagai daftar bernomor, masing-masing satu kalimat. Jangan menambah angka atau data baru.', 'Write 3 different opening hooks for this text as a numbered list, one sentence each. Do not add new figures or data.'] },
] as const;
export type DockChip = (typeof DOCK_CHIPS)[number];
const CHIP_ICONS: Record<DockChip['id'], LucideIcon> = { bullets: List, english: Languages, expand: Maximize2, continue: StepForward, hooks: ListOrdered };

// The honest price line: every instruction may cost up to the reserve factor times the target, never more.
export function dockCostText(chars: number | undefined, t: (id: string, en: string) => string, format: (value: number) => string): string {
  const most = chars && chars > 0 ? chars * FREEFORM_RESERVE_FACTOR : null;
  return most === null
    ? t(`Biaya: hingga ${FREEFORM_RESERVE_FACTOR}× panjang teks terpilih`, `Cost: up to ${FREEFORM_RESERVE_FACTOR}× the selected text`)
    : t(`Biaya: hingga ${FREEFORM_RESERVE_FACTOR}× panjang teks terpilih (maks. ${format(most)} karakter)`, `Cost: up to ${FREEFORM_RESERVE_FACTOR}× the selected text (at most ${format(most)} characters)`);
}

// A small rounded tab under the canvas that grows into the instruction field on hover or Ctrl+/; it shrinks back
// on leave only while empty. Below Max it stays visible as "Perintah AI · Max" and explains itself.
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
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key !== '/') return;
    event.preventDefault();
    if (locked) onUpgrade(); else setOpen(true);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
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
        style={{ width: expanded ? 'min(760px, 100%)' : locked ? 'auto' : 76 }}
        className={`pointer-events-auto relative flex flex-col overflow-hidden border transition-[width,height,background-color,box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none ${
          expanded ? 'rounded-3xl border-line bg-white shadow-[0_2px_6px_rgb(31_32_29/0.08),0_16px_36px_-18px_rgb(31_32_29/0.45)]' : locked ? 'h-8 rounded-full border-line bg-white hover:bg-paper' : 'h-8 rounded-full border-brand-100 bg-brand-50 hover:bg-brand-100'
        }`}
      >
        {/* Stays mounted while open so keyboard focus hands over to the field instead of being dropped. */}
        <button type="button" tabIndex={expanded ? -1 : 0} aria-hidden={expanded} onClick={() => (locked ? onUpgrade() : expand())}
          aria-label={locked ? t(`Perintah AI — buka dengan ${tier}`, `AI instruction — unlock with ${tier}`) : t('Perintah AI', 'AI instruction')}
          title={locked ? t(`Perintah AI — buka dengan ${tier}`, `AI instructions — unlock with ${tier}`) : t('Perintahkan AI untuk bagian yang sedang kamu tulis', 'Tell the AI what to do with the passage you are on')}
          className={`${locked && !expanded ? 'relative flex h-full items-center gap-1.5 px-3.5 text-[12.5px] font-semibold text-ink-500' : `absolute inset-0 grid place-items-center ${locked ? 'text-ink-400' : 'text-brand-700'}`} transition-opacity duration-100 ${expanded ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
          {locked ? <><PaidLock size={14} /><span>{t(`Perintah AI · ${tier}`, `AI instruction · ${tier}`)}</span></> : <PencilSparkles size={17} aria-hidden="true" />}
        </button>
        {running && (
          <div role="status" className="flex h-14 min-w-0 flex-1 items-center gap-3 pl-3.5 pr-2.5 animate-fade-up">
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
        <div aria-hidden={!open || running} className={`${running || !open ? 'hidden' : 'flex'} h-14 min-w-0 shrink-0 items-center gap-1.5 pl-5 pr-2.5 transition-opacity duration-150 motion-reduce:transition-none ${open ? 'opacity-100 delay-75' : 'pointer-events-none opacity-0'}`}>
          <PencilSparkles size={19} aria-hidden="true" className="shrink-0 text-brand-700" />
          <input
            ref={input}
            type="text"
            value={value}
            tabIndex={open ? 0 : -1}
            maxLength={INSTRUCTION_LIMIT}
            disabled={busy || !target || !open}
            aria-label={t('Perintah untuk AI', 'Instruction for the AI')}
            placeholder={busy ? t('AI sedang mengerjakan…', 'The AI is working…') : target ? t('Jelaskan perubahan yang kamu inginkan…', 'Describe the change you want…') : t('Letakkan kursor di paragraf atau blok teks dulu.', 'Put the cursor in a paragraph or select text first.')}
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
              {target.label}{target.words > 0 && ` · ${numberFormat(target.words, locale)} ${t('kata', 'words')}`}
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
        {open && !running && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-4 pb-2.5 pt-2">
            {DOCK_CHIPS.map((chip) => {
              const Icon = CHIP_ICONS[chip.id];
              return (
                <button key={chip.id} type="button" disabled={busy || locked || !target} onClick={() => { onSubmit(t(chip.instruction[0], chip.instruction[1])); setValue(''); collapse(); }}
                  title={chip.grows ? t(`Menambah panjang teks; biaya hingga ${FREEFORM_RESERVE_FACTOR}× panjang teks terpilih`, `Makes the text longer; costs up to ${FREEFORM_RESERVE_FACTOR}× the selected text`) : undefined}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-white px-2.5 text-[12px] font-medium text-ink-700 transition-colors hover:border-line-strong hover:bg-paper disabled:opacity-40">
                  <Icon size={13} aria-hidden="true" />{t(chip.label[0], chip.label[1])}
                </button>
              );
            })}
            <span className="min-w-0 flex-1 text-right text-[11px] leading-snug text-ink-500">
              {dockCostText(target?.chars, t, (value) => numberFormat(value, locale))} · {t('Angka dan sitasi bisa berubah', 'Numbers and citations may change')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
