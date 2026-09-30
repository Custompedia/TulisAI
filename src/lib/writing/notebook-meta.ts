import { ADVANCED_PREFERENCE, PAGE_LAYOUT_PREFERENCES } from '@/lib/plans';
import type { Settings } from './settings';

// Notebook facts that are not writing settings: the kind of writing, where it came from, a word target and the
// writer's own brief. They share the notebook's preferences row with the settings and the page layout, so every
// save and every copy has to carry them, or the first autosave drops them (normalizeSettings keeps settings only).
// None of these names may collide with PREMIUM_PERSISTED_KEYS on the server, which strips those below Max.
export const BRIEF_KEYS = ['briefPlatform', 'briefAudience', 'briefMessage', 'briefCta', 'briefDuration'] as const;
export const NOTEBOOK_META_KEYS = ['docType', 'docSource', 'wordTarget', ...BRIEF_KEYS, 'notes'] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];
export type MetaKey = (typeof NOTEBOOK_META_KEYS)[number];

// Create and PATCH cap every string preference at 500 characters; autosave does not, so the client caps them
// itself. Otherwise a long brief saves fine, and the next duplicate, copy or restore fails with a 400.
export const META_VALUE_LIMIT = 500;
export const WORD_TARGET_MAX = 200_000;
// The create schema's array rule: at most 20 strings of at most 300 characters.
const ARRAY_LIMIT = 20;
const ARRAY_VALUE_LIMIT = 300;

export type DocSource = 'skeleton' | 'blank' | 'compose' | 'import' | 'skill' | 'copy';
export type NotebookMeta = {
  docType?: string; docSource?: string; wordTarget?: number; notes?: string;
} & Partial<Record<BriefKey, string>>;

const clamp = (value: string) => value.slice(0, META_VALUE_LIMIT);
const validTarget = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= WORD_TARGET_MAX;

// Reads only the whitelisted keys, each clamped; anything of the wrong type is left out rather than trusted.
export function readMeta(preferences: Record<string, unknown> | null | undefined): NotebookMeta {
  const source = preferences ?? {};
  const meta: NotebookMeta = {};
  for (const key of NOTEBOOK_META_KEYS) {
    const value = source[key];
    if (key === 'wordTarget') { if (validTarget(value)) meta.wordTarget = value; continue; }
    if (typeof value === 'string' && value) (meta as Record<string, unknown>)[key] = clamp(value);
  }
  return meta;
}

// The whole preferences row an autosave writes: layout, settings, the canvas flag and the notebook facts.
// Settings go in as they are (a Max writing sample may be longer than 500); only the notebook facts are clamped.
export function autosavePreferences(input: { settings: Settings; layout: Record<string, unknown>; advanced: boolean; meta: NotebookMeta }): Record<string, unknown> {
  return { ...input.layout, ...(input.settings as unknown as Record<string, unknown>), [ADVANCED_PREFERENCE]: input.advanced, ...readMeta(input.meta as Record<string, unknown>) };
}

// Every value a POST /api/documents body may carry: strings ≤500, arrays of ≤20 strings ≤300.
export function clampPreferenceValues(preferences: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(preferences)) {
    if (typeof value === 'string') next[key] = clamp(value);
    else if (Array.isArray(value)) next[key] = value.filter((item): item is string => typeof item === 'string').slice(0, ARRAY_LIMIT).map((item) => item.slice(0, ARRAY_VALUE_LIMIT));
    else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) next[key] = value;
  }
  return next;
}

export type CopyAccess = { advancedNotebook: boolean; savedStyles: boolean };

// Preferences for a new notebook made from an existing one (duplicate, save-as-copy, recovery copy). Create refuses
// page-layout keys and the canvas flag without advanced_notebook, and a skill id without saved_styles, with
// FEATURE_LOCKED, so those are left out for such accounts instead of failing the whole copy.
export function copyPreferences(input: { settings: Settings; layout: Record<string, unknown>; advanced: boolean; meta: NotebookMeta }, access: CopyAccess): Record<string, unknown> {
  const settings = { ...(input.settings as unknown as Record<string, unknown>) };
  if (!access.savedStyles) settings.styleId = null;
  const layout = access.advancedNotebook ? { ...input.layout, [ADVANCED_PREFERENCE]: input.advanced } : {};
  // A copy is its own notebook: never a pristine skeleton that could be discarded as untouched.
  const next: Record<string, unknown> = { ...layout, ...settings, ...readMeta(input.meta as Record<string, unknown>), docSource: 'copy' satisfies DocSource };
  if (!access.advancedNotebook) for (const key of [ADVANCED_PREFERENCE, ...PAGE_LAYOUT_PREFERENCES]) delete next[key];
  return clampPreferenceValues(next);
}
