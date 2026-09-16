'use client';
import { Check, CircleDot, CloudOff, TriangleAlert } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Spinner } from '@/components/ui/Spinner';
import type { SaveState } from './types';

export function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useLocale();
  const view = {
    loading: { icon: <Spinner size={13} />, label: t('Memuat…', 'Loading…'), tone: 'text-ink-500' },
    saved: { icon: <Check size={13} />, label: t('Tersimpan', 'Saved'), tone: 'text-brand-700' },
    saving: { icon: <Spinner size={13} />, label: t('Menyimpan…', 'Saving…'), tone: 'text-ink-500' },
    dirty: { icon: <CircleDot size={13} />, label: t('Belum tersimpan', 'Unsaved'), tone: 'text-ink-500' },
    offline: { icon: <CloudOff size={13} />, label: t('Offline · aman di perangkat', 'Offline · kept on device'), tone: 'text-amber-700' },
    error: { icon: <CloudOff size={13} />, label: t('Tidak tersimpan', 'Not saved'), tone: 'text-red-700' },
    conflict: { icon: <TriangleAlert size={13} />, label: t('Konflik versi', 'Version conflict'), tone: 'text-red-700' },
    'local-unavailable': { icon: <TriangleAlert size={13} />, label: t('Cadangan lokal nonaktif', 'Local backup unavailable'), tone: 'text-amber-700' },
  }[state];
  return <span role="status" className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${view.tone}`}>{view.icon}{view.label}</span>;
}
