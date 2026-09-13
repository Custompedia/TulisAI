export type Mode = 'standard' | 'academic' | 'humanize' | 'professional' | 'creative' | 'simplify' | 'custom';
export type WritingLanguage = 'auto' | 'id' | 'en';
export type Strength = 'light' | 'balanced' | 'strong';
export type Format = 'paragraph' | 'bullets' | 'numbered_list' | 'table' | 'short_summary';
export type Length = 'shorter' | 'same' | 'more_detailed';
export type Focus = 'clarity' | 'naturalness' | 'formality' | 'persuasiveness' | 'remove_repetition';

export type Settings = {
  mode: Mode; language: WritingLanguage; strength: Strength; academic: string; context: string; preservation: string;
  documentType: string; creativeGoal: string; readingLevel: string; audience: string; format: string; length: string;
  focus: string[]; extra: string; customized: boolean;
};

export const defaults: Settings = {
  mode: 'standard', language: 'auto', strength: 'balanced', academic: 'thesis', context: 'general', preservation: 'balanced',
  documentType: 'email', creativeGoal: '', readingLevel: '', audience: 'general_public', format: 'paragraph', length: 'same',
  focus: [], extra: '', customized: false,
};

export const EXTRA_LIMIT = 300;
export const AI_SCOPE_LIMIT = 20_000;
export const MIN_WORDS = 3;

export const promptFor: Record<Mode, string> = {
  standard: 'P01_STANDARD_REWRITE', academic: 'P02_ACADEMIC', humanize: 'P03_HUMANIZER', professional: 'P04_PROFESSIONAL',
  creative: 'P05_CREATIVE', simplify: 'P06_SIMPLIFY', custom: 'P08_CUSTOM_TRANSFORM',
};

export const modeFromPrompt = (promptId: string | null | undefined): Mode | null =>
  (Object.entries(promptFor).find(([, id]) => id === promptId)?.[0] as Mode | undefined) ?? null;

export const isMode = (value: unknown): value is Mode => typeof value === 'string' && Object.hasOwn(promptFor, value);

export function runtimeControls(settings: Settings, language: 'id' | 'en', inlineAction?: string) {
  const audience = settings.audience.trim() || 'general_public';
  const custom = { format: settings.format, length: settings.length, audience, focus: settings.focus, extra_request: settings.extra.trim() || null };
  return {
    language, strength: settings.strength, academic_context: settings.academic, humanizer_context: settings.context,
    preservation: settings.preservation, audience, document_type: settings.documentType,
    creative_goal: settings.creativeGoal || (language === 'id' ? 'Ekspresif dan menarik' : 'Expressive and engaging'),
    creativity_strength: settings.strength, target_audience: audience, reading_level: settings.readingLevel || null,
    length: settings.length, output_format: settings.format === 'short_summary' ? 'summary' : settings.format,
    ...(settings.mode === 'custom' ? custom : {}),
    ...(settings.customized ? { custom_request: custom } : {}),
    ...(inlineAction ? { action: inlineAction, active_mode: settings.mode === 'custom' ? 'standard' : settings.mode } : {}),
  };
}

const ID_WORDS = new Set(['yang', 'dan', 'untuk', 'dengan', 'pada', 'ini', 'adalah', 'dalam', 'tidak', 'saya', 'kami', 'tersebut', 'akan', 'dari', 'itu', 'bahwa', 'juga', 'atau', 'sebagai', 'karena']);
const EN_WORDS = new Set(['the', 'and', 'for', 'with', 'this', 'is', 'are', 'in', 'not', 'we', 'our', 'that', 'of', 'to', 'it', 'be', 'was', 'as', 'by', 'from']);

export function detectLanguage(text: string): 'id' | 'en' | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let id = 0; let en = 0;
  for (const word of words.slice(0, 2000)) { if (ID_WORDS.has(word)) id++; if (EN_WORDS.has(word)) en++; }
  return id > en ? 'id' : en > id ? 'en' : null;
}

export const resolveLanguage = (settings: Settings, text: string) => (settings.language === 'auto' ? detectLanguage(text) : settings.language);

// Returns a conflict message key when controls cannot be satisfied together.
export function customConflict(settings: Settings, lockedTerms: string[]): 'summary-detail' | 'locked-term' | null {
  if (settings.format === 'short_summary' && settings.length === 'more_detailed') return 'summary-detail';
  const extra = settings.extra.toLowerCase();
  if (extra && lockedTerms.some((term) => extra.includes(term.toLowerCase()))) return 'locked-term';
  return null;
}
