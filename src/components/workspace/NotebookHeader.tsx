'use client';
import { useEffect, useRef, useState } from 'react';
import { AlignLeft, ChartNoAxesColumn, Columns2, Copy, Download, EllipsisVertical, FileText, Lock, Plus, Save, Trash2, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { AccountMenu } from '@/components/app/AccountMenu';
import { NewNotebookDialog } from '@/components/app/NewNotebookDialog';

type Props = {
  title: string; onTitle: (title: string) => void; disabled: boolean; comparing: boolean; canCopy: boolean;
  onCopy: () => void; onCompare: () => void; onAnalytics: () => void; onSaveVersion: () => void; onDelete: () => void;
  /** Paid surfaces: locked entries stay visible and open the plans dialog instead of vanishing. */
  canExport: boolean; exporting: boolean; onExport: () => void;
  canAdvanced: boolean; advanced: boolean; onAdvanced: (next: boolean) => void;
  onUpgrade: () => void;
};

// Compact toolbar control. A locked paid feature shows a grey padlock instead of its own icon and opens the
// plans dialog on click, so nothing disappears on the free plan.
function ToolButton({ icon: Icon, label, onClick, active, locked, disabled }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; locked?: boolean; disabled?: boolean }) {
  const tone = locked
    ? 'border-line bg-white text-ink-400 hover:border-line-strong hover:bg-paper'
    : active
      ? 'border-brand-300 bg-brand-50 text-brand-800 ring-2 ring-brand-200'
      : 'border-line bg-white text-ink-700 hover:border-line-strong hover:bg-paper hover:text-ink-900';
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={locked ? undefined : active} disabled={disabled} onClick={onClick}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}>
      {locked ? <Lock size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
    </button>
  );
}

// `locked` is a paid feature the free plan cannot use: greyed out with a padlock, but still clickable so it
// can explain itself through the plans dialog.
function MenuItem({ icon: Icon, label, onClick, danger, disabled, locked }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; locked?: boolean }) {
  const tone = danger ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : locked ? 'text-ink-500 hover:bg-paper-deep focus-visible:bg-paper-deep' : 'text-ink-700 hover:bg-paper-deep focus-visible:bg-paper-deep';
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium outline-none transition-colors disabled:opacity-40 ${tone}`}>
      <Icon size={15} aria-hidden="true" className={`shrink-0 ${locked ? 'text-ink-400' : ''}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {locked && <Lock size={13} aria-hidden="true" className="shrink-0 text-ink-400" />}
    </button>
  );
}

export function NotebookHeader({ title, onTitle, disabled, comparing, canCopy, onCopy, onCompare, onAnalytics, onSaveVersion, onDelete, canExport, exporting, onExport, canAdvanced, advanced, onAdvanced, onUpgrade }: Props) {
  const { t } = useLocale();
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menuRef.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menu]);

  const pick = (action: () => void) => () => { setMenu(false); action(); };
  const compareLabel = comparing ? t('Keluar dari Bandingkan', 'Exit Compare') : t('Bandingkan', 'Compare');

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-shell px-3 sm:px-4">
      <span title={t('Ke beranda', 'Go to home')} className="shrink-0"><Logo href="/app" compact /></span>
      <input aria-label={t('Judul notebook', 'Notebook title')} value={title} maxLength={180} disabled={disabled} onChange={(event) => onTitle(event.target.value)} placeholder={t('Notebook tanpa judul', 'Untitled notebook')}
        className="ml-1 h-10 min-w-0 max-w-xl flex-1 truncate rounded-lg bg-transparent px-2 text-[20px] font-medium tracking-[-0.01em] text-ink-950 placeholder:text-ink-400 hover:bg-white/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => setCreating(true)} className="hidden h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-[13px] font-medium text-ink-800 transition-colors hover:border-line-strong hover:bg-paper sm:inline-flex">
          <Plus size={16} aria-hidden="true" />Notebook
        </button>
        <div className="hidden items-center gap-1 lg:flex">
          <Button size="sm" variant="ghost" icon={Copy} disabled={!canCopy} onClick={onCopy}>{t('Salin', 'Copy')}</Button>
          <button type="button" aria-pressed={comparing} title={compareLabel} onClick={onCompare}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors ${comparing ? 'border-brand-300 bg-brand-50 text-brand-800 ring-2 ring-brand-200' : 'border-line bg-white text-ink-700 hover:border-line-strong hover:bg-paper hover:text-ink-900'}`}>
            <Columns2 size={15} aria-hidden="true" />{t('Bandingkan', 'Compare')}
          </button>
          <Button size="sm" variant="ghost" icon={Save} disabled={disabled} onClick={onSaveVersion}>{t('Simpan versi', 'Save version')}</Button>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-line" />
          {/* Both canvases are shown side by side, so the current one is readable without hovering. */}
          <div className="shrink-0">
            <Segmented<'basic' | 'advanced'> fit label={t('Tampilan kanvas', 'Canvas layout')}
              value={advanced ? 'advanced' : 'basic'} disabled={disabled}
              onChange={(next) => onAdvanced(next === 'advanced')} onLocked={onUpgrade}
              options={[
                { value: 'basic', label: t('Dasar', 'Basic'), icon: AlignLeft },
                { value: 'advanced', label: t('Lanjutan', 'Advanced'), icon: FileText, locked: !canAdvanced, lockedHint: t('Mode lanjutan — paket berbayar', 'Advanced mode — paid plan') },
              ]} />
          </div>
          <ToolButton icon={Download} locked={!canExport} disabled={exporting}
            label={canExport
              ? (exporting ? t('Mengekspor…', 'Exporting…') : t('Ekspor ke DOCX', 'Export to DOCX'))
              : t('Ekspor DOCX — paket berbayar', 'DOCX export — paid plan')}
            onClick={canExport ? onExport : onUpgrade} />
        </div>
        <div className="relative" ref={menuRef}>
          <IconButton icon={EllipsisVertical} label={t('Menu lainnya', 'More')} aria-haspopup="menu" aria-expanded={menu} active={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <div role="menu" aria-label={t('Menu lainnya', 'More')} className="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)] animate-fade-up">
              <div className="border-b border-line pb-1 mb-1 sm:hidden">
                <MenuItem icon={Plus} label={t('Notebook baru', 'New notebook')} onClick={() => { setMenu(false); setCreating(true); }} />
              </div>
              <div className="mb-1 border-b border-line pb-1 lg:hidden">
                <MenuItem icon={Copy} label={t('Salin semua teks', 'Copy all text')} disabled={!canCopy} onClick={pick(onCopy)} />
                <MenuItem icon={Columns2} label={compareLabel} onClick={pick(onCompare)} />
                <MenuItem icon={Save} label={t('Simpan versi', 'Save version')} disabled={disabled} onClick={pick(onSaveVersion)} />
                <MenuItem icon={FileText} locked={!canAdvanced}
                  label={canAdvanced ? (advanced ? t('Mode lanjutan: aktif', 'Advanced mode: on') : t('Mode lanjutan: nonaktif', 'Advanced mode: off')) : t('Mode lanjutan', 'Advanced mode')}
                  disabled={disabled && canAdvanced}
                  onClick={pick(canAdvanced ? () => onAdvanced(!advanced) : onUpgrade)} />
                <MenuItem icon={Download} locked={!canExport}
                  label={exporting ? t('Mengekspor…', 'Exporting…') : t('Ekspor ke DOCX', 'Export to DOCX')}
                  disabled={exporting}
                  onClick={pick(canExport ? onExport : onUpgrade)} />
              </div>
              <MenuItem icon={ChartNoAxesColumn} label={t('Analisis', 'Analytics')} onClick={pick(onAnalytics)} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={Trash2} label={t('Hapus notebook', 'Delete notebook')} danger onClick={pick(onDelete)} />
            </div>
          )}
        </div>
        <span className="ml-1"><AccountMenu /></span>
      </div>
      {creating && <NewNotebookDialog onClose={() => setCreating(false)} />}
    </header>
  );
}
