'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { guardedPush } from '@/lib/client/navigation-guard';
import { newNotebookBody, type NewKind, type NewOptions } from '@/lib/writing/new-notebook';
import { opensPaged } from '@/lib/writing/preferences';
import { useEntitlements, useSessionGuard, useShell } from './AppShell';
import { showPlanNotice } from './shell-events';

export type { NewKind, NewOptions };

// One way to create a skeleton or empty notebook, shared by the Tulis baru dialog and Beranda's chips.
export function useCreateNotebook() {
  const { locale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { settings: prefs } = useShell();
  const { has } = useEntitlements();
  const [busy, setBusy] = useState<NewKind | null>(null);
  const [error, setError] = useState('');

  async function create(kind: NewKind, options: NewOptions = {}): Promise<boolean> {
    if (busy) return false;
    setBusy(kind); setError('');
    try {
      const body = newNotebookBody(kind, options, { defaultMode: prefs.defaultMode, writingLanguage: prefs.writingLanguage, humanizerContext: prefs.humanizerContext, locale, advancedNotebook: has('advanced_notebook'), now: new Date(), defaultPaged: opensPaged(prefs.defaultCanvas, has('advanced_notebook')) });
      const doc = await request<{ id: string }>('/api/documents', 'POST', body, newKey());
      // The card keeps its spinner until the editor takes over; an unsaved-changes prompt hands control back.
      if (!guardedPush(router, `/notebooks/${doc.id}`)) setBusy(null);
      return true;
    } catch (caught) {
      if (!guard(caught) && !showPlanNotice(caught)) setError(errorText(caught, locale === 'en'));
      setBusy(null);
      return false;
    }
  }

  return { create, busy, error, clearError: () => setError('') };
}
