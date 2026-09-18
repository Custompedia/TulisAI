import type { Editor } from '@tiptap/react';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { DEFAULT_FONT, DEFAULT_FONT_POINTS, FONT_LINE_HEIGHT, HEADINGS, SPACE_AFTER_TWIPS, SPACE_BEFORE_TWIPS, TWIPS_PER_POINT } from '@/lib/docx/office-defaults';
import { PARAGRAPH_FORMAT_KEYS } from '@/lib/editor/extensions/paragraph-format';

export type BlockStyle = 'normal' | 'title' | 'subtitle' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
// Title and Subtitle are Normal paragraphs with Docs' preset run formatting, so they need no schema change.
export const TITLE = { fontSize: '26pt' };
export const SUBTITLE = { fontSize: '15pt', color: '#666666' };

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 400;
export const INDENT_STEP = 36;
export const LINE_SPACINGS = [1, 1.15, 1.5, 2];
export const SPACE_BEFORE_ADDED = '10pt';
export const DEFAULT_SPACE_AFTER = SPACE_AFTER_TWIPS / TWIPS_PER_POINT;

export type FontOption = { name: string; stack: string };
// Calibri and Cambria are not redistributable: Calibri renders with its metric twin Carlito (see globals.css).
export const FONTS: FontOption[] = [
  { name: 'Arial', stack: 'Arial, sans-serif' },
  { name: 'Calibri', stack: 'Calibri, Carlito, sans-serif' },
  { name: 'Cambria', stack: 'Cambria, Caladea, Georgia, serif' },
  { name: 'Comic Sans MS', stack: "'Comic Sans MS', 'Comic Neue', cursive" },
  { name: 'Courier New', stack: "'Courier New', Courier, monospace" },
  { name: 'Garamond', stack: "Garamond, 'EB Garamond', serif" },
  { name: 'Georgia', stack: 'Georgia, serif' },
  { name: 'Roboto', stack: 'Roboto, Arial, sans-serif' },
  { name: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif' },
  { name: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  { name: 'Trebuchet MS', stack: "'Trebuchet MS', sans-serif" },
  { name: 'Verdana', stack: 'Verdana, sans-serif' },
];

const UNIT_POINTS: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12, em: DEFAULT_FONT_POINTS, rem: DEFAULT_FONT_POINTS };

// Any CSS length the document may carry, in points; bare numbers are px as in inline styles.
export function lengthToPoints(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(-?[\d.]+)\s*([a-z]*)$/iu.exec(value.trim());
  if (!match) return null;
  const number = Number.parseFloat(match[1]!); const factor = UNIT_POINTS[(match[2] || 'px').toLowerCase()];
  return Number.isFinite(number) && factor !== undefined ? number * factor : null;
}

export const roundPoints = (points: number) => Math.round(points * 2) / 2;
export const clampFontSize = (points: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, roundPoints(points)));

// First family of a CSS font-family list, unquoted, so pasted stacks still match a menu entry.
export const primaryFamily = (value: unknown) => typeof value === 'string' ? (value.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/gu, '') : '';

function defaultPoints(block: PMNode) {
  if (block.type.name === 'heading') return HEADINGS[(block.attrs.level as 1 | 2 | 3 | 4 | 5 | 6) ?? 1]?.points ?? DEFAULT_FONT_POINTS;
  return DEFAULT_FONT_POINTS;
}

const textStyle = (marks: readonly Mark[]) => marks.find((mark) => mark.type.name === 'textStyle')?.attrs ?? {};

// One value for every text run in the selection, or null when they differ (the toolbar then shows a blank field).
function uniform<T>(editor: Editor, read: (marks: readonly Mark[], block: PMNode) => T): T | null {
  const { state } = editor; const { selection } = state;
  if (selection.empty) return read(state.storedMarks ?? selection.$from.marks(), selection.$from.parent);
  const values = new Set<T>();
  state.doc.nodesBetween(selection.from, selection.to, (node, _pos, parent) => {
    if (values.size > 1) return false;
    if (node.isText && parent) values.add(read(node.marks, parent));
    return true;
  });
  if (!values.size) return read(selection.$from.marks(), selection.$from.parent);
  return values.size === 1 ? [...values][0]! : null;
}

export const selectionFontSize = (editor: Editor) => uniform(editor, (marks, block) => {
  const points = lengthToPoints(textStyle(marks).fontSize);
  return roundPoints(points ?? defaultPoints(block));
});

export const selectionFontFamily = (editor: Editor) => uniform(editor, (marks) => primaryFamily(textStyle(marks).fontFamily) || DEFAULT_FONT);

export function currentBlockStyle(editor: Editor): BlockStyle {
  for (const level of [1, 2, 3, 4, 5, 6] as const) if (editor.isActive('heading', { level })) return `h${level}`;
  const attrs = editor.getAttributes('textStyle');
  if (attrs.fontSize === TITLE.fontSize) return 'title';
  if (attrs.fontSize === SUBTITLE.fontSize && normalizeColor(attrs.color) === SUBTITLE.color) return 'subtitle';
  return 'normal';
}

// Applies a style to every block the selection touches, including the preset runs for Title and Subtitle.
export function setBlockStyle(editor: Editor, style: BlockStyle) {
  const { selection } = editor.state;
  const from = selection.$from.start(); const to = selection.$to.end();
  const previous = currentBlockStyle(editor);
  let chain = editor.chain().focus();
  chain = style.startsWith('h') ? chain.setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }) : chain.setParagraph();
  const whole = from < to;
  if (whole) chain = chain.setTextSelection({ from, to });
  if (previous === 'title' || previous === 'subtitle') chain = chain.unsetFontSize().unsetColor();
  if (style === 'title') chain = chain.setFontSize(TITLE.fontSize);
  if (style === 'subtitle') chain = chain.setFontSize(SUBTITLE.fontSize).setColor(SUBTITLE.color);
  if (whole) chain = chain.setTextSelection({ from: selection.from, to: selection.to });
  chain.run();
}

export function setFontSize(editor: Editor, points: number) {
  editor.chain().focus().setFontSize(`${clampFontSize(points)}pt`).run();
}

export function stepFontSize(editor: Editor, direction: 1 | -1) {
  const current = selectionFontSize(editor) ?? DEFAULT_FONT_POINTS;
  setFontSize(editor, current + direction);
}

const inListItem = (editor: Editor) => editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;

// Lists nest and un-nest; paragraphs move their left indent in 36 pt steps, never below zero.
export function shiftIndent(editor: Editor, direction: 1 | -1) {
  const item = inListItem(editor);
  if (item) { if (direction > 0) editor.chain().focus().sinkListItem(item).run(); else editor.chain().focus().liftListItem(item).run(); return; }
  editor.chain().focus().command(({ tr, state }) => {
    let changed = false;
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
      const next = Math.max(0, roundPoints((lengthToPoints(node.attrs.indentLeft) ?? 0) + INDENT_STEP * direction));
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentLeft: next > 0 ? `${next}pt` : null }); changed = true;
      return false;
    });
    return changed;
  }).run();
}

export function canShiftIndent(editor: Editor, direction: 1 | -1) {
  const item = inListItem(editor);
  if (item) return direction > 0 ? editor.can().sinkListItem(item) : editor.can().liftListItem(item);
  if (direction > 0) return true;
  const block = editor.state.selection.$from.parent;
  return (lengthToPoints(block.attrs.indentLeft) ?? 0) > 0;
}

// `base*` is what the canvas CSS gives the block with no attribute: headings keep their space before and none after; nested paragraphs have none.
export type ParagraphSpacing = { lineHeight: string | null; before: number; after: number; baseBefore: number; baseAfter: number };
export function paragraphSpacing(editor: Pick<Editor, 'state'>): ParagraphSpacing {
  const { $from } = editor.state.selection; const block = $from.parent;
  const heading = block.type.name === 'heading' ? HEADINGS[block.attrs.level as 1 | 2 | 3 | 4 | 5 | 6] : undefined;
  const baseBefore = (heading?.spaceBefore ?? SPACE_BEFORE_TWIPS) / TWIPS_PER_POINT;
  const baseAfter = heading || $from.depth > 1 ? 0 : DEFAULT_SPACE_AFTER;
  return {
    lineHeight: typeof block.attrs.lineHeight === 'string' ? block.attrs.lineHeight : null,
    before: lengthToPoints(block.attrs.spaceBefore) ?? baseBefore,
    after: lengthToPoints(block.attrs.spaceAfter) ?? baseAfter,
    baseBefore, baseAfter,
  };
}

// Hex or rgb()/rgba() as lowercase #rrggbb, so pasted and imported colours match the palette; fully transparent is no colour.
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  if (!color || color === 'transparent') return null;
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/u.exec(color)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return full.length === 8 && full.endsWith('00') ? null : `#${full.slice(0, 6)}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*([\d.]+)%?)?\s*\)$/u.exec(color);
  if (!rgb) return color;
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((channel) => Math.min(255, Number(channel)).toString(16).padStart(2, '0')).join('')}`;
}

// Text and paragraph formatting go; links and the block type (heading, list) stay, as in Docs.
export function clearFormatting(editor: Editor) {
  let chain = editor.chain().focus();
  for (const name of Object.keys(editor.schema.marks)) if (name !== 'link') chain = chain.unsetMark(name);
  chain.unsetParagraphFormat().unsetTextAlign().run();
}

export type PaintFormat = { marks: readonly Mark[]; block: Record<string, unknown> };
const BLOCK_KEYS = [...PARAGRAPH_FORMAT_KEYS, 'textAlign'];

export function captureFormat(editor: Editor): PaintFormat {
  const { state } = editor; const { selection } = state;
  let marks: readonly Mark[] = state.storedMarks ?? selection.$from.marks();
  let found = false;
  if (!selection.empty) state.doc.nodesBetween(selection.from, selection.to, (node) => { if (found) return false; if (node.isText) { marks = node.marks; found = true; } return !found; });
  const parent = selection.$from.parent;
  return { marks, block: Object.fromEntries(BLOCK_KEYS.filter((key) => key in parent.attrs).map((key) => [key, parent.attrs[key]])) };
}

export function applyFormat(editor: Editor, format: PaintFormat) {
  editor.chain().focus().command(({ tr, state }) => {
    const { from, to } = state.selection;
    if (from === to) return false;
    for (const type of Object.values(state.schema.marks)) if (type.name !== 'link') tr.removeMark(from, to, type);
    for (const mark of format.marks) if (mark.type.name !== 'link') tr.addMark(from, to, mark);
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...Object.fromEntries(Object.entries(format.block).filter(([key]) => key in node.attrs)) });
      return false;
    });
    return true;
  }).run();
}

// Line spacing is stored as CSS line-height, which Word and Docs express as a multiple of the font's own line height.
export const lineHeightFor = (multiple: number) => String(Math.round(multiple * FONT_LINE_HEIGHT * 1000) / 1000);
export const lineMultiple = (lineHeight: string | null) => { const value = Number(lineHeight); return lineHeight && Number.isFinite(value) ? value / FONT_LINE_HEIGHT : null; };

// http/https only; a bare domain gets https:// like Docs does. Returns null for anything else.
export function normalizeLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed) ? trimmed : /^[^/]+\.[^/]+/u.test(trimmed) ? `https://${trimmed}` : null;
  if (!candidate) return null;
  try { const url = new URL(candidate); return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null; } catch { return null; }
}
