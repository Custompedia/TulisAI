'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChartNoAxesColumn, Columns2, Ellipsis, History, PanelRightOpen, Save, Trash2, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import type { Mode } from '@/lib/writing/settings';
import { Button, IconButton } from '@/components/ui/Button';
import { modeIcon, modeLabel } from '@/components/writing/modes';
import { SaveStatus } from './SaveStatus';
import type { SaveState } from './types';

type Props = {
  title: string; onTitle: (title: string) => void; mode: Mode; language: 'auto' | 'id' | 'en'; save: SaveState; disabled: boolean;
  panelOpen: boolean; onOpenPanel: () => void; onCompare: () => void; onHistory: () => void; onAnalytics: () => void; onSaveVersion: () => void; onDelete: () => void;
  comparing: boolean;
};

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-paper'}`}><Icon size={16} aria-hidden="true" />{label}</button>;
}

export function WorkspaceHeader({ title, onTitle, mode, language, save, disabled, panelOpen, onOpenPanel, onCompare, onHistory, onAnalytics, onSaveVersion, onDelete, comparing }: Props) {
  const { t } = useLocale();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ModeIcon = modeIcon[mode];

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menuRef.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menu]);

  const pick = (action: () => void) => () => { setMenu(false); action(); };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white px-3 sm:px-4">
      <Link href="/app" aria-label={t('Kembali ke beranda', 'Back to home')} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-100/70 md:hidden"><ArrowLeft size={18} /></Link>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <input aria-label={t('Judul dokumen', 'Document title')} value={title} maxLength={180} disabled={disabled} onChange={(event) => onTitle(event.target.value)} placeholder={t('Dokumen tanpa judul', 'Untitled document')}
          className="min-w-0 max-w-md flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold text-ink-950 hover:bg-paper focus:bg-paper focus:outline-none" />
        <button type="button" onClick={onOpenPanel} title={t('Mode aktif — buka asisten', 'Active mode — open assistant')} className="hidden shrink-0 items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 sm:inline-flex">
          <ModeIcon size={13} aria-hidden="true" />{modeLabel(mode, t)}
        </button>
        <span className="hidden shrink-0 rounded-md bg-paper-deep px-2 py-1 text-xs font-semibold text-ink-600 lg:inline" title={t('Bahasa tulisan', 'Writing language')}>{language === 'auto' ? 'Auto' : language.toUpperCase()}</span>
        <span className="hidden shrink-0 lg:inline"><SaveStatus state={save} /></span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="lg:hidden"><SaveStatus state={save} /></span>
        <div className="hidden items-center gap-1 lg:flex">
          <Button size="sm" variant={comparing ? 'dark' : 'ghost'} icon={Columns2} onClick={onCompare}>{t('Bandingkan', 'Compare')}</Button>
          <Button size="sm" variant="ghost" icon={History} onClick={onHistory}>{t('Riwayat', 'History')}</Button>
          <Button size="sm" variant="ghost" icon={ChartNoAxesColumn} onClick={onAnalytics}>{t('Analisis', 'Analytics')}</Button>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
          <Button size="sm" icon={Save} disabled={disabled} onClick={onSaveVersion}>{t('Simpan Versi', 'Save Version')}</Button>
        </div>
        <div className="relative" ref={menuRef}>
          <IconButton icon={Ellipsis} label={t('Menu lainnya', 'More')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-white p-1.5 shadow-xl animate-fade-up">
              <div className="lg:hidden">
                <MenuItem icon={Columns2} label={t('Bandingkan versi', 'Compare versions')} onClick={pick(onCompare)} />
                <MenuItem icon={History} label={t('Riwayat Versi', 'Version History')} onClick={pick(onHistory)} />
                <MenuItem icon={ChartNoAxesColumn} label={t('Analisis Tulisan', 'Writing Analysis')} onClick={pick(onAnalytics)} />
                <MenuItem icon={Save} label={t('Simpan Versi', 'Save Version')} onClick={pick(onSaveVersion)} />
                <div className="my-1 h-px bg-line" />
              </div>
              <MenuItem icon={Trash2} label={t('Hapus dokumen', 'Delete document')} danger onClick={pick(onDelete)} />
            </div>
          )}
        </div>
        {!panelOpen && <Button size="sm" variant="primary" icon={PanelRightOpen} onClick={onOpenPanel}><span className="hidden sm:inline">{t('Asisten AI', 'AI assistant')}</span></Button>}
      </div>
    </header>
  );
}
