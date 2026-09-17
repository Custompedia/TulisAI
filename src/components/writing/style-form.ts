import type { NotebookColor } from '@/lib/notebook/appearance';
import { defaults, EXTRA_LIMIT, FOCUS_LIMIT, SAMPLE_LIMIT, type Settings } from '@/lib/writing/settings';
import { STYLE_DESCRIPTION_LIMIT, STYLE_NAME_LIMIT, type StyleInput, type WritingStyle } from '@/lib/writing/styles';

type T = (id: string, en: string) => string;
export type StyleDraft = { name: string; description: string; color: NotebookColor | null; icon: string | null; settings: Settings };

const CUSTOM_KEYS = ['format', 'length', 'audience', 'focus', 'extra'] as const;
// Everything hidden behind "Rincian lanjutan": mode-specific controls plus the output shape.
const ADVANCED_KEYS = ['strength', 'academic', 'context', 'preservation', 'recipient', 'simplifyFor', 'format', 'length', 'audience', 'focus'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// "Sesuaikan" counts as on as soon as one of its fields differs from the defaults.
export const hasCustomFields = (settings: Settings): boolean => CUSTOM_KEYS.some((key) => !same(settings[key], defaults[key]));

export const hasAdvancedValues = (settings: Settings): boolean => ADVANCED_KEYS.some((key) => !same(settings[key], defaults[key]));

export const styleDraft = (settings: Settings, style?: WritingStyle | null): StyleDraft => {
  const base = style?.settings ?? settings;
  return { name: style?.name ?? '', description: style?.description ?? '', color: style?.color ?? null, icon: style?.icon ?? null, settings: { ...base, extra: base.extra.slice(0, EXTRA_LIMIT), sample: base.sample.slice(0, SAMPLE_LIMIT) } };
};

// The stored snapshot never carries a language or an active-style marker.
export function stylePayload(draft: StyleDraft): StyleInput {
  const settings = draft.settings;
  return {
    name: draft.name.trim().slice(0, STYLE_NAME_LIMIT), description: draft.description.trim().slice(0, STYLE_DESCRIPTION_LIMIT) || null, color: draft.color, icon: draft.icon,
    settings: { ...settings, focus: settings.focus.slice(0, FOCUS_LIMIT), extra: settings.extra.trim().slice(0, EXTRA_LIMIT), sample: settings.sample.trim().slice(0, SAMPLE_LIMIT), customized: hasCustomFields(settings), language: 'auto', styleId: null },
  };
}

// SQLite's COLLATE NOCASE folds ASCII only, so the client check accepts exactly what the unique index accepts.
export const foldName = (value: string) => value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
export const nameTaken = (name: string, styles: WritingStyle[], exceptId?: string) =>
  styles.some((style) => style.id !== exceptId && foldName(style.name) === foldName(name));

// Appends an example chip on its own line, without going past the note limit or repeating itself.
export function appendInstruction(current: string, chip: string, limit = EXTRA_LIMIT): string {
  if (current.toLowerCase().includes(chip.toLowerCase())) return current;
  const base = current.trimEnd();
  const next = base ? `${base}\n${chip}` : chip;
  return next.length > limit ? current : next;
}

// "Nama (2)", "Nama (3)"… so a duplicate never collides with an existing name.
export function copyName(name: string, styles: WritingStyle[]): string {
  const base = name.trim().replace(/\s\(\d+\)$/, '').trim();
  for (let index = 2; index < 100; index++) {
    const suffix = ` (${index})`;
    const candidate = `${base.slice(0, STYLE_NAME_LIMIT - suffix.length).trim()}${suffix}`;
    if (!nameTaken(candidate, styles)) return candidate;
  }
  return base.slice(0, STYLE_NAME_LIMIT);
}

// Ready-made starting points; each opens the form prefilled so the user reviews before saving.
export const styleTemplates = (t: T): StyleDraft[] => [
  {
    name: t('Email profesional', 'Professional email'), description: t('Ubah draf kasar jadi email lengkap dengan salam dan penutup', 'Turn a rough draft into a full email with greeting and sign-off'), color: 'blue', icon: 'icon:Mail',
    settings: { ...defaults, mode: 'professional', recipient: 'umum', format: 'email', customized: true, extra: [t('Pakai sapaan "Anda"', 'Address the reader as "you"'), t('Pakai kalimat pendek', 'Use short sentences'), t('Kalau nama penerima tidak ada di teks, pakai sapaan netral', 'Use a neutral greeting when the text names no recipient')].join('\n') },
  },
];

// Affirmative phrasing: models follow "do X" more reliably than "do not Y". Rules the base prompt already guarantees are not offered.
export const instructionChips = (t: T): string[] => [
  t('Pakai kalimat pendek', 'Use short sentences'),
  t('Pakai kalimat aktif', 'Use active sentences'),
  t('Pertahankan istilah teknis apa adanya', 'Keep technical terms exactly as written'),
  t('Ganti "sangat" dengan kata yang lebih spesifik', 'Replace "very" with a more specific word'),
  t('Pakai sapaan "Anda"', 'Address the reader as "you"'),
  t('Satu gagasan per paragraf', 'One idea per paragraph'),
];
export const SAMPLE_MIN_WORDS = 50;
export const SAMPLE_GOOD_WORDS = 150;
export const countWords = (text: string): number => (text.trim().match(/[\p{L}\p{N}]+(?:[-'’.][\p{L}\p{N}]+)*/gu) ?? []).length;
