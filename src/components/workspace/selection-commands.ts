import { defaults, INLINE_LIMIT, type Settings } from '@/lib/writing/settings';
import type { PlanLimits } from '@/lib/plans';
import { sanitizeInstruction } from '@/lib/writing/instruction';
import { applyStyle, type WritingStyle } from '@/lib/writing/styles';
import type { InlineAction, SelectionRange } from './types';

export type SelectionCommand = InlineAction | 'humanize' | 'academic' | 'lock' | 'unlock' | 'customize';
type T = (id: string, en: string) => string;
type Format = (value: number) => string;

export type SelectionPlan =
  | { kind: 'lock' } | { kind: 'unlock' } | { kind: 'customize' }
  | { kind: 'error'; label: string; message: string }
  | { kind: 'generate'; label: string; inlineAction?: InlineAction; override?: Settings; instruction?: string };

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
export function planStyleCommand(style: WritingStyle, selection: SelectionRange, base: Settings, t: T, format: Format, limits: PlanLimits): SelectionPlan {
  const length = selection.text.length;
  if (length > limits.runLimit) return tooLong(style.name, length, limits.runLimit, t, format);
  return { kind: 'generate', label: style.name, override: applyStyle(base, style) };
}

// A toolbar action is a plain run: the applied skill's sample, note and output shape never ride along.
const plain = (base: Settings, patch: Partial<Settings>): Settings => ({ ...base, styleId: null, sample: '', extra: '', focus: [], format: defaults.format, length: defaults.length, customized: false, ...patch });

// Humanize keeps the register of the mode the user is already writing in.
const humanizeContext = (base: Settings) => (base.mode === 'academic' ? 'academic' : base.mode === 'professional' ? 'professional' : base.context);

// A typed instruction runs as a custom transform on the selected passage, with nothing the toolbar or a
// saved skill would otherwise bring along, so the only extra input is the sentence the writer typed.
export function planInstruction(instruction: string, selection: SelectionRange, base: Settings, t: T, format: Format, limits: PlanLimits): SelectionPlan {
  const label = t('Perintah', 'Instruction');
  const text = sanitizeInstruction(instruction);
  if (!text) return { kind: 'error', label, message: t('Tulis dulu perintahnya.', 'Type an instruction first.') };
  const length = selection.text.length;
  if (length > limits.runLimit) return tooLong(label, length, limits.runLimit, t, format);
  if (selection.text.includes('\n')) return { kind: 'error', label, message: t('Perintah bebas bekerja pada satu paragraf. Pilih bagian yang lebih kecil.', 'A free-form instruction works on one paragraph. Select a smaller part.') };
  return { kind: 'generate', label, instruction: text, override: plain(base, { customized: true }) };
}

// Turns a bubble-menu command into what the workspace should do; pure so it can be tested.
export function planSelectionCommand(command: SelectionCommand, selection: SelectionRange, base: Settings, t: T, format: Format, limits: PlanLimits): SelectionPlan {
  if (command === 'lock' || command === 'unlock' || command === 'customize') return { kind: command };
  const length = selection.text.length; const multiline = selection.text.includes('\n');
  const label = commandLabel(command, t);
  const over = (limit: number) => tooLong(label, length, limit, t, format);
  if (command === 'humanize') return length > limits.runLimit ? over(limits.runLimit) : { kind: 'generate', label, override: plain(base, { mode: 'humanize', context: humanizeContext(base) }) };
  if (command === 'academic') return length > limits.runLimit ? over(limits.runLimit) : { kind: 'generate', label, override: plain(base, { mode: 'academic' }) };
  if (length > INLINE_LIMIT) return over(INLINE_LIMIT);
  if (!multiline) return { kind: 'generate', label, inlineAction: command };
  if (command === 'alternatives') return { kind: 'error', label, message: t('Alternatif hanya untuk kata, frasa, atau satu kalimat. Pilih bagian yang lebih kecil.', 'Alternatives work on a word, phrase, or single sentence. Select a smaller part.') };
  const override: Record<Exclude<InlineAction, 'alternatives'>, Settings> = {
    clearer: plain(base, { mode: 'simplify' }), shorter: plain(base, { mode: 'standard', customized: true, length: 'shorter' }),
    formal: plain(base, { mode: 'professional' }), natural: plain(base, { mode: 'humanize', context: humanizeContext(base) }),
  };
  return { kind: 'generate', label, override: override[command] };
}
