'use client';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Link2, List, ListOrdered, Redo2, Underline, Undo2, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';

function Tool({ icon: Icon, label, active = false, disabled, onClick }: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-35 ${active ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-ink-100/70 hover:text-ink-900'}`}>
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />;

export function FormatToolbar({ editor, disabled, onLink }: { editor: Editor; disabled: boolean; onLink: () => void }) {
  const { t } = useLocale();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      heading: e.isActive('heading') ? String(e.getAttributes('heading').level) : 'paragraph',
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), link: e.isActive('link'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'),
      left: e.isActive({ textAlign: 'left' }), center: e.isActive({ textAlign: 'center' }), right: e.isActive({ textAlign: 'right' }),
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label={t('Format teks', 'Text formatting')} className="scrollbar-thin flex items-center gap-0.5 overflow-x-auto">
      <Tool icon={Undo2} label={t('Urungkan', 'Undo')} disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()} />
      <Tool icon={Redo2} label={t('Ulangi', 'Redo')} disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()} />
      <Divider />
      <select aria-label={t('Gaya paragraf', 'Paragraph style')} disabled={disabled} value={state.heading}
        onChange={(event) => (event.target.value === 'paragraph' ? chain().setParagraph().run() : chain().setHeading({ level: Number(event.target.value) as 1 | 2 | 3 }).run())}
        className="h-8 shrink-0 rounded-md bg-transparent px-2 text-[13px] font-medium text-ink-700 hover:bg-ink-100/70 focus:outline-none disabled:opacity-35">
        <option value="paragraph">{t('Teks biasa', 'Normal text')}</option>
        <option value="1">{t('Judul 1', 'Heading 1')}</option>
        <option value="2">{t('Judul 2', 'Heading 2')}</option>
        <option value="3">{t('Judul 3', 'Heading 3')}</option>
      </select>
      <Divider />
      <Tool icon={Bold} label={t('Tebal', 'Bold')} active={state.bold} disabled={disabled} onClick={() => chain().toggleBold().run()} />
      <Tool icon={Italic} label={t('Miring', 'Italic')} active={state.italic} disabled={disabled} onClick={() => chain().toggleItalic().run()} />
      <Tool icon={Underline} label={t('Garis bawah', 'Underline')} active={state.underline} disabled={disabled} onClick={() => chain().toggleUnderline().run()} />
      <Tool icon={Link2} label={t('Tautan', 'Link')} active={state.link} disabled={disabled} onClick={onLink} />
      <Divider />
      <Tool icon={AlignLeft} label={t('Rata kiri', 'Align left')} active={state.left} disabled={disabled} onClick={() => chain().setTextAlign('left').run()} />
      <Tool icon={AlignCenter} label={t('Rata tengah', 'Align center')} active={state.center} disabled={disabled} onClick={() => chain().setTextAlign('center').run()} />
      <Tool icon={AlignRight} label={t('Rata kanan', 'Align right')} active={state.right} disabled={disabled} onClick={() => chain().setTextAlign('right').run()} />
      <Divider />
      <Tool icon={List} label={t('Daftar poin', 'Bullet list')} active={state.bullet} disabled={disabled} onClick={() => chain().toggleBulletList().run()} />
      <Tool icon={ListOrdered} label={t('Daftar bernomor', 'Numbered list')} active={state.ordered} disabled={disabled} onClick={() => chain().toggleOrderedList().run()} />
    </div>
  );
}
