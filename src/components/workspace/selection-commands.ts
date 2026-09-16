import { INLINE_LIMIT, SELECTION_LIMIT, type Settings } from '@/lib/writing/settings';
import { applyStyle, type WritingStyle } from '@/lib/writing/styles';
import type { InlineAction, SelectionRange } from './types';

export type SelectionCommand = InlineAction | 'humanize' | 'academic' | 'lock' | 'unlock' | 'customize';
type T = (id: string, en: string) => string;
type Format = (value: number) => string;

export type SelectionPlan =
  | { kind: 'lock' } | { kind: 'unlock' } | { kind: 'customize' }
  | { kind: 'error'; label: string; message: string }
  | { kind: 'generate'; label: string; inlineAction?: InlineAction; override?: Settings };

const GENERATE: ReadonlySet<SelectionCommand> = new Set(['alternatives', 'shorter', 'clearer', 'formal', 'natural', 'humanize', 'academic']);
export const isGenerateCommand = (command: SelectionCommand) => GENERATE.has(command);

export function commandLabel(command: SelectionCommand, t: T): string {
  return {
    alternatives: t('Alternatif', 'Alternatives'), shorter: t('Lebih singkat', 'Shorter'), clearer: t('Lebih jelas', 'Clearer'), formal: t('Lebih formal', 'More formal'),
    natural: t('Lebih natural', 'More natural'), humanize: 'Humanize', academic: t('Akademik', 'Academic'), lock: t('Kunci istilah', 'Lock term'),
    unlock: t('Buka kunci istilah', 'Unlock term'), customize: t('Sesuaikan di panel…', 'Customize in panel…'),
  }[command];
}

const tooLong = (label: string, length: number, limit: number, t: T, format: Format): SelectionPlan =>
  ({ kind: 'error', label, message: t(`${format(length)}/${format(limit)} karakter — persingkat pilihan.`, `${format(length)}/${format(limit)} characters — shorten the selection.`) });

// A saved style runs inline with its whole settings snapshot as the override.
export function planStyleCommand(style: WritingStyle, selection: SelectionRange, base: Settings, t: T, format: Format): SelectionPlan {
  const length = selection.text.length;
  if (length > SELECTION_LIMIT) return tooLong(style.name, length, SELECTION_LIMIT, t, format);
  return { kind: 'generate', label: style.name, override: applyStyle(base, style) };
}

// Humanize keeps the register of the mode the user is already writing in.
const humanizeContext = (base: Settings) => (base.mode === 'academic' ? 'academic' : base.mode === 'professional' ? 'professional' : base.context);

// Turns a bubble-menu command into what the workspace should do; pure so it can be tested.
export function planSelectionCommand(command: SelectionCommand, selection: SelectionRange, base: Settings, t: T, format: Format): SelectionPlan {
  if (command === 'lock' || command === 'unlock' || command === 'customize') return { kind: command };
  const length = selection.text.length; const multiline = selection.text.includes('\n');
  const label = commandLabel(command, t);
  const over = (limit: number) => tooLong(label, length, limit, t, format);
  if (command === 'humanize') return length > SELECTION_LIMIT ? over(SELECTION_LIMIT) : { kind: 'generate', label, override: { ...base, mode: 'humanize', context: humanizeContext(base) } };
  if (command === 'academic') return length > SELECTION_LIMIT ? over(SELECTION_LIMIT) : { kind: 'generate', label, override: { ...base, mode: 'academic' } };
  if (length > INLINE_LIMIT) return over(INLINE_LIMIT);
  if (!multiline) return { kind: 'generate', label, inlineAction: command };
  if (command === 'alternatives') return { kind: 'error', label, message: t('Alternatif hanya untuk kata, frasa, atau satu kalimat. Pilih bagian yang lebih kecil.', 'Alternatives work on a word, phrase, or single sentence. Select a smaller part.') };
  const override: Record<Exclude<InlineAction, 'alternatives'>, Settings> = {
    clearer: { ...base, mode: 'simplify' }, shorter: { ...base, mode: 'standard', customized: true, length: 'shorter' },
    formal: { ...base, mode: 'professional' }, natural: { ...base, mode: 'humanize', context: humanizeContext(base) },
  };
  return { kind: 'generate', label, override: override[command] };
}
