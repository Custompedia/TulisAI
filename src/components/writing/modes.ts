import { Briefcase, Feather, GraduationCap, Lightbulb, Palette, PenLine, type LucideIcon } from 'lucide-react';
import type { Mode, Settings } from '@/lib/writing/settings';

type T = (id: string, en: string) => string;
export type Option<V extends string = string> = { value: V; label: string; short?: string; hint?: string; disabled?: boolean };

export const MODES: Mode[] = ['humanize', 'standard', 'academic', 'professional', 'creative', 'simplify'];

export const modeIcon: Record<Mode, LucideIcon> = {
  standard: PenLine, academic: GraduationCap, humanize: Feather, professional: Briefcase, creative: Palette, simplify: Lightbulb,
};

export type ModeTone = 'green' | 'blue' | 'orange' | 'slate' | 'pink' | 'gold' | 'gray';
export const modeTone: Record<Mode, ModeTone> = {
  standard: 'green', academic: 'blue', humanize: 'pink', professional: 'slate', creative: 'orange', simplify: 'gold',
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

export function modeLabel(mode: Mode, t: T) {
  return {
    standard: t('Parafrase', 'Paraphrase'), academic: t('Akademik', 'Academic'), humanize: 'Humanize', professional: t('Profesional', 'Professional'),
    creative: t('Kreatif', 'Creative'), simplify: t('Sederhanakan', 'Simplify'),
  }[mode];
}

export function modeHint(mode: Mode, t: T) {
  return {
    standard: t('Kata dan susunan baru, makna tetap', 'New wording and structure, same meaning'),
    academic: t('Skripsi, jurnal, dan tugas', 'Thesis, journals, and coursework'),
    humanize: t('Ubah teks yang terasa AI jadi natural', 'Make AI-sounding text read naturally'),
    professional: t('Email, laporan, proposal', 'Emails, reports, proposals'),
    creative: t('Lebih hidup tanpa mengubah fakta', 'More vivid without changing facts'),
    simplify: t('Lebih mudah dipahami, tanpa informasi hilang', 'Easier to understand, nothing removed'),
  }[mode];
}

export function generateLabel(mode: Mode, t: T) {
  return {
    standard: t('Parafrasekan Teks', 'Paraphrase Text'), academic: t('Rapikan Akademik', 'Polish Academically'), humanize: t('Buat Lebih Natural', 'Make It Natural'),
    professional: t('Buat Profesional', 'Make It Professional'), creative: t('Buat Lebih Hidup', 'Make It Vivid'), simplify: t('Sederhanakan Teks', 'Simplify Text'),
  }[mode];
}

export const languageOptions = (t: T): Array<Option<'auto' | 'id' | 'en'>> => [
  { value: 'auto', label: 'Auto', hint: t('Dideteksi dari teks', 'Detected from the text') },
  { value: 'id', label: 'Indonesia', hint: t('Bahasa Indonesia sesuai EYD V', 'Indonesian, following EYD V') },
  { value: 'en', label: 'English', hint: t('Bahasa Inggris, tanpa terjemahan', 'English, never translated') },
];
export const strengthOptions = (t: T): Array<Option<'light' | 'balanced' | 'strong'>> => [
  { value: 'light', label: t('Ringan', 'Light'), hint: t('Ganti kata saja, susunan kalimat tetap', 'Swap words only, sentence structure stays') },
  { value: 'balanced', label: t('Seimbang', 'Balanced'), hint: t('Boleh ubah aktif/pasif dan urutan klausa', 'May switch active/passive and clause order') },
  { value: 'strong', label: t('Kuat', 'Strong'), hint: t('Boleh pecah/gabung kalimat, urutan ide tetap', 'May split or merge sentences, idea order stays') },
];
export const humanizeStrengthOptions = (t: T): Array<Option<'light' | 'balanced' | 'strong'>> => [
  { value: 'light', label: t('Ringan', 'Light'), hint: t('Hapus frasa lebay, ekor kalimat, dan basa-basi', 'Removes inflated phrases, empty tails, and filler') },
  { value: 'balanced', label: t('Seimbang', 'Balanced'), hint: t('Hapus semua pola tulisan mesin', 'Removes every machine-writing pattern') },
  { value: 'strong', label: t('Kuat', 'Strong'), hint: t('Semua pola, kalimat boleh dirombak', 'Every pattern; sentences may be rebuilt') },
];
export const creativityOptions = (t: T): Array<Option<'light' | 'balanced' | 'strong'>> => [
  { value: 'light', label: t('Ringan', 'Light'), hint: t('Ritme dan kata kerja lebih hidup', 'Livelier rhythm and sharper verbs') },
  { value: 'balanced', label: t('Sedang', 'Medium'), hint: t('Pembuka dan penutup ditulis ulang', 'Opening and closing lines rewritten') },
  { value: 'strong', label: t('Berani', 'Bold'), hint: t('Urutan ide boleh berubah, kiasan dari isi teks', 'Idea order may change, imagery from the text itself') },
];
export const academicOptions = (t: T): Option[] => [
  { value: 'thesis', label: t('Skripsi / Tesis', 'Thesis'), short: t('Skripsi', 'Thesis'), hint: t('Formal, jelas, tidak berbunga-bunga', 'Formal, explicit, never ornate') },
  { value: 'journal', label: t('Jurnal / Paper', 'Journal / Paper'), short: t('Jurnal', 'Journal'), hint: t('Ringkas, klaim tidak melebihi bukti', 'Concise, claims no stronger than the evidence') },
  { value: 'general_academic', label: t('Umum', 'General'), hint: t('Tugas, laporan, register akademik netral', 'Coursework, reports, neutral academic register') },
];
export const contextOptions = (t: T): Option[] => [
  { value: 'academic', label: t('Akademik', 'Academic'), hint: t('Tetap akademik, tidak pernah jadi santai', 'Stays academic, never becomes casual') },
  { value: 'professional', label: t('Profesional', 'Professional'), hint: t('Tetap di register kerja', 'Stays in a workplace register') },
  { value: 'general', label: t('Umum', 'General'), hint: t('Register sehari-hari yang netral', 'Neutral everyday register') },
];
export const preservationOptions = (t: T): Option[] => [
  { value: 'conservative', label: t('Sedikit (≤15%)', 'Small (≤15%)'), short: '≤15%', hint: t('Maksimal 15% kata berubah', 'Up to 15% of words change') },
  { value: 'balanced', label: t('Sedang (≤30%)', 'Medium (≤30%)'), short: '≤30%', hint: t('Maksimal 30% kata berubah', 'Up to 30% of words change') },
  { value: 'flexible', label: t('Bebas (≤50%)', 'Free (≤50%)'), short: '≤50%', hint: t('Maksimal 50% kata berubah', 'Up to 50% of words change') },
];
export const recipientOptions = (t: T): Array<Option<Settings['recipient']>> => [
  { value: 'atasan', label: t('Atasan', 'Manager'), hint: t('Atasan atau pengambil keputusan senior', 'Your manager or a senior decision-maker') },
  { value: 'klien', label: t('Klien', 'Client'), hint: t('Klien dari luar organisasi', 'An external client') },
  { value: 'rekan', label: t('Rekan kerja', 'Colleague'), hint: t('Rekan atau kolega setingkat', 'A peer or colleague') },
  { value: 'vendor', label: 'Vendor', hint: t('Pemasok atau kontraktor', 'A supplier or contractor') },
  { value: 'umum', label: t('Umum', 'General reader'), short: t('Umum', 'General'), hint: t('Pembaca bisnis secara umum', 'A general business reader') },
];
export const simplifyForOptions = (t: T): Array<Option<Settings['simplifyFor']>> => [
  { value: 'anak_sekolah', label: t('Anak sekolah', 'School-age reader'), short: t('Anak sekolah', 'School-age'), hint: t('Pembaca usia sekolah', 'A school-age reader') },
  { value: 'umum', label: t('Orang awam', 'General adult'), short: t('Orang awam', 'General'), hint: t('Orang dewasa tanpa latar belakang topik ini', 'An adult with no background in the subject') },
  { value: 'klien', label: t('Klien', 'Client'), hint: t('Paham bisnisnya, bukan detail teknisnya', 'Knows the business, not the technical detail') },
  { value: 'pemula', label: t('Pemula', 'Beginner'), hint: t('Baru mengenal bidang ini', 'New to this field') },
];
export const formatOptions = (t: T): Option[] => [
  { value: 'paragraph', label: t('Paragraf', 'Paragraph'), hint: t('Bawaan, bentuk paragraf tetap', 'Default, paragraphs stay as they are') },
  { value: 'bullets', label: t('Poin-poin', 'Bullet points'), hint: t('Poin jika isinya memang daftar, argumen tetap prosa', 'Bullets where content is a list; argument stays prose') },
  { value: 'numbered_list', label: t('Daftar bernomor', 'Numbered list'), hint: t('Bernomor hanya jika ada urutan nyata', 'Numbered only where there is a real sequence') },
  { value: 'table', label: t('Tabel', 'Table'), hint: t('Kolom dari pembeda yang sudah ada di teks', 'Columns from distinctions already in the text') },
  { value: 'short_summary', label: t('Ringkasan', 'Summary'), hint: t('Sekitar 40% panjang, semua klaim tetap', 'About 40% of the length, every claim kept') },
];
export const lengthOptions = (t: T): Option[] => [
  { value: 'shorter', label: t('Lebih singkat', 'Shorter'), hint: t('Sekitar 60–75% panjang, tanpa klaim hilang', 'About 60–75% of the length, no claim dropped') },
  { value: 'same', label: t('Sama', 'Same'), hint: t('Selisih panjang maksimal 10%', 'Within 10% of the length') },
  { value: 'more_detailed', label: t('Lebih detail', 'More detailed'), hint: t('Sekitar 130–150%, hanya memperluas yang ada', 'About 130–150%, expanding only what is there') },
];
export const audienceOptions = (t: T): Array<Option<Settings['audience']>> => [
  { value: 'general_public', label: t('Umum', 'General reader'), hint: t('Pembaca umum', 'A general reader') },
  { value: 'lecturer', label: t('Dosen / penelaah', 'Lecturer / reviewer'), hint: t('Dosen pembimbing atau penelaah jurnal', 'A thesis supervisor or journal reviewer') },
  { value: 'professional', label: t('Rekan profesional', 'Professional colleague'), hint: t('Kolega di bidang profesional', 'A professional colleague') },
  { value: 'client', label: t('Klien', 'Client'), hint: t('Klien yang bukan spesialis', 'A client who is not a specialist') },
];
export const focusOptions = (t: T): Option[] => [
  { value: 'clarity', label: t('Kejelasan', 'Clarity'), hint: t('Maksud tertangkap sekali baca', 'The point lands on one reading') },
  { value: 'naturalness', label: t('Kenaturalan', 'Naturalness'), hint: t('Tidak kaku dan tidak bertele-tele', 'Not stiff or padded') },
  { value: 'formality', label: t('Formalitas', 'Formality'), hint: t('Register lebih formal', 'A more formal register') },
  { value: 'persuasiveness', label: t('Persuasif', 'Persuasiveness'), hint: t('Lebih meyakinkan tanpa klaim baru', 'More convincing, no new claims') },
  { value: 'remove_repetition', label: t('Kurangi pengulangan', 'Remove repetition'), hint: t('Buang kata dan ide yang berulang', 'Cut repeated words and ideas') },
];

const find = (options: Option[], value: string) => options.find((option) => option.value === value)?.label ?? value;

// Plain-language line describing what will be requested.
export function requestSummary(settings: Settings, t: T): string {
  const parts: string[] = [modeLabel(settings.mode, t)];
  const lower = (options: Option[], value: string) => find(options, value).toLowerCase();
  if (settings.mode === 'standard') parts.push(`${t('kekuatan', 'strength')} ${lower(strengthOptions(t), settings.strength)}`);
  if (settings.mode === 'academic') parts.push(find(academicOptions(t), settings.academic));
  if (settings.mode === 'humanize') parts.push(`${t('kekuatan', 'strength')} ${lower(humanizeStrengthOptions(t), settings.strength)}`, `${t('register', 'register')} ${lower(contextOptions(t), settings.context)}`, `${t('batas perubahan', 'change limit')} ${lower(preservationOptions(t), settings.preservation)}`);
  if (settings.mode === 'professional') parts.push(`${t('untuk', 'to')} ${lower(recipientOptions(t), settings.recipient)}`);
  if (settings.mode === 'creative') parts.push(`${t('kreativitas', 'creativity')} ${lower(creativityOptions(t), settings.strength)}`);
  if (settings.mode === 'simplify') parts.push(`${t('untuk', 'for')} ${lower(simplifyForOptions(t), settings.simplifyFor)}`);
  if (settings.customized) {
    if (settings.format !== 'paragraph') parts.push(lower(formatOptions(t), settings.format));
    parts.push(settings.length === 'same' ? t('panjang sama', 'same length') : lower(lengthOptions(t), settings.length));
    parts.push(`${t('pembaca', 'reader')} ${lower(audienceOptions(t), settings.audience)}`);
    if (settings.focus.length) parts.push(`${t('penekanan', 'emphasis')} ${settings.focus.map((value) => lower(focusOptions(t), value)).join(', ')}`);
    if (settings.extra.trim()) parts.push(t('dengan catatan', 'with a note'));
  }
  return parts.join(' · ');
}
