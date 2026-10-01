import { Bot, Clock, Flag, History, Save, type LucideIcon } from 'lucide-react';
import type { Version, VersionKind } from './types';

type T = (id: string, en: string) => string;

export const kindIcon: Record<VersionKind, LucideIcon> = { original: Flag, ai_apply: Bot, checkpoint: Save, restore: History, auto: Clock };

export function kindLabel(kind: VersionKind, t: T) {
  return { original: t('Original', 'Original'), ai_apply: t('Hasil AI', 'AI version'), checkpoint: t('Versi tersimpan', 'Checkpoint'), restore: t('Dipulihkan', 'Restored'), auto: t('Otomatis', 'Automatic') }[kind];
}

// System labels are stored in English; translate them for display.
export function versionLabel(version: Version, t: T) {
  const system: Record<string, string> = {
    Original: t('Original', 'Original'), 'Manual checkpoint': t('Versi manual', 'Manual checkpoint'), 'Before AI apply': t('Sebelum hasil AI', 'Before AI apply'),
    'Restored version': t('Versi dipulihkan', 'Restored version'), 'Before restore': t('Sebelum pemulihan', 'Before restore'), 'Automatic version': t('Versi otomatis', 'Automatic version'),
  };
  if (version.label) return system[version.label] ?? version.label;
  return kindLabel(version.kind, t);
}

// Riwayat's filter: AI results, versions the writer made (manual, restore, Original), and automatic snapshots (UX 3).
export type VersionFilter = 'all' | 'ai' | 'manual' | 'auto';
export const matchesFilter = (version: Version, filter: VersionFilter) =>
  filter === 'all' || (filter === 'ai' ? version.kind === 'ai_apply' : filter === 'auto' ? version.kind === 'auto' : version.kind !== 'ai_apply' && version.kind !== 'auto');

export const kindTone: Record<VersionKind, string> = {
  original: 'border-ink-300 bg-ink-50 text-ink-700',
  ai_apply: 'border-brand-200 bg-brand-50 text-brand-800',
  checkpoint: 'border-mode-slate-edge bg-mode-slate-light text-mode-slate-ink',
  restore: 'border-mode-gold-edge bg-mode-gold-light text-mode-gold-ink',
  auto: 'border-line bg-paper text-ink-500',
};
