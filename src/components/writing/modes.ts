import { Briefcase, Feather, GraduationCap, Lightbulb, Palette, PenLine, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { Mode, Settings } from '@/lib/writing/settings';

type T = (id: string, en: string) => string;

export const MODES: Array<Exclude<Mode, 'custom'>> = ['standard', 'academic', 'humanize', 'professional', 'creative', 'simplify'];

export const modeIcon: Record<Mode, LucideIcon> = {
  standard: PenLine, academic: GraduationCap, humanize: Feather, professional: Briefcase, creative: Palette, simplify: Lightbulb, custom: SlidersHorizontal,
};

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
