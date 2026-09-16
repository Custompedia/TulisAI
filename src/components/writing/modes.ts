import { Briefcase, Feather, GraduationCap, Lightbulb, Palette, PenLine, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { Mode, Settings } from '@/lib/writing/settings';

type T = (id: string, en: string) => string;

export const MODES: Array<Exclude<Mode, 'custom'>> = ['standard', 'academic', 'humanize', 'professional', 'creative', 'simplify'];

export const modeIcon: Record<Mode, LucideIcon> = {
  standard: PenLine, academic: GraduationCap, humanize: Feather, professional: Briefcase, creative: Palette, simplify: Lightbulb, custom: SlidersHorizontal,
};

export type ModeTone = 'green' | 'blue' | 'orange' | 'slate' | 'pink' | 'gold' | 'gray';
export const modeTone: Record<Mode, ModeTone> = {
  standard: 'green', academic: 'blue', humanize: 'pink', professional: 'slate', creative: 'orange', simplify: 'gold', custom: 'slate',
};
// Literal class names so Tailwind can generate the mode token utilities.
export const toneClass: Record<ModeTone, { ink: string; fill: string; edge: string; light: string; chip: string; chipActive: string }> = {
  green: { ink: 'text-mode-green-ink', fill: 'bg-mode-green-fill', edge: 'border-mode-green-edge', light: 'bg-mode-green-light', chip: 'border-mode-green-edge bg-mode-green-light text-mode-green-ink', chipActive: 'border-mode-green-ink bg-mode-green-fill text-mode-green-ink' },
  blue: { ink: 'text-mode-blue-ink', fill: 'bg-mode-blue-fill', edge: 'border-mode-blue-edge', light: 'bg-mode-blue-light', chip: 'border-mode-blue-edge bg-mode-blue-light text-mode-blue-ink', chipActive: 'border-mode-blue-ink bg-mode-blue-fill text-mode-blue-ink' },
  orange: { ink: 'text-mode-orange-ink', fill: 'bg-mode-orange-fill', edge: 'border-mode-orange-edge', light: 'bg-mode-orange-light', chip: 'border-mode-orange-edge bg-mode-orange-light text-mode-orange-ink', chipActive: 'border-mode-orange-ink bg-mode-orange-fill text-mode-orange-ink' },
  slate: { ink: 'text-mode-slate-ink', fill: 'bg-mode-slate-fill', edge: 'border-mode-slate-edge', light: 'bg-mode-slate-light', chip: 'border-mode-slate-edge bg-mode-slate-light text-mode-slate-ink', chipActive: 'border-mode-slate-ink bg-mode-slate-fill text-mode-slate-ink' },
  pink: { ink: 'text-mode-pink-ink', fill: 'bg-mode-pink-fill', edge: 'border-mode-pink-edge', light: 'bg-mode-pink-light', chip: 'border-mode-pink-edge bg-mode-pink-light text-mode-pink-ink', chipActive: 'border-mode-pink-ink bg-mode-pink-fill text-mode-pink-ink' },
  gold: { ink: 'text-mode-gold-ink', fill: 'bg-mode-gold-fill', edge: 'border-mode-gold-edge', light: 'bg-mode-gold-light', chip: 'border-mode-gold-edge bg-mode-gold-light text-mode-gold-ink', chipActive: 'border-mode-gold-ink bg-mode-gold-fill text-mode-gold-ink' },
  gray: { ink: 'text-mode-gray-ink', fill: 'bg-mode-gray-fill', edge: 'border-mode-gray-edge', light: 'bg-mode-gray-light', chip: 'border-mode-gray-edge bg-mode-gray-light text-mode-gray-ink', chipActive: 'border-mode-gray-ink bg-mode-gray-fill text-mode-gray-ink' },
};
export const modeToneClass = (mode: Mode) => toneClass[modeTone[mode]];

// Short chip labels used on the home composer.
export function modeChipLabel(mode: Mode, t: T) {
  return mode === 'standard' ? t('Parafrase', 'Paraphrase') : mode === 'custom' ? t('Lainnya', 'More') : modeLabel(mode, t);
}

export function modeLabel(mode: Mode, t: T) {
  return {
    standard: t('Standar', 'Standard'), academic: t('Akademik', 'Academic'), humanize: 'Humanize', professional: t('Profesional', 'Professional'),
    creative: t('Kreatif', 'Creative'), simplify: t('Sederhanakan', 'Simplify'), custom: t('Kustom', 'Custom'),
  }[mode];
}

export function modeHint(mode: Mode, t: T) {
  return {
    standard: t('Parafrase natural, makna tetap', 'Natural paraphrase, same meaning'),
    academic: t('Skripsi, jurnal, dan tugas', 'Thesis, journals, and coursework'),
    humanize: t('Lebih natural, tidak kaku', 'More natural, less formulaic'),
    professional: t('Email, laporan, proposal', 'Emails, reports, proposals'),
    creative: t('Lebih ekspresif dan hidup', 'More expressive and vivid'),
    simplify: t('Lebih mudah dipahami', 'Easier to understand'),
    custom: t('Hanya memakai pengaturan Sesuaikan', 'Uses your Customize settings only'),
  }[mode];
}

export function generateLabel(mode: Mode, t: T) {
  return mode === 'humanize' ? t('Buat Lebih Natural', 'Make It Natural') : t('Perbaiki Teks', 'Improve Text');
}

export const strengthOptions = (t: T) => [
  { value: 'light' as const, label: t('Ringan', 'Light') }, { value: 'balanced' as const, label: t('Seimbang', 'Balanced') }, { value: 'strong' as const, label: t('Kuat', 'Strong') },
];
export const academicOptions = (t: T) => [
  { value: 'thesis', label: t('Skripsi / Tesis', 'Thesis') }, { value: 'journal', label: t('Jurnal / Paper', 'Journal / Paper') }, { value: 'general_academic', label: t('Akademik umum', 'General academic') },
];
export const contextOptions = (t: T) => [
  { value: 'academic', label: t('Akademik', 'Academic') }, { value: 'professional', label: t('Profesional', 'Professional') }, { value: 'general', label: t('Umum', 'General') },
];
export const preservationOptions = (t: T) => [
  { value: 'conservative', label: t('Konservatif', 'Conservative') }, { value: 'balanced', label: t('Seimbang', 'Balanced') }, { value: 'flexible', label: t('Fleksibel', 'Flexible') },
];
export const documentTypeOptions = (t: T) => [
  { value: 'email', label: 'Email' }, { value: 'proposal', label: 'Proposal' }, { value: 'report', label: t('Laporan', 'Report') }, { value: 'presentation', label: t('Presentasi', 'Presentation') }, { value: 'other', label: t('Lainnya', 'Other') },
];
export const formatOptions = (t: T) => [
  { value: 'paragraph', label: t('Paragraf', 'Paragraph') }, { value: 'bullets', label: t('Poin-poin', 'Bullet points') }, { value: 'numbered_list', label: t('Daftar bernomor', 'Numbered list') }, { value: 'table', label: t('Tabel', 'Table') }, { value: 'short_summary', label: t('Ringkasan singkat', 'Short summary') },
];
export const lengthOptions = (t: T) => [
  { value: 'shorter', label: t('Lebih singkat', 'Shorter') }, { value: 'same', label: t('Sama', 'Same') }, { value: 'more_detailed', label: t('Lebih detail', 'More detailed') },
];
export const AUDIENCE_PRESETS = ['general_public', 'lecturer', 'professional', 'client'];
export const audienceOptions = (t: T) => [
  { value: 'general_public', label: t('Umum', 'General public') }, { value: 'lecturer', label: t('Dosen / penelaah', 'Lecturer / reviewer') }, { value: 'professional', label: t('Profesional', 'Professional') }, { value: 'client', label: t('Klien / pelanggan', 'Customer / client') }, { value: 'other', label: t('Lainnya…', 'Other…') },
];
export const focusOptions = (t: T) => [
  { value: 'clarity', label: t('Kejelasan', 'Clarity') }, { value: 'naturalness', label: t('Kenaturalan', 'Naturalness') }, { value: 'formality', label: t('Formalitas', 'Formality') }, { value: 'persuasiveness', label: t('Persuasif', 'Persuasiveness') }, { value: 'remove_repetition', label: t('Kurangi pengulangan', 'Remove repetition') },
];

const find = (options: Array<{ value: string; label: string }>, value: string) => options.find((option) => option.value === value)?.label ?? value;

// Plain-language line describing what will be requested.
export function requestSummary(settings: Settings, t: T): string {
  const parts: string[] = [modeLabel(settings.mode, t)];
  if (settings.mode === 'academic') parts.push(find(academicOptions(t), settings.academic));
  if (['standard', 'humanize', 'creative'].includes(settings.mode)) parts.push(`${t('kekuatan', 'strength')} ${find(strengthOptions(t), settings.strength).toLowerCase()}`);
  if (settings.mode === 'humanize') parts.push(`${t('konteks', 'context')} ${find(contextOptions(t), settings.context).toLowerCase()}`);
  if (settings.mode === 'professional') parts.push(find(documentTypeOptions(t), settings.documentType));
  if (settings.customized || settings.mode === 'custom') {
    if (settings.format !== 'paragraph') parts.push(find(formatOptions(t), settings.format).toLowerCase());
    parts.push(settings.length === 'same' ? t('panjang sama', 'same length') : find(lengthOptions(t), settings.length).toLowerCase());
    const audience = AUDIENCE_PRESETS.includes(settings.audience) ? find(audienceOptions(t), settings.audience) : settings.audience;
    if (audience) parts.push(`${t('untuk', 'for')} ${audience.toLowerCase()}`);
    if (settings.focus.length) parts.push(`${t('fokus', 'focus')} ${settings.focus.map((value) => find(focusOptions(t), value).toLowerCase()).join(', ')}`);
  }
  return parts.join(' · ');
}
