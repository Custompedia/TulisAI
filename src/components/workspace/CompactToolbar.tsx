'use client';
import { useEffect, useEffectEvent, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, List, ListOrdered, Redo2, Search, Undo2 } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { FindReplace } from './toolbar/FindReplace';
import { LinkPopover } from './toolbar/LinkPopover';
import { Chevron, ChoiceList, Control, DIVIDER, Popover } from './toolbar/Popover';
import { currentBlockStyle, setBlockStyle, type BlockStyle } from './toolbar/formatting';

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);

// The Teks canvas toolbar, for every plan (owner decision): the schema is shared with Halaman, and markdown input
// and Ctrl+B/I already worked, so this only makes the basics visible. Tautan and Cari & ganti are new on Teks.
export function CompactToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const { t } = useLocale();
  const [, bump] = useState(0);
  const [find, setFind] = useState<{ replace: boolean; key: number } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const refresh = () => bump((value) => value + 1);
    editor.on('transaction', refresh);
    return () => { editor.off('transaction', refresh); };
  }, [editor]);
  const openFind = (replace: boolean) => setFind((current) => ({ replace: replace || !!current?.replace, key: (current?.key ?? 0) + 1 }));
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!editor || !(isMac() ? event.metaKey : event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'f' && !event.shiftKey) { event.preventDefault(); openFind(false); }
    else if (key === 'h') { event.preventDefault(); openFind(true); }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (!editor) return null;
  const active = editor;
  const off = disabled || !editor.isEditable;
  const chain = () => active.chain().focus();
  const mod = isMac() ? '⌘' : 'Ctrl';
  const styles: Array<{ value: BlockStyle; label: string; style: React.CSSProperties }> = [
    { value: 'normal', label: t('Normal', 'Normal'), style: {} },
    { value: 'h1', label: t('Judul 1', 'Heading 1'), style: { fontSize: 20, fontWeight: 600 } },
    { value: 'h2', label: t('Judul 2', 'Heading 2'), style: { fontSize: 17, fontWeight: 600 } },
    { value: 'h3', label: t('Judul 3', 'Heading 3'), style: { fontSize: 15, fontWeight: 600 } },
  ];
  const block = currentBlockStyle(editor);
  const blockLabel = styles.find((style) => style.value === block)?.label ?? t('Normal', 'Normal');

  return (
    <div role="toolbar" aria-label={t('Format dasar', 'Basic formatting')} aria-disabled={off}
      className="relative z-20 flex min-w-0 shrink-0 flex-wrap items-center gap-0.5 border-b border-line bg-white px-2 py-1">
      <Control icon={Undo2} label={t('Urungkan', 'Undo')} shortcut={`${mod}+Z`} disabled={off || !active.can().undo()} onRun={() => chain().undo().run()} />
      <Control icon={Redo2} label={t('Ulangi', 'Redo')} shortcut={`${mod}+Shift+Z`} disabled={off || !active.can().redo()} onRun={() => chain().redo().run()} />
      <span aria-hidden="true" className={DIVIDER} />
      <Popover label={t('Judul', 'Heading')} disabled={off} triggerClassName="flex h-8 w-[104px] shrink-0 items-center justify-between gap-1 rounded-md px-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        idleClassName="text-ink-800 enabled:hover:bg-paper-deep" trigger={<><span className="truncate">{blockLabel}</span><Chevron /></>}>
        {(close) => <div className="w-44"><ChoiceList close={close} items={styles.map((style) => ({ key: style.value, label: style.label, style: style.style, checked: style.value === block, onSelect: () => setBlockStyle(active, style.value) }))} /></div>}
      </Popover>
      <span aria-hidden="true" className={DIVIDER} />
      <Control icon={Bold} label={t('Tebal', 'Bold')} shortcut={`${mod}+B`} active={editor.isActive('bold')} disabled={off} onRun={() => chain().toggleBold().run()} />
      <Control icon={Italic} label={t('Miring', 'Italic')} shortcut={`${mod}+I`} active={editor.isActive('italic')} disabled={off} onRun={() => chain().toggleItalic().run()} />
      <span aria-hidden="true" className={DIVIDER} />
      <Control icon={List} label={t('Daftar poin', 'Bulleted list')} shortcut={`${mod}+Shift+8`} active={editor.isActive('bulletList')} disabled={off} onRun={() => chain().toggleBulletList().run()} />
      <Control icon={ListOrdered} label={t('Daftar bernomor', 'Numbered list')} shortcut={`${mod}+Shift+7`} active={editor.isActive('orderedList')} disabled={off} onRun={() => chain().toggleOrderedList().run()} />
      <LinkPopover editor={active} disabled={off} />
      <span aria-hidden="true" className={DIVIDER} />
      <Control icon={Search} label={t('Cari & ganti', 'Find & replace')} shortcut={`${mod}+F / ${mod}+H`} active={!!find} onRun={() => (find ? setFind(null) : openFind(false))} />
      {find && <FindReplace editor={editor} replace={find.replace} focusKey={find.key} disabled={off} onClose={() => setFind(null)} />}
    </div>
  );
}
