import { LEGACY_CUSTOM_PROMPT, modeFromPrompt, promptFor } from './settings';

// Account-level writing defaults, edited in Settings > Preferensi menulis and first chosen in onboarding.
// PATCH /api/settings accepts these, so the page only needs to send them back with the display fields.
export const WRITING_PREFERENCE_KEYS = ['writingLanguage', 'defaultMode', 'humanizerContext', 'primaryUseCase'] as const;
export const DISPLAY_PREFERENCE_KEYS = ['interfaceLanguage', 'localDrafts'] as const;

// The six rewrite modes the settings API accepts as an account default, in the app's usual order.
export const DEFAULT_MODE_PROMPTS = [promptFor.humanize, promptFor.standard, promptFor.academic, promptFor.professional, promptFor.creative, promptFor.simplify];

// A legacy custom-transform default runs as Parafrase everywhere else, and the API no longer accepts it,
// so it is shown and saved as Parafrase instead of failing the whole settings save.
export const accountDefaultMode = (value: string): string =>
  DEFAULT_MODE_PROMPTS.includes(value) ? value : value === LEGACY_CUSTOM_PROMPT ? promptFor.standard : promptFor[modeFromPrompt(value) ?? 'humanize'];

type Keyed = Record<string, unknown>;

// True when any of the given fields differs, so each settings card knows whether its own footer has work to do.
export const groupChanged = (form: Keyed, saved: Keyed, keys: readonly string[]): boolean => keys.some((key) => form[key] !== saved[key]);

// Puts back only the given fields from the saved copy, so "Batalkan" in one card never discards another card's edits.
export const resetGroup = <F extends Keyed>(form: F, saved: F, keys: readonly string[]): F =>
  ({ ...form, ...Object.fromEntries(keys.map((key) => [key, saved[key]])) });
