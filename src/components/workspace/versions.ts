import { Bot, Flag, History, Save, type LucideIcon } from 'lucide-react';
import type { Version, VersionKind } from './types';

type T = (id: string, en: string) => string;

export const kindIcon: Record<VersionKind, LucideIcon> = { original: Flag, ai_apply: Bot, checkpoint: Save, restore: History };

export function kindLabel(kind: VersionKind, t: T) {
  return { original: t('Original', 'Original'), ai_apply: t('Hasil AI', 'AI version'), checkpoint: t('Versi tersimpan', 'Checkpoint'), restore: t('Dipulihkan', 'Restored') }[kind];
}

// System labels are stored in English; translate them for display.
export function versionLabel(version: Version, t: T) {
  const system: Record<string, string> = {
    Original: t('Original', 'Original'), 'Manual checkpoint': t('Versi manual', 'Manual checkpoint'), 'Before AI apply': t('Sebelum hasil AI', 'Before AI apply'),
    'Restored version': t('Versi dipulihkan', 'Restored version'), 'Before restore': t('Sebelum pemulihan', 'Before restore'),
  };
  if (version.label) return system[version.label] ?? version.label;
  return kindLabel(version.kind, t);
}

export const kindTone: Record<VersionKind, string> = {
  original: 'border-ink-300 bg-ink-50 text-ink-700',
  ai_apply: 'border-brand-200 bg-brand-50 text-brand-800',
  checkpoint: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  restore: 'border-amber-200 bg-amber-50 text-amber-800',
};
