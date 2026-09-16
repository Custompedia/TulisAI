'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChartNoAxesColumn, Columns2, Copy, EllipsisVertical, Plus, Save, Trash2, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Button, IconButton } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { AccountMenu } from '@/components/app/AccountMenu';

type Props = {
  title: string; onTitle: (title: string) => void; disabled: boolean; comparing: boolean; canCopy: boolean;
  onCopy: () => void; onCompare: () => void; onAnalytics: () => void; onSaveVersion: () => void; onDelete: () => void;
};

const NEW_NOTEBOOK = '/app#compose';

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium outline-none transition-colors disabled:opacity-40 ${danger ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : 'text-ink-700 hover:bg-paper-deep focus-visible:bg-paper-deep'}`}>
      <Icon size={15} aria-hidden="true" className="shrink-0" />{label}
    </button>
  );
}

export function NotebookHeader({ title, onTitle, disabled, comparing, canCopy, onCopy, onCompare, onAnalytics, onSaveVersion, onDelete }: Props) {
  const { t } = useLocale();
  const [menu, setMenu] = useState(false);
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
    <header className="flex h-14 shrink-0 items-center gap-2 bg-brand-50 px-3 sm:px-4">
      <span title={t('Ke beranda', 'Go to home')} className="shrink-0"><Logo href="/app" compact /></span>
      <input aria-label={t('Judul notebook', 'Notebook title')} value={title} maxLength={180} disabled={disabled} onChange={(event) => onTitle(event.target.value)} placeholder={t('Notebook tanpa judul', 'Untitled notebook')}
        className="ml-1 h-10 min-w-0 max-w-xl flex-1 truncate rounded-lg bg-transparent px-2 text-[20px] font-medium tracking-[-0.01em] text-ink-950 placeholder:text-ink-400 hover:bg-white/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Link href={NEW_NOTEBOOK} className="hidden h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-[13px] font-medium text-ink-800 transition-colors hover:border-line-strong hover:bg-paper sm:inline-flex">
          <Plus size={16} aria-hidden="true" />Notebook
        </Link>
        <div className="hidden items-center gap-1 lg:flex">
          <Button size="sm" variant="ghost" icon={Copy} disabled={!canCopy} onClick={onCopy}>{t('Salin', 'Copy')}</Button>
          <Button size="sm" variant={comparing ? 'dark' : 'ghost'} icon={Columns2} aria-pressed={comparing} onClick={onCompare}>{t('Bandingkan', 'Compare')}</Button>
          <Button size="sm" variant="ghost" icon={Save} disabled={disabled} onClick={onSaveVersion}>{t('Simpan versi', 'Save version')}</Button>
        </div>
        <div className="relative" ref={menuRef}>
          <IconButton icon={EllipsisVertical} label={t('Menu lainnya', 'More')} aria-haspopup="menu" aria-expanded={menu} active={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <div role="menu" aria-label={t('Menu lainnya', 'More')} className="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)] animate-fade-up">
              <div className="border-b border-line pb-1 mb-1 sm:hidden">
                <Link href={NEW_NOTEBOOK} role="menuitem" onClick={() => setMenu(false)} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-700 hover:bg-paper-deep"><Plus size={15} aria-hidden="true" />{t('Notebook baru', 'New notebook')}</Link>
              </div>
              <div className="mb-1 border-b border-line pb-1 lg:hidden">
                <MenuItem icon={Copy} label={t('Salin semua teks', 'Copy all text')} disabled={!canCopy} onClick={pick(onCopy)} />
                <MenuItem icon={Columns2} label={compareLabel} onClick={pick(onCompare)} />
                <MenuItem icon={Save} label={t('Simpan versi', 'Save version')} disabled={disabled} onClick={pick(onSaveVersion)} />
              </div>
              <MenuItem icon={ChartNoAxesColumn} label={t('Analisis', 'Analytics')} onClick={pick(onAnalytics)} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={Trash2} label={t('Hapus notebook', 'Delete notebook')} danger onClick={pick(onDelete)} />
            </div>
          )}
        </div>
        <span className="ml-1"><AccountMenu /></span>
      </div>
    </header>
  );
}
