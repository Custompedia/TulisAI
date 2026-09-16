'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Clock3, FileText, MoreVertical, PencilLine, Trash2 } from 'lucide-react';
import { del } from 'idb-keyval';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { relativeTime } from '@/lib/client/format';
import { isMode } from '@/lib/writing/settings';
import { modeIcon, modeLabel, modeTone, toneClass, type ModeTone } from '@/components/writing/modes';
import { Menu } from '@/components/ui/Menu';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { inputClass } from '@/components/ui/Field';
import { useSessionGuard, useShell, type DocumentSummary } from './AppShell';

const NOTCH = 'M0 0H20C30 0 36 6 42 18L80 82C86 94 92 100 100 100V100H0Z';

export function ModeBadge({ mode }: { mode: string | null }) {
  const { t } = useLocale();
  if (!isMode(mode)) return null;
  const Icon = modeIcon[mode]; const tone = toneClass[modeTone[mode]];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone.chip}`}><Icon size={12} aria-hidden="true" />{modeLabel(mode, t)}</span>;
}

export function ProjectCard({ doc, onChange, onDelete }: { doc: DocumentSummary; onChange?: (doc: DocumentSummary) => void; onDelete?: (id: string) => void }) {
  const { t, locale } = useLocale();
  const { user, refresh } = useShell();
  const guard = useSessionGuard();
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(doc.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mode = isMode(doc.mode) ? doc.mode : null;
  const tone: ModeTone = mode ? modeTone[mode] : 'slate';
  const Icon = mode ? modeIcon[mode] : FileText;
  const language = doc.language === 'id' ? 'ID' : doc.language === 'en' ? 'EN' : 'Auto';
  const trimmed = name.trim();

  const open = (next: 'rename' | 'delete') => { setError(''); setName(doc.title); setDialog(next); };
  const close = () => { if (!busy) setDialog(null); };

  async function rename(event?: React.FormEvent) {
    event?.preventDefault();
    if (!trimmed || trimmed === doc.title) { setDialog(null); return; }
    setBusy(true); setError('');
    try {
      const saved = await request<{ title: string; revision: number; updatedAt: string }>(`/api/documents/${doc.id}`, 'PATCH', { title: trimmed, expectedRevision: doc.revision }, newKey());
      onChange?.({ ...doc, title: saved.title, revision: saved.revision, updatedAt: saved.updatedAt }); setDialog(null); void refresh();
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError('');
    try {
      await request(`/api/documents/${doc.id}`, 'DELETE', {}, newKey());
      await del(`writing-draft:${user.id}:${doc.id}`).catch(() => undefined);
      setDialog(null); onDelete?.(doc.id); void refresh();
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { setBusy(false); }
  }

  return (
    <article className="group relative flex flex-col rounded-[20px] border border-line bg-white p-1.5 transition-[border-color,transform,box-shadow] duration-200 focus-within:border-line-strong hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_10px_24px_-14px_rgb(31_32_29/0.25)] sm:aspect-[4/3]">
      <div className="relative h-24 shrink-0 sm:h-auto sm:basis-[44%]">
        <div className="absolute left-0 top-0 flex h-4" aria-hidden="true">
          <span className={`h-full w-[4.5rem] rounded-tl-[14px] ${toneClass[tone].fill}`} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="-ml-px h-full w-7" style={{ fill: `var(--color-mode-${tone}-fill)` }}><path d={NOTCH} /></svg>
        </div>
        <div className={`absolute inset-x-0 bottom-0 top-4 flex items-end justify-between gap-2 rounded-[14px] rounded-tl-none p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.7)] ${toneClass[tone].fill}`}>
          <span className={`grid h-9 w-9 place-items-center rounded-[10px] border bg-white/70 ${toneClass[tone].edge} ${toneClass[tone].ink}`}><Icon size={18} aria-hidden="true" /></span>
          <span className={`truncate rounded-full border bg-white/60 px-2 py-0.5 text-[11px] font-semibold ${toneClass[tone].edge} ${toneClass[tone].ink}`}>{mode ? modeLabel(mode, t) : t('Dokumen', 'Document')}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2 pt-3">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink-900">
          <Link href={`/projects/${doc.id}`} className="rounded-sm after:absolute after:inset-0 after:rounded-[20px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[#647954]">{doc.title}</Link>
        </h3>
        <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-2 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1"><Clock3 size={12} aria-hidden="true" />{t('Diedit', 'Edited')} {relativeTime(doc.updatedAt, locale)}</span>
          <span className="rounded-md bg-paper-deep px-1.5 py-px text-[11px] font-semibold text-ink-600">{language}</span>
          <span className="rounded-md bg-paper-deep px-1.5 py-px text-[11px] font-semibold text-ink-600">{t('Rev', 'Rev')} {doc.revision}</span>
        </div>
      </div>
      <div className="absolute right-3 top-2 z-10"><Menu label={`${t('Opsi untuk', 'Options for')} ${doc.title}`}
        triggerClassName="grid h-8 w-8 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
        trigger={<MoreVertical size={16} aria-hidden="true" />}
        items={[
          { label: t('Ganti nama', 'Rename'), icon: PencilLine, onSelect: () => open('rename') },
          { label: t('Hapus', 'Delete'), icon: Trash2, tone: 'danger', onSelect: () => open('delete') },
        ]} /></div>

      {dialog === 'rename' && (
        <Modal title={t('Ganti nama proyek', 'Rename project')} size="sm" busy={busy} onClose={close}
          footer={<>
            <Button onClick={close} disabled={busy}>{t('Batal', 'Cancel')}</Button>
            <Button variant="primary" type="submit" form={`rename-${doc.id}`} loading={busy} disabled={!trimmed || trimmed === doc.title}>{t('Simpan', 'Save')}</Button>
          </>}>
          <form id={`rename-${doc.id}`} onSubmit={(event) => void rename(event)} className="space-y-3">
            <label htmlFor={`rename-input-${doc.id}`} className="text-[13px] font-semibold text-ink-700">{t('Nama proyek', 'Project name')}</label>
            <input id={`rename-input-${doc.id}`} className={inputClass} value={name} maxLength={180} disabled={busy} autoFocus onChange={(event) => setName(event.target.value)} aria-invalid={!trimmed || undefined} />
            {!trimmed && <p className="text-xs text-red-700">{t('Nama tidak boleh kosong.', 'Name cannot be empty.')}</p>}
          </form>
        </Modal>
      )}
      {dialog === 'delete' && (
        <ConfirmDialog title={t('Hapus proyek?', 'Delete project?')} tone="danger" busy={busy} confirmLabel={t('Hapus permanen', 'Delete permanently')} onClose={close} onConfirm={() => void remove()}>
          <p>{t('Proyek', 'The project')} <b className="text-ink-900">“{doc.title}”</b> {t('beserta semua versi dan pratinjaunya akan dihapus. Tindakan ini tidak bisa dibatalkan.', 'and all its versions and previews will be deleted. This cannot be undone.')}</p>
        </ConfirmDialog>
      )}
      {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Toast>}
    </article>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col rounded-[20px] border border-line bg-white p-1.5 sm:aspect-[4/3]">
      <div className="h-24 shrink-0 animate-pulse rounded-[14px] bg-paper-deep sm:h-auto sm:basis-[44%]" />
      <div className="flex flex-1 flex-col gap-2 px-2.5 pb-2 pt-3">
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-paper-deep" />
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-paper-deep" />
        <div className="mt-auto h-3 w-2/3 animate-pulse rounded bg-paper-deep" />
      </div>
    </div>
  );
}
