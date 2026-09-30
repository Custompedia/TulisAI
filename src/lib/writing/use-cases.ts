import { promptFor } from './settings';

type T = (id: string, en: string) => string;

// What an account mostly writes, chosen in onboarding and in Preferensi menulis. The first three are the original
// values and stay valid; content, article and paraphrase are the finer choices added in UX 2. The stored column has
// no constraint, so older rows keep working and an unknown value reads as "general".
export const USE_CASES = ['academic', 'professional', 'general', 'content', 'article', 'paraphrase'] as const;
export type UseCase = (typeof USE_CASES)[number];
export const isUseCase = (value: unknown): value is UseCase => typeof value === 'string' && (USE_CASES as readonly string[]).includes(value);
export const asUseCase = (value: unknown): UseCase => (isUseCase(value) ? value : 'general');

// The mode a new account starts in, as the prompt id the settings API stores.
const MODE_FOR: Record<UseCase, string> = {
  academic: promptFor.academic, professional: promptFor.professional, general: promptFor.humanize,
  content: promptFor.creative, article: promptFor.standard, paraphrase: promptFor.standard,
};
export const defaultModeFor = (useCase: unknown): string => MODE_FOR[asUseCase(useCase)];

// Humanize keeps its three registers; the finer use cases write for a general reader.
export const humanizerContextFor = (useCase: unknown): 'academic' | 'professional' | 'general' => {
  const value = asUseCase(useCase);
  return value === 'academic' || value === 'professional' ? value : 'general';
};

export function primaryUseLabel(useCase: UseCase, t: T): string {
  return {
    academic: t('Akademik', 'Academic'), professional: t('Profesional', 'Professional'), general: t('Umum', 'General'),
    content: t('Konten / Script', 'Content / Script'), article: t('Artikel', 'Articles'), paraphrase: t('Parafrase', 'Paraphrasing'),
  }[useCase];
}
export function primaryUseHint(useCase: UseCase, t: T): string {
  return {
    academic: t('Skripsi, tesis, jurnal, tugas kuliah', 'Theses, journals, coursework'),
    professional: t('Email, laporan, proposal', 'Emails, reports, proposals'),
    general: t('Campuran, belum tentu', 'A mix, not sure yet'),
    content: t('Script video, caption, post media sosial', 'Video scripts, captions, social posts'),
    article: t('Artikel, blog, cerita', 'Articles, blogs, stories'),
    paraphrase: t('Menulis ulang teks yang sudah ada', 'Rewriting text that already exists'),
  }[useCase];
}
