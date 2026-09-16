'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { MoreHorizontal, Palette, PencilLine, Trash2 } from 'lucide-react';
import { del } from 'idb-keyval';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { relativeTime } from '@/lib/client/format';
import { isMode } from '@/lib/writing/settings';
import { notebookTone, parseNotebookIcon } from '@/lib/notebook/appearance';
import { modeLabel, modeTone, toneClass } from '@/components/writing/modes';
import { Menu } from '@/components/ui/Menu';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { inputClass } from '@/components/ui/Field';
import { useSessionGuard, useShell, type DocumentSummary } from './AppShell';
import { NotebookIcon } from './NotebookIcon';
import { AppearancePicker, useAppearanceSave } from './AppearancePicker';

// Back panel with a rounded tab (38% width) sloping into the body; viewBox matches the 4:3 folder so corners stay round.
const BACK = 'M0 26Q0 0 26 0H118C134 0 142 5 150 15L158 25C165 33 171 36 184 36H374Q400 36 400 62V274Q400 300 374 300H26Q0 300 0 274Z';
const PAPER_LINES = { backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 13px, rgb(48 49 45 / 0.07) 13px 14px)', backgroundPosition: '0 18px' };

export function NotebookCard({ doc, onChange, onDelete }: { doc: DocumentSummary; onChange?: (doc: DocumentSummary) => void; onDelete?: (id: string) => void }) {
  const { t, locale } = useLocale();
  const { user, refresh } = useShell();
  const guard = useSessionGuard();
  const [dialog, setDialog] = useState<'rename' | 'delete' | 'appearance' | null>(null);
  const [name, setName] = useState(doc.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const kebab = useRef<HTMLDivElement>(null);
  const latest = useRef(doc); latest.current = doc;

  const apply = useCallback((next: { color: string | null; icon: string | null }) => onChange?.({ ...latest.current, color: next.color, icon: next.icon }), [onChange]);
  const appearance = useAppearanceSave(doc.id, { color: doc.color, icon: doc.icon }, apply, refresh);
  const mode = isMode(doc.mode) ? doc.mode : null;
  const tone = toneClass[notebookTone(doc.color, doc.mode)];
  const toneVar = `var(--color-mode-${notebookTone(doc.color, doc.mode)}-edge)`;
  const emoji = parseNotebookIcon(doc.icon)?.kind === 'emoji';
  const trimmed = name.trim();

  const open = (next: 'rename' | 'delete') => { setError(''); setName(doc.title); setDialog(next); };
  const close = () => { if (!busy) setDialog(null); };
  const closePicker = useCallback(() => { setDialog(null); kebab.current?.querySelector('button')?.focus(); }, []);

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

  const motion = 'transition-transform duration-300 ease-[cubic-bezier(.2,.7,.3,1)] motion-reduce:transition-none';
  return (
    <article className="group relative">
      <div className="relative aspect-[4/3] w-full">
        <div className="absolute inset-0 drop-shadow-[0_4px_6px_rgb(31_32_29/0.06)] transition-[filter] duration-300 group-hover:drop-shadow-[0_14px_16px_rgb(31_32_29/0.13)] group-focus-within:drop-shadow-[0_14px_16px_rgb(31_32_29/0.13)]">
          <svg viewBox="0 0 400 300" aria-hidden="true" className="absolute inset-0 h-full w-full" style={{ fill: toneVar }}><path d={BACK} /></svg>
          <div aria-hidden="true" style={PAPER_LINES} className={`absolute inset-x-[9%] bottom-[30%] top-[16%] origin-bottom -rotate-2 rounded-md border border-line bg-white ${motion} motion-safe:group-hover:-translate-y-1 motion-safe:group-focus-within:-translate-y-1`} />
          <div aria-hidden="true" className={`absolute inset-x-[13%] bottom-[34%] top-[20%] rotate-[1.5deg] rounded-md bg-white/80 ${motion} motion-safe:group-hover:-translate-y-0.5`} />
          <div className={`absolute inset-x-0 bottom-0 top-[22%] origin-bottom rounded-[15px] shadow-[inset_0_1px_0_rgb(255_255_255/0.8),inset_0_10px_18px_-12px_rgb(255_255_255/0.9),0_-1px_3px_rgb(31_32_29/0.06)] ${tone.fill} ${motion} motion-safe:group-hover:[transform:perspective(700px)_rotateX(-8deg)] motion-safe:group-focus-within:[transform:perspective(700px)_rotateX(-8deg)]`}>
            <span className="absolute bottom-3.5 left-3.5">
              {emoji ? <NotebookIcon icon={doc.icon} mode={doc.mode} size={30} />
                : <span className={`grid h-11 w-11 place-items-center rounded-xl bg-white/70 shadow-[0_1px_2px_rgb(31_32_29/0.06)] ${tone.ink}`}><NotebookIcon icon={doc.icon} mode={doc.mode} size={26} /></span>}
            </span>
          </div>
        </div>
        <div ref={kebab} className="absolute right-2 top-[calc(22%+0.5rem)] z-20 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100">
          <Menu label={`${t('Opsi untuk', 'Options for')} ${doc.title}`}
            triggerClassName={`grid h-8 w-8 place-items-center rounded-lg bg-white/60 outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 ${tone.ink}`}
            trigger={<MoreHorizontal size={17} aria-hidden="true" />}
            items={[
              { label: t('Ubah ikon & warna', 'Change icon & colour'), icon: Palette, onSelect: () => { appearance.clearError(); setDialog('appearance'); } },
              { label: t('Ganti nama', 'Rename'), icon: PencilLine, onSelect: () => open('rename') },
              { label: t('Hapus', 'Delete'), icon: Trash2, tone: 'danger', onSelect: () => open('delete') },
            ]} />
        </div>
      </div>

      <div className="px-0.5 pt-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-[-0.01em] text-ink-900">
          <Link href={`/notebooks/${doc.id}`} className="outline-none after:absolute after:-inset-1.5 after:z-10 after:rounded-[18px] focus-visible:after:ring-2 focus-visible:after:ring-brand-500">{doc.title}</Link>
        </h3>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-500">
          <span className="truncate">{t('Diedit', 'Edited')} {relativeTime(doc.updatedAt, locale)}</span>
          {mode && <><span aria-hidden="true">·</span><span className={`shrink-0 rounded-md border px-1.5 py-px text-[11px] font-semibold ${toneClass[modeTone[mode]].chip}`}>{modeLabel(mode, t)}</span></>}
        </p>
      </div>

      {dialog === 'appearance' && <AppearancePicker anchor={kebab.current} color={doc.color} icon={doc.icon} mode={doc.mode} onClose={closePicker}
        onSelect={(next) => { void appearance.save(next); if (next.icon !== doc.icon && next.icon !== null) closePicker(); }} />}
      {dialog === 'rename' && (
        <Modal title={t('Ganti nama notebook', 'Rename notebook')} size="sm" busy={busy} onClose={close}
          footer={<>
            <Button onClick={close} disabled={busy}>{t('Batal', 'Cancel')}</Button>
            <Button variant="primary" type="submit" form={`rename-${doc.id}`} loading={busy} disabled={!trimmed || trimmed === doc.title}>{t('Simpan', 'Save')}</Button>
          </>}>
          <form id={`rename-${doc.id}`} onSubmit={(event) => void rename(event)} className="space-y-3">
            <label htmlFor={`rename-input-${doc.id}`} className="text-[13px] font-semibold text-ink-700">{t('Nama notebook', 'Notebook name')}</label>
            <input id={`rename-input-${doc.id}`} className={inputClass} value={name} maxLength={180} disabled={busy} autoFocus onChange={(event) => setName(event.target.value)} aria-invalid={!trimmed || undefined} />
            {!trimmed && <p className="text-xs text-red-700">{t('Nama tidak boleh kosong.', 'Name cannot be empty.')}</p>}
          </form>
        </Modal>
      )}
      {dialog === 'delete' && (
        <ConfirmDialog title={t('Hapus notebook?', 'Delete notebook?')} tone="danger" busy={busy} confirmLabel={t('Hapus permanen', 'Delete permanently')} onClose={close} onConfirm={() => void remove()}>
          <p>{t('Notebook', 'The notebook')} <b className="text-ink-900">“{doc.title}”</b> {t('beserta semua versi dan pratinjaunya akan dihapus. Tindakan ini tidak bisa dibatalkan.', 'and all its versions and previews will be deleted. This cannot be undone.')}</p>
        </ConfirmDialog>
      )}
      {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Toast>}
      {appearance.error && <Toast tone="error" onDismiss={appearance.clearError} dismissLabel={t('Tutup', 'Dismiss')} title={t('Tampilan gagal disimpan', 'Could not save appearance')}>{appearance.error}</Toast>}
    </article>
  );
}

export function NotebookCardSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <div className="relative aspect-[4/3] w-full">
        <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full fill-paper-deep"><path d={BACK} /></svg>
        <div className="absolute inset-x-0 bottom-0 top-[22%] rounded-[15px] bg-ink-100/70">
          <span className="absolute bottom-3.5 left-3.5 h-11 w-11 rounded-xl bg-white/60" />
        </div>
      </div>
      <div className="px-0.5 pt-3">
        <div className="h-3.5 w-4/5 rounded bg-paper-deep" />
        <div className="mt-2 h-3 w-1/2 rounded bg-paper-deep" />
      </div>
    </div>
  );
}
