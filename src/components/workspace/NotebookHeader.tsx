'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft, Check, ChevronDown, ChevronLeft, ClipboardCheck, Columns2, Copy, CopyPlus, Download, EllipsisVertical, Eye, FileCode2, FileCog, FileText,
  Focus, History, Lock, Palette, PanelTop, Plus, Save, Tags, Trash2, Type, type LucideIcon,
  Pin, PinOff,
} from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { DOC_TYPES, docTypeShort, type DocType } from '@/lib/writing/doc-types';
import { Segmented } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { AccountMenu } from '@/components/app/AccountMenu';
import { QuotaPill } from '@/components/app/QuotaPill';
import { useRequiredTierName } from '@/components/app/PaidLock';
import { SaveStatus } from './SaveStatus';
import type { SaveState } from './types';

type PageSize = 'a4' | 'letter';
type Props = {
  title: string; onTitle: (title: string) => void; disabled: boolean; comparing: boolean; save: SaveState;
  docType: string | undefined; onDocType: (type: DocType | null) => void;
  /** Paid surfaces: a locked entry stays visible, names its plan, and explains itself instead of vanishing. */
  canAdvanced: boolean; advanced: boolean; onAdvanced: (next: boolean) => void;
  onSaveVersion: () => void; compareHint: string | null; onCompare: () => void; onHistory: () => void;
  canExport: boolean; exporting: boolean; pageSize: PageSize; onExportDocx: (size: PageSize) => void; onExportHtml: () => void;
  canCopy: boolean; onCopy: () => void; onCopyPlain: () => void;
  onPageSetup: () => void; onHeaderFooter: () => void; onFocus: () => void; onNew: () => void; onDuplicate: () => void; onAppearance: (anchor: HTMLElement | null) => void; onReview: () => void; onDelete: () => void;
  // Sematkan: keeps the notebook in the library's "Disematkan" group.
  pinned?: boolean; onPin?: (pinned: boolean) => void;
  onUpgrade: () => void;
};

type Item = { key: string; icon: LucideIcon; label: string; onSelect: () => void; hint?: string; locked?: boolean; disabled?: boolean; title?: string; danger?: boolean; checked?: boolean; className?: string };
type Section = { key: string; label?: string; items: Item[]; className?: string };

function MenuRow({ item, close }: { item: Item; close: () => void }) {
  const { icon: Icon } = item;
  const tone = item.danger ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : item.locked ? 'text-ink-500 hover:bg-paper-deep focus-visible:bg-paper-deep' : 'text-ink-700 hover:bg-paper-deep focus-visible:bg-paper-deep';
  return (
    <button type="button" role="menuitem" disabled={item.disabled} title={item.title} onClick={() => { close(); item.onSelect(); }}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone} ${item.className ?? ''}`}>
      <Icon size={15} aria-hidden="true" className={`shrink-0 ${item.locked ? 'text-ink-400' : ''}`} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.checked && <Check size={14} aria-hidden="true" className="shrink-0 text-brand-700" />}
      {item.hint && <span className="shrink-0 text-[11px] text-ink-400">{item.hint}</span>}
      {item.locked && <Lock size={13} aria-hidden="true" className="shrink-0 text-ink-400" />}
    </button>
  );
}

// A header dropdown with labelled sections. Closes on outside press or Esc, and hands focus back to its trigger.
function Dropdown({ label, trigger, triggerClassName, sections, width = 'w-60', onOpen }: { label: string; trigger: React.ReactNode; triggerClassName: string; sections: Section[]; width?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const move = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const nodes = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []).filter((node) => node.offsetParent !== null);
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
    nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
  };
  const close = () => setOpen(false);
  const visible = sections.filter((section) => section.items.length);
  return (
    <div ref={root} className="relative">
      <button ref={button} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => { if (!open) onOpen?.(); setOpen(!open); }} className={`${triggerClassName} ${open ? 'ring-2 ring-brand-200' : ''}`}>{trigger}</button>
      {open && (
        <div role="menu" aria-label={label} onKeyDown={move} className={`scrollbar-thin absolute right-0 top-full z-40 mt-1.5 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)] animate-fade-up max-sm:fixed max-sm:inset-x-2 max-sm:top-14 max-sm:mt-0 max-sm:w-auto ${width}`}>
          {visible.map((section, index) => (
            <div key={section.key} className={`${index > 0 ? 'mt-1 border-t border-line pt-1' : ''} ${section.className ?? ''}`}>
              {section.label && <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">{section.label}</p>}
              {section.items.map((item) => <MenuRow key={item.key} item={item} close={close} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PILL = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-[13px] font-semibold text-ink-700 transition-colors hover:border-line-strong hover:bg-paper hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40';

// Logo · "Notebook /" · title · save status · type ▾ · Teks | Halaman · Simpan versi ▾ · Ekspor ▾ · ⋯ · quota · avatar.
// Each action has one home here; the Riwayat tab and preview card keep contextual shortcuts. Narrow screens
// fold the right-hand controls into ⋯, so nothing the desktop offers is missing on a phone.
export function NotebookHeader(props: Props) {
  const { title, onTitle, disabled, comparing, save, docType, onDocType, canAdvanced, advanced, onAdvanced, onSaveVersion, compareHint, onCompare, onHistory,
    canExport, exporting, pageSize, onExportDocx, onExportHtml, canCopy, onCopy, onCopyPlain, onPageSetup, onHeaderFooter, onFocus, onNew, onDuplicate, onAppearance, onReview, onDelete, onUpgrade, pinned = false, onPin } = props;
  const { t } = useLocale();
  const moreRef = useRef<HTMLDivElement>(null);
  const advancedTier = useRequiredTierName('advanced_notebook');
  const exportTier = useRequiredTierName('docx_export');
  const typeLabel = DOC_TYPES.includes(docType as DocType) ? docTypeShort(docType as DocType, t) : t('Jenis', 'Type');
  const compareLabel = comparing ? t('Keluar dari Bandingkan', 'Exit Compare') : t('Bandingkan…', 'Compare…');

  // Word tries the server even without Pro: a notebook exported or imported before a downgrade is still allowed,
  // and a refusal comes back with its reason. HTML follows the same rule.
  const exportItems: Item[] = [
    { key: 'a4', icon: FileText, label: t('Word (.docx) · A4', 'Word (.docx) · A4'), checked: pageSize === 'a4', locked: !canExport, hint: canExport ? undefined : exportTier, disabled: exporting, onSelect: () => onExportDocx('a4'), title: canExport ? undefined : t(`Ekspor DOCX ada di ${exportTier}. Notebook yang pernah diekspor sebelum turun paket tetap bisa.`, `DOCX export is part of ${exportTier}. A notebook exported before a downgrade still can be.`) },
    { key: 'letter', icon: FileText, label: t('Word (.docx) · Letter', 'Word (.docx) · Letter'), checked: pageSize === 'letter', locked: !canExport, hint: canExport ? undefined : exportTier, disabled: exporting, onSelect: () => onExportDocx('letter'), title: canExport ? undefined : t(`Ekspor DOCX ada di ${exportTier}. Notebook yang pernah diekspor sebelum turun paket tetap bisa.`, `DOCX export is part of ${exportTier}. A notebook exported before a downgrade still can be.`) },
    { key: 'copy', icon: Copy, label: t('Salin semua teks', 'Copy all text'), disabled: !canCopy, onSelect: onCopy },
    { key: 'plain', icon: ClipboardCheck, label: t('Salin untuk sosmed', 'Copy for social media'), hint: t('teks polos', 'plain text'), disabled: !canCopy, onSelect: onCopyPlain },
    { key: 'html', icon: FileCode2, label: t('Unduh HTML', 'Download HTML'), locked: !canExport, hint: canExport ? undefined : exportTier, disabled: exporting, onSelect: onExportHtml, title: canExport ? undefined : t(`Unduh HTML ada di ${exportTier}.`, `HTML download is part of ${exportTier}.`) },
  ];
  const versionItems: Item[] = [
    { key: 'compare', icon: Columns2, label: compareLabel, disabled: !comparing && compareHint !== null, title: comparing ? undefined : compareHint ?? undefined, onSelect: onCompare },
    { key: 'history', icon: History, label: t('Lihat riwayat', 'See history'), onSelect: onHistory },
  ];
  const canvasItems: Item[] = [
    { key: 'text', icon: AlignLeft, label: t('Kanvas Teks', 'Text canvas'), checked: !advanced, disabled, onSelect: () => onAdvanced(false) },
    { key: 'page', icon: FileText, label: t('Kanvas Halaman', 'Page canvas'), checked: advanced && canAdvanced, locked: !canAdvanced, hint: canAdvanced ? undefined : advancedTier, disabled: disabled && canAdvanced, onSelect: canAdvanced ? () => onAdvanced(true) : onUpgrade },
  ];
  const typeItems: Item[] = [
    ...DOC_TYPES.map((type) => ({ key: type, icon: Tags, label: docTypeShort(type, t), checked: docType === type, disabled, onSelect: () => onDocType(type) })),
    { key: 'none', icon: Tags, label: t('Tanpa jenis', 'No type'), checked: !DOC_TYPES.includes(docType as DocType), disabled, onSelect: () => onDocType(null) },
  ];

  const moreSections: Section[] = [
    { key: 'new', className: 'sm:hidden', items: [{ key: 'new', icon: Plus, label: t('Tulis baru', 'New writing'), onSelect: onNew }] },
    { key: 'version', className: 'lg:hidden', items: [{ key: 'save', icon: Save, label: t('Simpan versi', 'Save version'), disabled, onSelect: onSaveVersion }, ...versionItems] },
    { key: 'canvas', className: 'lg:hidden', label: t('Kanvas', 'Canvas'), items: canvasItems },
    { key: 'export', className: 'md:hidden', label: t('Ekspor', 'Export'), items: exportItems },
    { key: 'type', className: 'md:hidden', label: t('Jenis tulisan', 'Kind of writing'), items: typeItems },
    { key: 'layout', items: [
      { key: 'setup', icon: FileCog, label: t('Tata letak halaman…', 'Page layout…'), locked: !canAdvanced, hint: canAdvanced ? undefined : advancedTier, disabled: disabled && canAdvanced, onSelect: canAdvanced ? onPageSetup : onUpgrade },
      { key: 'running', icon: PanelTop, label: t('Header & footer…', 'Header & footer…'), locked: !canAdvanced, hint: canAdvanced ? undefined : advancedTier, disabled: disabled && canAdvanced, onSelect: canAdvanced ? onHeaderFooter : onUpgrade },
      { key: 'focus', icon: Focus, label: t('Mode fokus', 'Focus mode'), hint: 'Ctrl+.', onSelect: onFocus },
    ] },
    { key: 'notebook', items: [
      { key: 'duplicate', icon: CopyPlus, label: t('Duplikat notebook', 'Duplicate notebook'), disabled, onSelect: onDuplicate },
      { key: 'appearance', icon: Palette, label: t('Ubah ikon & warna', 'Change icon & colour'), onSelect: () => onAppearance(moreRef.current) },
      ...(onPin ? [{ key: 'pin', icon: pinned ? PinOff : Pin, label: pinned ? t('Lepas sematan', 'Unpin') : t('Sematkan', 'Pin'), onSelect: () => onPin(!pinned) }] : []),
      { key: 'review', icon: Eye, label: t('Tinjau tulisan', 'Review writing'), onSelect: onReview },
    ] },
    { key: 'delete', items: [{ key: 'delete', icon: Trash2, label: t('Pindahkan ke Sampah', 'Move to trash'), danger: true, onSelect: onDelete }] },
  ];

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 bg-shell px-3 sm:gap-2 sm:px-4">
      <span title={t('Ke beranda', 'Go to home')} className="hidden shrink-0 sm:inline"><Logo href="/app" compact /></span>
      {/* The way back to the library; on a phone the arrow replaces the logo. */}
      <nav aria-label={t('Lokasi', 'Breadcrumb')} className="flex shrink-0 items-center">
        <Link href="/notebooks" title={t('Kembali ke semua notebook', 'Back to all notebooks')} className="inline-flex h-9 items-center gap-1 rounded-lg px-1.5 text-[14px] font-medium text-ink-500 transition-colors hover:bg-white/70 hover:text-ink-900 sm:ml-1 md:ml-4">
          <ChevronLeft size={18} aria-hidden="true" className="sm:hidden" /><span className="sr-only sm:not-sr-only">Notebook</span>
        </Link>
        <span aria-hidden="true" className="hidden text-ink-300 sm:inline">/</span>
      </nav>
      <input aria-label={t('Judul notebook', 'Notebook title')} value={title} maxLength={180} disabled={disabled} onChange={(event) => onTitle(event.target.value)} placeholder={t('Notebook tanpa judul', 'Untitled notebook')}
        className="h-10 min-w-0 max-w-md flex-1 truncate rounded-lg bg-transparent px-2 text-[18px] font-medium tracking-[-0.01em] text-ink-950 placeholder:text-ink-400 hover:bg-white/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 sm:text-[20px]" />
      <span className="shrink-0"><SaveStatus state={save} compact /></span>
      <span className="hidden shrink-0 md:block">
        <Dropdown label={t('Jenis tulisan', 'Kind of writing')} width="w-52" sections={[{ key: 'type', items: typeItems }]}
          triggerClassName="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-white/70 px-2.5 text-[12px] font-semibold text-ink-700 transition-colors hover:border-line-strong hover:bg-white"
          trigger={<><Type size={13} aria-hidden="true" className="text-ink-400" />{typeLabel}<ChevronDown size={13} aria-hidden="true" className="text-ink-400" /></>} />
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="hidden shrink-0 lg:block">
          <Segmented<'text' | 'page'> fit size="sm" label={t('Kanvas', 'Canvas')} value={advanced ? 'page' : 'text'} disabled={disabled}
            onChange={(next) => onAdvanced(next === 'page')} onLocked={onUpgrade}
            options={[
              { value: 'text', label: t('Teks', 'Text'), icon: AlignLeft },
              { value: 'page', label: canAdvanced ? t('Halaman', 'Page') : `${t('Halaman', 'Page')} · ${advancedTier}`, icon: FileText, locked: !canAdvanced, lockedHint: t(`Kanvas Halaman — buka dengan ${advancedTier}`, `Page canvas — unlock with ${advancedTier}`) },
            ]} />
        </div>
        {/* Simpan versi is the main action; its arrow holds Bandingkan and Lihat riwayat. */}
        <div className="hidden shrink-0 items-center lg:flex">
          <button type="button" disabled={disabled} onClick={onSaveVersion} className={`${PILL} rounded-r-none border-r-0 pr-2.5`}><Save size={15} aria-hidden="true" />{t('Simpan versi', 'Save version')}</button>
          <Dropdown label={t('Opsi versi', 'Version options')} width="w-56" sections={[{ key: 'version', items: versionItems }]}
            triggerClassName={`${PILL} rounded-l-none px-2 ${comparing ? 'border-brand-300 bg-brand-50 text-brand-800' : ''}`} trigger={<ChevronDown size={14} aria-hidden="true" />} />
        </div>
        <div className="hidden md:block">
          <Dropdown label={t('Ekspor', 'Export')} width="w-64" sections={[{ key: 'export', items: exportItems }]}
            triggerClassName={PILL} trigger={<><Download size={15} aria-hidden="true" />{exporting ? t('Mengekspor…', 'Exporting…') : t('Ekspor', 'Export')}<ChevronDown size={14} aria-hidden="true" className="text-ink-400" /></>} />
        </div>
        <div ref={moreRef}>
          <Dropdown label={t('Menu lainnya', 'More')} width="w-64" sections={moreSections}
            triggerClassName="grid h-9 w-9 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-white/70 hover:text-ink-900" trigger={<EllipsisVertical size={18} aria-hidden="true" />} />
        </div>
        <span className="ml-0.5"><QuotaPill compact /></span>
        <AccountMenu />
      </div>
    </header>
  );
}
