'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChartNoAxesColumn, Columns2, Ellipsis, History, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Save, Trash2, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import type { Mode } from '@/lib/writing/settings';
import { Button, IconButton } from '@/components/ui/Button';
import { modeIcon, modeLabel } from '@/components/writing/modes';
import { SaveStatus } from './SaveStatus';
import type { SaveState } from './types';

type Props = {
  title: string; onTitle: (title: string) => void; mode: Mode; words: number; save: SaveState; disabled: boolean; comparing: boolean;
  leftOpen: boolean; rightOpen: boolean; onToggleLeft: () => void; onToggleRight: () => void; onMode: () => void;
  onCompare: () => void; onHistory: () => void; onAnalytics: () => void; onSaveVersion: () => void; onDelete: () => void;
};

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-paper'}`}><Icon size={16} aria-hidden="true" />{label}</button>;
}

export function WorkspaceHeader({ title, onTitle, mode, words, save, disabled, comparing, leftOpen, rightOpen, onToggleLeft, onToggleRight, onMode, onCompare, onHistory, onAnalytics, onSaveVersion, onDelete }: Props) {
  const { t, locale } = useLocale();
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
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-white px-2 sm:px-3">
      <Link href="/projects" aria-label={t('Kembali ke Proyek', 'Back to Projects')} title={t('Kembali ke Proyek', 'Back to Projects')} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink-600 hover:bg-paper-deep hover:text-ink-900">
        <ArrowLeft size={17} aria-hidden="true" /><span className="hidden xl:inline">{t('Proyek', 'Projects')}</span>
      </Link>
      <IconButton icon={leftOpen ? PanelLeftClose : PanelLeftOpen} label={leftOpen ? t('Tutup panel Proyek', 'Close project panel') : t('Buka panel Proyek', 'Open project panel')} aria-expanded={leftOpen} active={leftOpen} onClick={onToggleLeft} />
      <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <input aria-label={t('Judul proyek', 'Project title')} value={title} maxLength={180} disabled={disabled} onChange={(event) => onTitle(event.target.value)} placeholder={t('Dokumen tanpa judul', 'Untitled document')}
          className="min-w-0 max-w-md flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold text-ink-900 hover:bg-paper focus:bg-paper focus:outline-none disabled:opacity-60" />
        <span className="hidden shrink-0 md:inline"><SaveStatus state={save} /></span>
        <button type="button" onClick={onMode} title={t('Mode aktif — buka Asisten AI', 'Active mode — open AI assistant')} className="hidden shrink-0 items-center gap-1.5 rounded-md border border-brand-100 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100 sm:inline-flex">
          <ModeIcon size={13} aria-hidden="true" />{modeLabel(mode, t)}
        </button>
        <span className="hidden shrink-0 text-xs text-ink-500 lg:inline"><b className="font-semibold text-ink-800">{numberFormat(words, locale)}</b> {t('kata', 'words')}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="md:hidden"><SaveStatus state={save} /></span>
        <div className="hidden items-center gap-1 lg:flex">
          <Button size="sm" variant={comparing ? 'dark' : 'ghost'} icon={Columns2} aria-pressed={comparing} onClick={onCompare}>{t('Bandingkan', 'Compare')}</Button>
          <Button size="sm" icon={Save} disabled={disabled} onClick={onSaveVersion}>{t('Simpan Versi', 'Save Version')}</Button>
        </div>
        <div className="relative" ref={menuRef}>
          <IconButton icon={Ellipsis} label={t('Menu lainnya', 'More')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-white p-1.5 shadow-lg animate-fade-up">
              <div className="lg:hidden">
                <MenuItem icon={Columns2} label={comparing ? t('Keluar dari Bandingkan', 'Exit Compare') : t('Bandingkan versi', 'Compare versions')} onClick={pick(onCompare)} />
                <MenuItem icon={History} label={t('Riwayat', 'History')} onClick={pick(onHistory)} />
                <MenuItem icon={Save} label={t('Simpan Versi', 'Save Version')} onClick={pick(onSaveVersion)} />
              </div>
              <MenuItem icon={ChartNoAxesColumn} label={t('Analisis', 'Analytics')} onClick={pick(onAnalytics)} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={Trash2} label={t('Hapus proyek', 'Delete project')} danger onClick={pick(onDelete)} />
            </div>
          )}
        </div>
        <IconButton icon={rightOpen ? PanelRightClose : PanelRightOpen} label={rightOpen ? t('Tutup panel Asisten', 'Close assistant panel') : t('Buka panel Asisten', 'Open assistant panel')} aria-expanded={rightOpen} active={rightOpen} onClick={onToggleRight} />
      </div>
    </header>
  );
}
