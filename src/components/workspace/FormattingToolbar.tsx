'use client';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Columns3, Indent, Italic, Link2, Link2Off,
  List, ListOrdered, Minus, Outdent, Quote, Redo2, RemoveFormatting, Rows3, Table as TableIcon, Trash2, Underline,
  Undo2, type LucideIcon,
} from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Menu, type MenuItem } from '@/components/ui/Menu';

// The editor always supported this formatting; there was simply no toolbar for it, so it was reachable only by
// keyboard. Everything here drives TipTap commands that already exist — no new editor library involved.

type Props = { editor: Editor | null; disabled: boolean };

const GROUP = 'flex shrink-0 items-center gap-0.5';
const DIVIDER = 'mx-1 h-5 w-px shrink-0 bg-line';

function Control({ icon: Icon, label, active, disabled, onRun }: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onRun: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={onRun}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200' : 'text-ink-600 hover:bg-paper-deep hover:text-ink-900'}`}>
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

type Block = 'paragraph' | 'h1' | 'h2' | 'h3';

export function FormattingToolbar({ editor, disabled }: Props) {
  const { t } = useLocale();
  // The toolbar reflects the caret, so it has to re-render on every selection and document change.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const refresh = () => bump((value) => value + 1);
    // selectionUpdate and update only: 'transaction' also fires for internal metadata, which cannot change
    // which marks are active and would re-render the toolbar for nothing.
    editor.on('selectionUpdate', refresh); editor.on('update', refresh);
    return () => { editor.off('selectionUpdate', refresh); editor.off('update', refresh); };
  }, [editor]);

  if (!editor) return null;
  const active = editor;
  const off = disabled || !active.isEditable;
  const chain = () => active.chain().focus();

  const blocks: Array<{ value: Block; label: string }> = [
    { value: 'paragraph', label: t('Teks normal', 'Normal text') },
    { value: 'h1', label: t('Judul 1', 'Heading 1') },
    { value: 'h2', label: t('Judul 2', 'Heading 2') },
    { value: 'h3', label: t('Judul 3', 'Heading 3') },
  ];
  const current: Block = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'paragraph';
  const setBlock = (value: Block) => {
    if (value === 'paragraph') chain().setParagraph().run();
    else chain().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  };

  function toggleLink() {
    if (active.isActive('link')) { chain().unsetLink().run(); return; }
    const previous = (active.getAttributes('link').href as string | undefined) ?? 'https://';
    const entered = window.prompt(t('Alamat tautan (http/https)', 'Link address (http/https)'), previous);
    if (entered === null) return;
    const href = entered.trim();
    if (!href) { chain().unsetLink().run(); return; }
    if (!/^https?:\/\//i.test(href)) { window.alert(t('Tautan harus dimulai dengan http:// atau https://', 'A link must start with http:// or https://')); return; }
    chain().setLink({ href }).run();
  }

  const inTable = editor.isActive('table');
  const tableItems: MenuItem[] = [
    { label: t('Tambah baris di atas', 'Insert row above'), icon: Rows3, onSelect: () => chain().addRowBefore().run() },
    { label: t('Tambah baris di bawah', 'Insert row below'), icon: Rows3, onSelect: () => chain().addRowAfter().run() },
    { label: t('Tambah kolom di kiri', 'Insert column left'), icon: Columns3, onSelect: () => chain().addColumnBefore().run() },
    { label: t('Tambah kolom di kanan', 'Insert column right'), icon: Columns3, onSelect: () => chain().addColumnAfter().run() },
    { label: t('Hapus baris', 'Delete row'), icon: Rows3, tone: 'danger', onSelect: () => chain().deleteRow().run() },
    { label: t('Hapus kolom', 'Delete column'), icon: Columns3, tone: 'danger', onSelect: () => chain().deleteColumn().run() },
    { label: t('Hapus tabel', 'Delete table'), icon: Trash2, tone: 'danger', onSelect: () => chain().deleteTable().run() },
  ];

  const alignments: Array<[string, LucideIcon, string]> = [
    ['left', AlignLeft, t('Rata kiri', 'Align left')],
    ['center', AlignCenter, t('Rata tengah', 'Align centre')],
    ['right', AlignRight, t('Rata kanan', 'Align right')],
    ['justify', AlignJustify, t('Rata penuh', 'Justify')],
  ];

  return (
    <div role="toolbar" aria-label={t('Format tulisan', 'Text formatting')} aria-disabled={off}
      className="scrollbar-thin flex min-w-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-white px-2 py-1">
      <div className={GROUP}>
        <Control icon={Undo2} label={t('Urungkan', 'Undo')} disabled={off || !active.can().undo()} onRun={() => chain().undo().run()} />
        <Control icon={Redo2} label={t('Ulangi', 'Redo')} disabled={off || !active.can().redo()} onRun={() => chain().redo().run()} />
      </div>
      <span aria-hidden="true" className={DIVIDER} />
      <label className="sr-only" htmlFor="ww-block-style">{t('Gaya paragraf', 'Paragraph style')}</label>
      <div className="relative shrink-0">
        <select id="ww-block-style" value={current} disabled={off} onChange={(event) => setBlock(event.target.value as Block)}
          className="h-8 w-[8.5rem] appearance-none rounded-md border border-line bg-white pl-2 pr-7 text-[13px] font-medium text-ink-800 transition-colors hover:border-line-strong focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-40">
          {blocks.map((block) => <option key={block.value} value={block.value}>{block.label}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" />
      </div>

      <span aria-hidden="true" className={DIVIDER} />
      <div className={GROUP}>
        <Control icon={Bold} label={t('Tebal', 'Bold')} active={editor.isActive('bold')} disabled={off} onRun={() => chain().toggleBold().run()} />
        <Control icon={Italic} label={t('Miring', 'Italic')} active={editor.isActive('italic')} disabled={off} onRun={() => chain().toggleItalic().run()} />
        <Control icon={Underline} label={t('Garis bawah', 'Underline')} active={editor.isActive('underline')} disabled={off} onRun={() => chain().toggleUnderline().run()} />
        <Control icon={editor.isActive('link') ? Link2Off : Link2} label={editor.isActive('link') ? t('Hapus tautan', 'Remove link') : t('Tautan', 'Link')} active={editor.isActive('link')} disabled={off} onRun={toggleLink} />
      </div>

      <span aria-hidden="true" className={DIVIDER} />
      <div className={GROUP}>
        {alignments.map(([value, icon, label]) => (
          <Control key={value} icon={icon} label={label} disabled={off}
            active={editor.isActive({ textAlign: value }) || (value === 'left' && !editor.isActive({ textAlign: 'center' }) && !editor.isActive({ textAlign: 'right' }) && !editor.isActive({ textAlign: 'justify' }))}
            onRun={() => chain().setTextAlign(value).run()} />
        ))}
      </div>

      <span aria-hidden="true" className={DIVIDER} />
      <div className={GROUP}>
        <Control icon={List} label={t('Daftar poin', 'Bulleted list')} active={editor.isActive('bulletList')} disabled={off} onRun={() => chain().toggleBulletList().run()} />
        <Control icon={ListOrdered} label={t('Daftar bernomor', 'Numbered list')} active={editor.isActive('orderedList')} disabled={off} onRun={() => chain().toggleOrderedList().run()} />
        <Control icon={Quote} label={t('Kutipan', 'Quote')} active={editor.isActive('blockquote')} disabled={off} onRun={() => chain().toggleBlockquote().run()} />
        <Control icon={Outdent} label={t('Kurangi indentasi', 'Decrease indent')} disabled={off || !active.can().liftListItem('listItem')} onRun={() => chain().liftListItem('listItem').run()} />
        <Control icon={Indent} label={t('Tambah indentasi', 'Increase indent')} disabled={off || !active.can().sinkListItem('listItem')} onRun={() => chain().sinkListItem('listItem').run()} />
      </div>

      <span aria-hidden="true" className={DIVIDER} />
      <div className={GROUP}>
        {inTable ? (
          <Menu label={t('Ubah tabel', 'Edit table')} align="start" disabled={off} items={tableItems}
            triggerClassName="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-800 ring-1 ring-brand-200 transition-colors hover:bg-brand-100 disabled:opacity-40"
            trigger={<TableIcon size={15} aria-hidden="true" />} />
        ) : (
          <Control icon={TableIcon} label={t('Sisipkan tabel 3×3', 'Insert 3×3 table')} disabled={off} onRun={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        )}
        <Control icon={Minus} label={t('Garis pemisah', 'Divider')} disabled={off} onRun={() => chain().setHorizontalRule().run()} />
        <Control icon={RemoveFormatting} label={t('Hapus format', 'Clear formatting')} disabled={off} onRun={() => chain().unsetAllMarks().clearNodes().run()} />
      </div>
    </div>
  );
}
