'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { guardedPush } from '@/lib/client/navigation-guard';
import { plainTextDocument } from '@/lib/editor/document';
import { defaults, modeFromPrompt } from '@/lib/writing/settings';
import type { NotebookAppearance } from '@/lib/notebook/appearance';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Toast } from '@/components/ui/Toast';
import { useSessionGuard, useShell } from './AppShell';
import { AppearanceFields } from './AppearancePicker';
import { NotebookFolder } from './NotebookCard';

const TITLE_LIMIT = 180;

// Creates an empty notebook after the user names it and picks an icon and colour.
export function NewNotebookDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { settings: prefs } = useShell();
  const mode = modeFromPrompt(prefs.defaultMode) ?? 'humanize';
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [appearance, setAppearance] = useState<NotebookAppearance>({ color: null, icon: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = name.trim();
  const invalid = touched && !title;

  async function create(event?: React.FormEvent) {
    event?.preventDefault();
    setTouched(true);
    if (!title || busy) return;
    setBusy(true); setError('');
    try {
      const preferences = { ...defaults, mode, language: prefs.writingLanguage, context: prefs.humanizerContext };
      const doc = await request<{ id: string }>('/api/documents', 'POST', { title, language: prefs.writingLanguage, content: plainTextDocument(''), preferences, ...appearance }, newKey());
      if (!guardedPush(router, `/notebooks/${doc.id}`)) onClose();
    } catch (caught) {
      if (!guard(caught)) setError(errorText(caught, locale === 'en'));
      setBusy(false);
    }
  }

  return (
    <Modal size="lg" busy={busy} onClose={onClose} title={t('Notebook baru', 'New notebook')} description={t('Beri nama, pilih ikon dan warna. Semuanya bisa diubah nanti.', 'Name it and pick an icon and colour. You can change these later.')}
      footer={<>
        <Button onClick={onClose} disabled={busy}>{t('Batal', 'Cancel')}</Button>
        <Button variant="primary" type="submit" form="new-notebook" loading={busy} disabled={busy || (touched && !title)}>{t('Buat notebook', 'Create notebook')}</Button>
      </>}>
      <form id="new-notebook" onSubmit={(event) => void create(event)} className="grid gap-6 md:grid-cols-[13rem_1fr]">
        <div className="flex flex-col items-center md:items-stretch">
          <p className="mb-2 self-start text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{t('Pratinjau', 'Preview')}</p>
          <div className="group w-44 md:w-full" aria-hidden="true">
            <div className="relative aspect-[4/3] w-full"><NotebookFolder color={appearance.color} icon={appearance.icon} mode={mode} /></div>
            <p className={`mt-3 line-clamp-2 text-sm font-semibold leading-snug ${title ? 'text-ink-900' : 'text-ink-400'}`}>{title || t('Notebook tanpa judul', 'Untitled notebook')}</p>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div>
            <label htmlFor="new-notebook-name" className="text-[13px] font-semibold text-ink-700">{t('Nama notebook', 'Notebook name')}</label>
            <input id="new-notebook-name" autoFocus className={`${inputClass} mt-1.5`} value={name} maxLength={TITLE_LIMIT} disabled={busy} placeholder={t('Mis. Skripsi Bab 2', 'E.g. Thesis chapter 2')}
              onChange={(event) => setName(event.target.value)} onBlur={() => setTouched(true)} aria-invalid={invalid || undefined} aria-describedby="new-notebook-name-hint" />
            <p id="new-notebook-name-hint" className={`mt-1.5 flex justify-between text-xs ${invalid ? 'text-red-700' : 'text-ink-400'}`}>
              <span>{invalid ? t('Nama tidak boleh kosong.', 'Name cannot be empty.') : t('Tampil di kartu dan judul notebook.', 'Shown on the card and notebook title.')}</span>
              <span className="tabular-nums">{name.length}/{TITLE_LIMIT}</span>
            </p>
          </div>

          <div>
            <p className="text-[13px] font-semibold text-ink-700">{t('Ikon & warna', 'Icon & colour')}</p>
            <div className="mt-1.5 overflow-hidden rounded-xl border border-line bg-white">
              <AppearanceFields color={appearance.color} icon={appearance.icon} mode={mode} onSelect={setAppearance} gridHeight="max-h-40"
                trailing={<button type="button" onClick={() => setAppearance({ color: null, icon: null })} disabled={!appearance.color && !appearance.icon}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-ink-500 outline-none hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40"><RotateCcw size={13} aria-hidden="true" />{t('Default', 'Default')}</button>} />
            </div>
          </div>
        </div>
      </form>
      {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Notebook gagal dibuat', 'Could not create notebook')}>{error}</Toast>}
    </Modal>
  );
}
