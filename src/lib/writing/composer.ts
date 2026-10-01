import { AI_SCOPE_LIMIT, normalizeSettings, type Settings } from './settings';

type T = (id: string, en: string) => string;

// The composer starts the first run by itself only when the notebook could actually run it: the plan's per-run
// limit (1.000/2.000/5.000), not the 20.000-character scope cap. Longer text still opens, just without AI.
// Measured the way the notebook measures its own run (UTF-16 length), which is never below the server's code points.
export function composerRun(length: number, runLimit: number): { autorun: boolean; limit: number } {
  const limit = Math.min(runLimit, AI_SCOPE_LIMIT);
  return { autorun: length <= limit, limit };
}

// Free's allowance is granted once per account, so an empty balance must not read as "this month".
export const quotaEmptyText = (oneTime: boolean, t: T) =>
  oneTime ? t('Karakter sekali pakai sudah habis.', 'Your one-time characters are used up.') : t('Karakter bulan ini habis.', 'This month’s characters are used up.');

// Below Max the server drops the Sesuaikan block from the stored notebook, so the composer hands it to the first
// run through this per-notebook session key instead of losing it silently.
export const firstRunCustomKey = (documentId: string) => `writing-generate-custom:${documentId}`;

type CustomBlock = Pick<Settings, 'format' | 'length' | 'audience' | 'focus' | 'extra'>;

export function stashCustom(settings: Settings): string | null {
  if (!settings.customized) return null;
  const block: CustomBlock = { format: settings.format, length: settings.length, audience: settings.audience, focus: settings.focus, extra: settings.extra };
  return JSON.stringify(block);
}

// Rebuilds the first run's settings from the stashed block; anything unreadable is ignored rather than trusted.
export function firstRunOverride(current: Settings, stored: string | null): Settings | null {
  if (!stored) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(stored); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const block = normalizeSettings({ ...(parsed as Record<string, unknown>), customized: true });
  return { ...current, format: block.format, length: block.length, audience: block.audience, focus: block.focus, extra: block.extra, customized: true };
}
