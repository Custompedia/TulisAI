import { detectLanguage } from './language';

export { detectLanguage };
export type Mode = 'standard' | 'academic' | 'humanize' | 'professional' | 'creative' | 'simplify';
export type WritingLanguage = 'auto' | 'id' | 'en';
export type Strength = 'light' | 'balanced' | 'strong';
export type Format = 'paragraph' | 'bullets' | 'numbered_list' | 'table' | 'short_summary' | 'email';
export type Length = 'shorter' | 'same' | 'more_detailed';
export type Focus = 'clarity' | 'naturalness' | 'formality' | 'persuasiveness' | 'remove_repetition';
export type Recipient = 'atasan' | 'klien' | 'rekan' | 'vendor' | 'umum';
export type SimplifyFor = 'anak_sekolah' | 'umum' | 'klien' | 'pemula';
export type Audience = 'general_public' | 'lecturer' | 'professional' | 'client';

export type Settings = {
  mode: Mode; language: WritingLanguage; strength: Strength; academic: string; context: string; preservation: string;
  recipient: Recipient; simplifyFor: SimplifyFor; audience: Audience; format: string; length: string;
  focus: string[]; extra: string; customized: boolean;
  // Short writing sample used as a style reference; sent to the model, never reused as content.
  sample: string;
  // Id of the saved style these settings came from; cleared as soon as they drift.
  styleId: string | null;
};

export const defaults: Settings = {
  mode: 'humanize', language: 'auto', strength: 'balanced', academic: 'thesis', context: 'general', preservation: 'flexible',
  recipient: 'umum', simplifyFor: 'umum', audience: 'general_public', format: 'paragraph', length: 'same',
  focus: [], extra: '', customized: false, sample: '', styleId: null,
};

export const EXTRA_LIMIT = 500;
export const SAMPLE_LIMIT = 1_000;
export const FOCUS_LIMIT = 3;
// Share of words that may change before a Humanize result counts as over its limit.
export const PRESERVATION_CEILING: Record<string, number> = { conservative: 15, balanced: 30, flexible: 50 };
export const AI_SCOPE_LIMIT = 20_000;
export const INLINE_LIMIT = 600;
export const MIN_WORDS = 3;

export const RECIPIENTS: Recipient[] = ['atasan', 'klien', 'rekan', 'vendor', 'umum'];
export const SIMPLIFY_FOR: SimplifyFor[] = ['anak_sekolah', 'umum', 'klien', 'pemula'];
export const AUDIENCES: Audience[] = ['general_public', 'lecturer', 'professional', 'client'];
const STRENGTHS: Strength[] = ['light', 'balanced', 'strong'];
const LANGUAGES: WritingLanguage[] = ['auto', 'id', 'en'];

export const promptFor: Record<Mode, string> = {
  standard: 'P01_STANDARD_REWRITE', academic: 'P02_ACADEMIC', humanize: 'P03_HUMANIZER', professional: 'P04_PROFESSIONAL',
  creative: 'P05_CREATIVE', simplify: 'P06_SIMPLIFY',
};
export const LEGACY_CUSTOM_PROMPT = 'P08_CUSTOM_TRANSFORM';

export const isMode = (value: unknown): value is Mode => typeof value === 'string' && Object.hasOwn(promptFor, value);
// Legacy 'custom' mode is shown and run as Parafrase.
export const asMode = (value: unknown): Mode | null => (value === 'custom' ? 'standard' : isMode(value) ? value : null);

export const modeFromPrompt = (promptId: string | null | undefined): Mode | null =>
  promptId === LEGACY_CUSTOM_PROMPT ? 'standard' : (Object.entries(promptFor).find(([, id]) => id === promptId)?.[0] as Mode | undefined) ?? null;

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => (allowed as readonly unknown[]).includes(value) ? value as T : fallback;
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

// Builds clean settings from stored or legacy preferences; unknown keys are dropped.
export function normalizeSettings(raw: Record<string, unknown> | null | undefined): Settings {
  const value = raw ?? {};
  const legacyCustom = value.mode === 'custom';
  return {
    mode: asMode(value.mode) ?? defaults.mode, language: oneOf(LANGUAGES, value.language, defaults.language), strength: oneOf(STRENGTHS, value.strength, defaults.strength),
    academic: str(value.academic, defaults.academic), context: str(value.context, defaults.context), preservation: str(value.preservation, defaults.preservation),
    recipient: oneOf(RECIPIENTS, value.recipient, defaults.recipient), simplifyFor: oneOf(SIMPLIFY_FOR, value.simplifyFor, defaults.simplifyFor),
    audience: oneOf(AUDIENCES, value.audience, defaults.audience), format: str(value.format, defaults.format), length: str(value.length, defaults.length),
    focus: Array.isArray(value.focus) ? value.focus.filter((item): item is string => typeof item === 'string').slice(0, FOCUS_LIMIT) : [],
    extra: str(value.extra, '').slice(0, EXTRA_LIMIT), customized: legacyCustom || value.customized === true,
    sample: str(value.sample, '').slice(0, SAMPLE_LIMIT),
    styleId: typeof value.styleId === 'string' && value.styleId ? value.styleId : null,
  };
}

// Sends exactly the controls the selected prompt uses; the request block only when Sesuaikan was applied.
export function runtimeControls(settings: Settings, language: 'id' | 'en', inlineAction?: string): Record<string, unknown> {
  if (inlineAction) return { language, action: inlineAction };
  const controls: Record<Mode, Record<string, unknown>> = {
    standard: { strength: settings.strength },
    academic: { academic_context: settings.academic },
    humanize: { strength: settings.strength, humanizer_context: settings.context, preservation: settings.preservation },
    professional: { audience: settings.recipient },
    creative: { creativity_strength: settings.strength },
    simplify: { target_audience: settings.simplifyFor },
  };
  const request = { format: settings.format, length: settings.length, audience: oneOf(AUDIENCES, settings.audience, 'general_public'), focus: settings.focus.slice(0, FOCUS_LIMIT), extra_request: settings.extra.trim().slice(0, EXTRA_LIMIT) || null };
  const sample = settings.sample.trim().slice(0, SAMPLE_LIMIT);
  return { language, ...controls[settings.mode], ...(sample ? { style_sample: sample } : {}), ...(settings.customized ? { custom_request: request } : {}) };
}


export const resolveLanguage = (settings: Settings, text: string) => (settings.language === 'auto' ? detectLanguage(text) : settings.language);

// Returns a conflict message key when controls cannot be satisfied together.
export function customConflict(settings: Settings, lockedTerms: string[]): 'summary-detail' | 'locked-term' | null {
  if (settings.format === 'short_summary' && settings.length === 'more_detailed') return 'summary-detail';
  const extra = settings.extra.toLowerCase();
  if (extra && lockedTerms.some((term) => extra.includes(term.toLowerCase()))) return 'locked-term';
  return null;
}
