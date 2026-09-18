'use client';
import { useEffect, useEffectEvent, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, EllipsisVertical, Highlighter, Indent, Italic,
  List, ListChecks, ListOrdered, Minus, Outdent, PaintRoller, Plus, Redo2, RemoveFormatting, Search, SeparatorHorizontal,
  SpellCheck, Strikethrough, Subscript, Superscript, Underline, Undo2, UnfoldVertical, type LucideIcon,
} from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { DEFAULT_FONT_POINTS } from '@/lib/docx/office-defaults';
import { setSpellcheck, spellcheckKey } from '@/lib/editor/extensions/spellcheck';
import { ColorPicker } from './toolbar/ColorPicker';
import { FindReplace } from './toolbar/FindReplace';
import { LinkPopover } from './toolbar/LinkPopover';
import { TableButton } from './toolbar/TableTools';
import { ACTIVE, Chevron, ChoiceList, CONTROL, Control, DIVIDER, IDLE, keepSelection, Popover, type Choice } from './toolbar/Popover';
import { ZOOM_LEVELS, type Zoom } from './toolbar/zoom';
import {
  applyFormat, canShiftIndent, captureFormat, clearFormatting, currentBlockStyle, DEFAULT_SPACE_AFTER, FONT_SIZES, FONTS, LINE_SPACINGS,
  lineHeightFor, lineMultiple, paragraphSpacing, selectionFontFamily, selectionFontSize, setBlockStyle, setFontSize, shiftIndent,
  SPACE_BEFORE_ADDED, stepFontSize, type BlockStyle, type PaintFormat,
} from './toolbar/formatting';

type Props = { editor: Editor | null; disabled: boolean; zoom: Zoom; onZoom: (zoom: Zoom) => void };

const GROUP = 'flex shrink-0 items-center gap-0.5';
const LABEL_IDLE = 'text-ink-800 enabled:hover:bg-paper-deep';
// Unset <mark> colour in globals.css, shown on the highlight button when the mark carries none.
const DEFAULT_HIGHLIGHT = '#fff2cc';
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);

function FontSizeField({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useLocale();
  const size = selectionFontSize(editor);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const shown = draft ?? (size === null ? '' : String(size));
  const commit = (value: string) => {
    const points = Number(value.replace(',', '.'));
    if (value.trim() && Number.isFinite(points) && points > 0) setFontSize(editor, points); else editor.commands.focus();
    setDraft(null); setOpen(false);
  };
  const label = t('Ukuran font', 'Font size');
  return (
    <div className="relative">
      <input value={shown} disabled={disabled} aria-label={label} title={label} inputMode="decimal" maxLength={5}
        onFocus={(event) => { event.target.select(); setOpen(true); }} onBlur={() => { setDraft(null); setOpen(false); }}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d.,]/gu, ''))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(shown); }
          if (event.key === 'Escape') { event.preventDefault(); setDraft(null); setOpen(false); editor.commands.focus(); }
        }}
        className="h-7 w-10 rounded-md border border-line bg-white text-center text-[13px] tabular-nums text-ink-800 transition-colors hover:border-line-strong focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-40" />
      {open && (
        <div role="listbox" aria-label={label} className="scrollbar-thin absolute left-1/2 top-full z-40 mt-1 max-h-72 w-16 -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)]">
          {FONT_SIZES.map((points) => (
            <button key={points} type="button" role="option" aria-selected={size === points} onMouseDown={(event) => { event.preventDefault(); commit(String(points)); }}
              className={`block h-7 w-full rounded-md text-center text-[13px] tabular-nums ${size === points ? 'bg-brand-50 font-semibold text-brand-800' : 'text-ink-700 hover:bg-paper-deep'}`}>{points}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FormattingToolbar({ editor, disabled, zoom, onZoom }: Props) {
  const { t } = useLocale();
  // The toolbar reflects the caret and stored marks, so it re-renders on every transaction.
  const [, bump] = useState(0);
  const [painter, setPainter] = useState<{ format: PaintFormat; sticky: boolean } | null>(null);
  const [find, setFind] = useState<{ replace: boolean; key: number } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const refresh = () => bump((value) => value + 1);
    editor.on('transaction', refresh);
    return () => { editor.off('transaction', refresh); };
  }, [editor]);

  const off = disabled || !editor?.isEditable;
  const openFind = (replace: boolean) => setFind((current) => ({ replace: replace || !!current?.replace, key: (current?.key ?? 0) + 1 }));

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!editor) return;
    if (event.key === 'Escape' && painter) { setPainter(null); return; }
    if (!(isMac() ? event.metaKey : event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'f' && !event.shiftKey) { event.preventDefault(); openFind(false); return; }
    if (key === 'h') { event.preventDefault(); openFind(true); return; }
    if (off || !editor.isFocused) return;
    if (event.code === 'Backslash') { event.preventDefault(); clearFormatting(editor); return; }
    if (!event.shiftKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
      event.preventDefault(); const direction = event.code === 'BracketRight' ? 1 : -1;
      if (canShiftIndent(editor, direction)) shiftIndent(editor, direction); return;
    }
    if (event.shiftKey && (event.code === 'Period' || event.code === 'Comma')) { event.preventDefault(); stepFontSize(editor, event.code === 'Period' ? 1 : -1); }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Paint format: the next mouse selection takes the copied format; a sticky painter stays until Esc or a second press.
  const paint = useEffectEvent(() => {
    if (!editor || !painter || editor.state.selection.empty) return;
    applyFormat(editor, painter.format);
    if (!painter.sticky) setPainter(null);
  });
  useEffect(() => {
    if (!editor || !painter) return;
    const dom = editor.view.dom;
    const onUp = () => { window.setTimeout(paint, 0); };
    dom.addEventListener('mouseup', onUp);
    document.documentElement.setAttribute('data-ww-painting', '');
    return () => { dom.removeEventListener('mouseup', onUp); document.documentElement.removeAttribute('data-ww-painting'); };
  }, [editor, painter]);
  useEffect(() => { if (off) setPainter(null); }, [off]);

  if (!editor) return null;
  const active = editor;
  const chain = () => active.chain().focus();
  const mod = isMac() ? '⌘' : 'Ctrl';

  const styles: Array<{ value: BlockStyle; label: string; style: React.CSSProperties }> = [
    { value: 'normal', label: t('Teks normal', 'Normal text'), style: {} },
    { value: 'title', label: t('Judul', 'Title'), style: { fontSize: 22 } },
    { value: 'subtitle', label: t('Subjudul', 'Subtitle'), style: { fontSize: 16, color: '#666666' } },
    ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({ value: `h${level}` as BlockStyle, label: t(`Judul ${level}`, `Heading ${level}`), style: { fontSize: [20, 17, 15, 14, 13, 13][level - 1], color: level === 3 || level === 6 ? '#1f3763' : '#2f5496' } })),
  ];
  const blockStyle = currentBlockStyle(editor);
  const family = selectionFontFamily(editor);
  const textColor = (editor.getAttributes('textStyle').color as string | undefined) ?? null;
  const highlight = (editor.getAttributes('highlight').color as string | undefined) ?? (editor.isActive('highlight') ? DEFAULT_HIGHLIGHT : null) ?? (editor.getAttributes('textStyle').backgroundColor as string | undefined) ?? null;
  const spellOn = spellcheckKey.getState(editor.state) ?? true;
  const spacing = paragraphSpacing(editor);
  const multiple = lineMultiple(spacing.lineHeight);
  const zoomLabel = zoom === 'fit' ? t('Pas', 'Fit') : `${zoom}%`;

  const alignments: Array<[string, LucideIcon, string, string]> = [
    ['left', AlignLeft, t('Rata kiri', 'Align left'), 'Shift+L'],
    ['center', AlignCenter, t('Rata tengah', 'Align centre'), 'Shift+E'],
    ['right', AlignRight, t('Rata kanan', 'Align right'), 'Shift+R'],
    ['justify', AlignJustify, t('Rata penuh', 'Justify'), 'Shift+J'],
  ];
  const alignment = alignments.find(([value]) => editor.isActive({ textAlign: value })) ?? alignments[0]!;
  const AlignIcon = alignment[1];

  const bulletStyle = (editor.isActive('bulletList') ? (editor.getAttributes('bulletList').listStyle as string | null) : null) ?? 'disc';
  const bulletChoices: Choice[] = [['disc', '●', t('Bulatan', 'Disc')], ['circle', '○', t('Lingkaran', 'Circle')], ['square', '■', t('Kotak', 'Square')]].map(([key, glyph, name]) => ({
    key: key!, label: `${glyph}  ${name}`, checked: editor.isActive('bulletList') && bulletStyle === key,
    onSelect: () => { const run = chain(); if (!active.isActive('bulletList')) run.toggleBulletList(); run.updateAttributes('bulletList', { listStyle: key === 'disc' ? null : key }).run(); },
  }));
  const orderedType = (editor.getAttributes('orderedList').type as string | null) ?? '1';
  const orderedChoices: Choice[] = [['1', '1. 2. 3.'], ['a', 'a. b. c.'], ['A', 'A. B. C.'], ['i', 'i. ii. iii.'], ['I', 'I. II. III.']].map(([key, label]) => ({
    key: key!, label: label!, checked: editor.isActive('orderedList') && orderedType === key,
    onSelect: () => { const run = chain(); if (!active.isActive('orderedList')) run.toggleOrderedList(); run.updateAttributes('orderedList', { type: key === '1' ? null : key }).run(); },
  }));

  const splitTrigger = 'flex h-8 w-4 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const labelTrigger = (width: string) => `flex h-8 ${width} shrink-0 items-center justify-between gap-1 rounded-md px-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40`;

  // Groups collapse into the ⋮ panel right to left as the toolbar narrows; each pair of classes must stay in step.
  const groups: Array<{ id: string; bar: string; panel: string; divider: boolean; render: () => React.ReactNode }> = [
    { id: 'history', bar: '', panel: 'hidden', divider: false, render: () => <>
      <Control icon={Search} label={t('Cari dan ganti', 'Find and replace')} shortcut={`${mod}+F`} active={!!find} onRun={() => (find ? setFind(null) : openFind(false))} />
      <Control icon={Undo2} label={t('Urungkan', 'Undo')} shortcut={`${mod}+Z`} disabled={off || !active.can().undo()} onRun={() => chain().undo().run()} />
      <Control icon={Redo2} label={t('Ulangi', 'Redo')} shortcut={`${mod}+Y`} disabled={off || !active.can().redo()} onRun={() => chain().redo().run()} />
    </> },
    { id: 'tools', bar: '@max-[813px]:hidden', panel: 'hidden @max-[813px]:flex', divider: false, render: () => <>
      <Control icon={SpellCheck} label={spellOn ? t('Matikan periksa ejaan', 'Turn spell check off') : t('Nyalakan periksa ejaan', 'Turn spell check on')} active={spellOn} onRun={() => setSpellcheck(active.view, !spellOn)} />
      <Control icon={PaintRoller} label={t('Salin format (klik dua kali untuk mengunci)', 'Paint format (double-click to lock)')} active={!!painter} disabled={off}
        onRun={(event) => { if (event.detail >= 2) setPainter({ format: captureFormat(active), sticky: true }); else setPainter(painter ? null : { format: captureFormat(active), sticky: false }); }} />
    </> },
    { id: 'zoom', bar: '@max-[890px]:hidden', panel: 'hidden @max-[890px]:flex', divider: true, render: () => (
      <Popover label={t('Perbesaran', 'Zoom')} triggerClassName={labelTrigger('w-[64px]')} idleClassName={LABEL_IDLE} trigger={<><span className="tabular-nums">{zoomLabel}</span><Chevron /></>}>
        {(close) => <ChoiceList close={close} items={[
          { key: 'fit', label: t('Pas lebar', 'Fit width'), checked: zoom === 'fit', onSelect: () => onZoom('fit') },
          ...ZOOM_LEVELS.map((level) => ({ key: String(level), label: `${level}%`, checked: zoom === level, onSelect: () => onZoom(level) })),
        ]} />}
      </Popover>
    ) },
    { id: 'style', bar: '@max-[435px]:hidden', panel: 'hidden @max-[435px]:flex', divider: true, render: () => (
      <Popover label={t('Gaya paragraf', 'Paragraph style')} disabled={off} triggerClassName={labelTrigger('w-[112px]')} idleClassName={LABEL_IDLE}
        trigger={<><span className="truncate">{styles.find((style) => style.value === blockStyle)?.label}</span><Chevron /></>}>
        {(close) => <div className="w-56"><ChoiceList close={close} items={styles.map((style) => ({ key: style.value, label: style.label, style: style.style, checked: style.value === blockStyle, onSelect: () => setBlockStyle(active, style.value) }))} /></div>}
      </Popover>
    ) },
    { id: 'font', bar: '@max-[564px]:hidden', panel: 'hidden @max-[564px]:flex', divider: true, render: () => (
      <Popover label={t('Font', 'Font')} disabled={off} triggerClassName={labelTrigger('w-[116px]')} idleClassName={LABEL_IDLE}
        trigger={<><span className="truncate" style={{ fontFamily: FONTS.find((font) => font.name === family)?.stack }}>{family ?? ''}</span><Chevron /></>}>
        {(close) => <div className="w-56"><ChoiceList close={close} items={[
          ...FONTS.map((font) => ({ key: font.name, label: font.name, style: { fontFamily: font.stack, fontSize: 14 }, checked: family === font.name, onSelect: () => chain().setFontFamily(font.stack).run() })),
          { key: 'reset', label: t('Font bawaan', 'Default font'), checked: false, onSelect: () => chain().unsetFontFamily().run() },
        ]} /></div>}
      </Popover>
    ) },
    { id: 'size', bar: '@max-[685px]:hidden', panel: 'hidden @max-[685px]:flex', divider: true, render: () => <>
      <Control icon={Minus} label={t('Perkecil ukuran font', 'Decrease font size')} shortcut={`${mod}+Shift+<`} disabled={off || (selectionFontSize(active) ?? DEFAULT_FONT_POINTS) <= 1} onRun={() => stepFontSize(active, -1)} />
      <FontSizeField editor={active} disabled={off} />
      <Control icon={Plus} label={t('Perbesar ukuran font', 'Increase font size')} shortcut={`${mod}+Shift+>`} disabled={off} onRun={() => stepFontSize(active, 1)} />
    </> },
    { id: 'marks', bar: '', panel: 'hidden', divider: true, render: () => <>
      <Control icon={Bold} label={t('Tebal', 'Bold')} shortcut={`${mod}+B`} active={editor.isActive('bold')} disabled={off} onRun={() => chain().toggleBold().run()} />
      <Control icon={Italic} label={t('Miring', 'Italic')} shortcut={`${mod}+I`} active={editor.isActive('italic')} disabled={off} onRun={() => chain().toggleItalic().run()} />
      <Control icon={Underline} label={t('Garis bawah', 'Underline')} shortcut={`${mod}+U`} active={editor.isActive('underline')} disabled={off} onRun={() => chain().toggleUnderline().run()} />
      <Control icon={Strikethrough} label={t('Coret', 'Strikethrough')} shortcut={`${mod}+Shift+S`} active={editor.isActive('strike')} disabled={off} onRun={() => chain().toggleStrike().run()} />
    </> },
    { id: 'colors', bar: '@max-[745px]:hidden', panel: 'hidden @max-[745px]:flex', divider: false, render: () => <>
      <ColorPicker icon={Baseline} label={t('Warna teks', 'Text colour')} value={textColor} fallback="#000000" resetLabel={t('Reset', 'Reset')} disabled={off}
        onPick={(color) => chain().setColor(color).run()} onReset={() => chain().unsetColor().run()} />
      <ColorPicker icon={Highlighter} label={t('Warna sorotan', 'Highlight colour')} value={highlight} fallback="transparent" resetLabel={t('Tidak ada', 'None')} resetIcon="none" disabled={off}
        onPick={(color) => chain().unsetBackgroundColor().setHighlight({ color }).run()} onReset={() => chain().unsetHighlight().unsetBackgroundColor().run()} />
    </> },
    { id: 'link', bar: '@max-[930px]:hidden', panel: 'hidden @max-[930px]:flex', divider: true, render: () => <LinkPopover editor={active} disabled={off} /> },
    { id: 'paragraph', bar: '@max-[1150px]:hidden', panel: 'hidden @max-[1150px]:flex', divider: true, render: () => <>
      <Popover label={t('Perataan', 'Align')} disabled={off} role="menu" trigger={<><AlignIcon size={15} aria-hidden="true" /><Chevron /></>}>
        {(close) => (
          <div className="flex gap-0.5">
            {alignments.map(([value, Icon, label, keys]) => (
              <button key={value} type="button" role="menuitemradio" aria-checked={alignment[0] === value} title={`${label} (${mod}+${keys})`} aria-label={label}
                onMouseDown={keepSelection} onClick={() => { close(); chain().setTextAlign(value).run(); }}
                className={`${CONTROL} ${alignment[0] === value ? ACTIVE : IDLE}`}><Icon size={15} aria-hidden="true" /></button>
            ))}
          </div>
        )}
      </Popover>
      <Popover label={t('Spasi baris & paragraf', 'Line & paragraph spacing')} disabled={off} triggerClassName={CONTROL} trigger={<UnfoldVertical size={15} aria-hidden="true" />}>
        {(close) => <div className="w-64">
          <ChoiceList close={close} items={LINE_SPACINGS.map((value) => ({
            key: String(value), label: value === 1 ? t('Tunggal', 'Single') : value === 2 ? t('Ganda', 'Double') : String(value).replace('.', t(',', '.')),
            checked: multiple !== null && Math.abs(multiple - value) < 0.025, onSelect: () => chain().setParagraphFormat({ lineHeight: lineHeightFor(value) }).run(),
          }))} />
          <div role="separator" className="my-1 h-px bg-line" />
          <ChoiceList close={close} checkable={false} items={[
            spacing.before > 0
              ? { key: 'before', label: t('Hapus spasi sebelum paragraf', 'Remove space before paragraph'), onSelect: () => chain().setParagraphFormat({ spaceBefore: spacing.baseBefore > 0 ? '0pt' : null }).run() }
              : { key: 'before', label: t('Tambah spasi sebelum paragraf', 'Add space before paragraph'), onSelect: () => chain().setParagraphFormat({ spaceBefore: spacing.baseBefore > 0 ? null : SPACE_BEFORE_ADDED }).run() },
            spacing.after > 0
              ? { key: 'after', label: t('Hapus spasi setelah paragraf', 'Remove space after paragraph'), onSelect: () => chain().setParagraphFormat({ spaceAfter: spacing.baseAfter > 0 ? '0pt' : null }).run() }
              : { key: 'after', label: t('Tambah spasi setelah paragraf', 'Add space after paragraph'), onSelect: () => chain().setParagraphFormat({ spaceAfter: spacing.baseAfter > 0 ? null : `${DEFAULT_SPACE_AFTER}pt` }).run() },
          ]} />
        </div>}
      </Popover>
      <Control icon={ListChecks} label={t('Daftar periksa', 'Checklist')} shortcut={`${mod}+Shift+9`} active={editor.isActive('taskList')} disabled={off} onRun={() => chain().toggleTaskList().run()} />
      <span className="flex items-center">
        <Control icon={List} label={t('Daftar poin', 'Bulleted list')} shortcut={`${mod}+Shift+8`} active={editor.isActive('bulletList')} disabled={off} onRun={() => chain().toggleBulletList().run()} />
        <Popover label={t('Gaya poin', 'Bullet style')} disabled={off} triggerClassName={splitTrigger} trigger={<Chevron />}>
          {(close) => <div className="w-44"><ChoiceList close={close} items={bulletChoices} /></div>}
        </Popover>
      </span>
      <span className="flex items-center">
        <Control icon={ListOrdered} label={t('Daftar bernomor', 'Numbered list')} shortcut={`${mod}+Shift+7`} active={editor.isActive('orderedList')} disabled={off} onRun={() => chain().toggleOrderedList().run()} />
        <Popover label={t('Gaya penomoran', 'Numbering style')} disabled={off} triggerClassName={splitTrigger} trigger={<Chevron />}>
          {(close) => <div className="w-44"><ChoiceList close={close} items={orderedChoices} /></div>}
        </Popover>
      </span>
    </> },
    { id: 'indent', bar: '@max-[1252px]:hidden', panel: 'hidden @max-[1252px]:flex', divider: false, render: () => <>
      <Control icon={Outdent} label={t('Kurangi indentasi', 'Decrease indent')} shortcut={`${mod}+[`} disabled={off || !canShiftIndent(active, -1)} onRun={() => shiftIndent(active, -1)} />
      <Control icon={Indent} label={t('Tambah indentasi', 'Increase indent')} shortcut={`${mod}+]`} disabled={off || !canShiftIndent(active, 1)} onRun={() => shiftIndent(active, 1)} />
      <Control icon={RemoveFormatting} label={t('Hapus format', 'Clear formatting')} shortcut={`${mod}+\\`} disabled={off} onRun={() => clearFormatting(active)} />
    </> },
    { id: 'insert', bar: '@max-[1390px]:hidden', panel: 'hidden @max-[1390px]:flex', divider: true, render: () => <>
      <Control icon={Superscript} label={t('Superskrip', 'Superscript')} shortcut={`${mod}+.`} active={editor.isActive('superscript')} disabled={off} onRun={() => chain().toggleSuperscript().run()} />
      <Control icon={Subscript} label={t('Subskrip', 'Subscript')} shortcut={`${mod}+,`} active={editor.isActive('subscript')} disabled={off} onRun={() => chain().toggleSubscript().run()} />
      <TableButton editor={active} disabled={off} />
      <Control icon={Minus} label={t('Garis horizontal', 'Horizontal line')} disabled={off} onRun={() => chain().setHorizontalRule().run()} />
      <Control icon={SeparatorHorizontal} label={t('Hentian halaman', 'Page break')} shortcut={`${mod}+Enter`} disabled={off} onRun={() => chain().setPageBreak().run()} />
    </> },
  ];

  return (
    <div role="toolbar" aria-label={t('Format tulisan', 'Text formatting')} aria-disabled={off}
      className="@container relative z-20 flex min-w-0 shrink-0 items-center gap-0.5 border-b border-line bg-white px-2 py-1">
      {groups.map((group) => (
        <div key={group.id} className={`${GROUP} ${group.bar}`}>
          {group.divider && <span aria-hidden="true" className={DIVIDER} />}
          {group.render()}
        </div>
      ))}
      <div className="ml-auto hidden shrink-0 items-center @max-[1390px]:flex">
        <span aria-hidden="true" className={DIVIDER} />
        <Popover label={t('Opsi lainnya', 'More options')} role="dialog" focusFirst={false} triggerClassName={CONTROL}
          trigger={<EllipsisVertical size={15} aria-hidden="true" />} align="end" scrollable={false}>
          {() => (
            <div className="flex w-max max-w-[min(22rem,calc(100vw-2rem))] flex-wrap items-center gap-1 p-0.5">
              {groups.map((group) => <div key={group.id} className={`${GROUP} ${group.panel}`}>{group.render()}</div>)}
            </div>
          )}
        </Popover>
      </div>
      {find && <FindReplace editor={editor} replace={find.replace} focusKey={find.key} disabled={off} onClose={() => setFind(null)} />}
    </div>
  );
}
