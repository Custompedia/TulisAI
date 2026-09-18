import { EditorDocumentSchema } from '../contracts';
import { Fragment } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { documentText, type EditorDocument, type EditorNode } from './document';
import { clipboardStyle, withAlignment, type ClipboardMode, type ClipboardStyle } from './clipboard-style';
import { safeLength } from './extensions/paragraph-format';
import { BULLET_STYLES } from './extensions/list-style';
import { OWN_CLIPBOARD_ATTRIBUTE, OWN_STYLE_ATTRIBUTE, TASK_GLYPH_ATTRIBUTE } from './paste-normalize';

// Copying wrote text/plain only, so headings, bold, lists and tables were lost on paste into Word or Docs.
// The HTML now also carries the canvas spacing as inline CSS, because without it the destination app applies
// its own defaults and the paste does not match what the writer saw.
//
// This is a separate string serializer on purpose: documentText() and mapping() define the offsets every AI
// anchor and the server SOURCE_MISMATCH check depend on, and must keep flattening exactly as they do.

type Mark = NonNullable<EditorNode['marks']>[number];

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, '&quot;');

const MARK_TAGS: Record<string, string> = { bold: 'strong', italic: 'em', underline: 'u', subscript: 'sub', superscript: 'sup' };
const TEXT_STYLE: Record<string, string> = { fontFamily: 'font-family', fontSize: 'font-size', color: 'color', backgroundColor: 'background-color' };
// Same attribute to CSS mapping as the ParagraphFormat extension, so the paste parses back to the same attrs.
const FORMAT_STYLE: Record<string, string> = { lineHeight: 'line-height', spaceBefore: 'margin-top', spaceAfter: 'margin-bottom', indentLeft: 'margin-left', indentRight: 'margin-right', indentFirstLine: 'text-indent' };
const OL_CSS: Record<string, string> = { 1: 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' };
const attribute = (declarations: string) => (declarations ? ` style="${escapeAttribute(declarations)}"` : '');
// Destination apps read `style`; our own paste reads the exact node attrs from data-ww-style instead.
const exact = (declarations: string) => (declarations ? ` ${OWN_STYLE_ATTRIBUTE}="${escapeAttribute(declarations)}"` : '');
const cssValue = (value: unknown) => (typeof value === 'string' && value.trim() && !/[;{}<>\\]|url\(|expression/iu.test(value) ? value.trim() : null);
const cssColor = (value: unknown) => {
  const color = cssValue(value);
  return color && (/^#[\da-f]{3,8}$/iu.test(color) || /^rgba?\([\d\s.,%]+\)$/iu.test(color) || /^[a-z]+$/iu.test(color)) ? color : null;
};

function withMarks(html: string, marks: Mark[] | undefined, style: ClipboardStyle): string {
  if (!marks?.length) return html;
  // Applied outermost-first so the emitted nesting matches the order the marks are stored in.
  return [...marks].reverse().reduce((inner, mark) => {
    switch (mark.type) {
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        return href ? `<a href="${escapeAttribute(href)}"${attribute(style.link)}>${inner}</a>` : inner;
      }
      // Docs reads strike from the CSS, Word and our parser from the tag.
      case 'strike': return `<s style="text-decoration:line-through">${inner}</s>`;
      case 'textStyle': {
        const declarations = Object.entries(TEXT_STYLE).map(([key, css]) => {
          const value = key === 'color' || key === 'backgroundColor' ? cssColor(mark.attrs?.[key]) : cssValue(mark.attrs?.[key]);
          return value ? `${css}:${value};` : '';
        }).join('');
        return declarations ? `<span${attribute(declarations)}>${inner}</span>` : inner;
      }
      case 'highlight': {
        const color = cssColor(mark.attrs?.color);
        // A colourless highlight renders yellow on the canvas; destinations need the colour spelled out.
        return color
          ? `<mark data-color="${escapeAttribute(color)}"${attribute(`background-color:${color};color:inherit;`)}>${inner}</mark>`
          : `<mark${attribute('background-color:#ffff00;color:inherit;')}>${inner}</mark>`;
      }
      default: {
        const tag = MARK_TAGS[mark.type];
        return tag ? `<${tag}>${inner}</${tag}>` : inner;
      }
    }
  }, html);
}

const alignOf = (node: EditorNode) => (typeof node.attrs?.textAlign === 'string' ? node.attrs.textAlign : null);
// The writer's own paragraph attrs, written after the profile so they win in CSS.
const formatOf = (node: EditorNode) => withAlignment(Object.entries(FORMAT_STYLE).map(([key, css]) => {
  const value = safeLength(node.attrs?.[key]);
  return value ? `${css}:${value};` : '';
}).join(''), alignOf(node));

function children(node: EditorNode, style: ClipboardStyle, inList: boolean): string {
  return (node.content ?? []).map((child) => serializeNode(child, style, inList)).join('');
}

function paragraph(node: EditorNode, style: ClipboardStyle, inList: boolean, prefix = ''): string {
  const inner = children(node, style, inList);
  const own = formatOf(node);
  // An empty paragraph needs a non-breaking space or the blank line disappears on paste.
  return `<p${attribute((inList ? style.listItemParagraph : style.paragraph) + own)}${exact(own)}>${prefix}${inner || (prefix ? '' : '&nbsp;')}</p>`;
}

function cell(node: EditorNode, style: ClipboardStyle): string {
  const header = node.type === 'tableHeader';
  const tag = header ? 'th' : 'td';
  const span = (name: 'colspan' | 'rowspan') => {
    const value = node.attrs?.[name];
    return typeof value === 'number' && value > 1 ? ` ${name}="${value}"` : '';
  };
  const widths = Array.isArray(node.attrs?.colwidth) && node.attrs.colwidth.every((width) => typeof width === 'number' && width > 0) ? node.attrs.colwidth as number[] : null;
  const total = widths?.reduce((sum, width) => sum + width, 0);
  const background = cssColor(node.attrs?.background);
  const vertical = typeof node.attrs?.verticalAlign === 'string' && ['top', 'middle', 'bottom'].includes(node.attrs.verticalAlign) ? node.attrs.verticalAlign : null;
  const own = `${background ? `background-color:${background};` : ''}${vertical ? `vertical-align:${vertical};` : ''}`;
  const size = total ? ` colwidth="${widths!.join(',')}" width="${total}"` : '';
  // Cell paragraphs use the tight list spacing so a table does not gain a blank line per cell.
  return `<${tag}${span('colspan')}${span('rowspan')}${size}${attribute((header ? style.headerCell : style.cell) + (total ? `width:${total}px;` : '') + own)}${exact(own)}>${children(node, style, true)}</${tag}>`;
}

function table(node: EditorNode, style: ClipboardStyle): string {
  // Docs sizes columns from <col>, so the first row's widths are restated there when every cell has one.
  const first = node.content?.[0]?.content ?? [];
  const widths = first.flatMap((item) => (Array.isArray(item.attrs?.colwidth) ? item.attrs.colwidth : [null]));
  const columns = widths.length && widths.every((width) => typeof width === 'number' && width > 0) ? `<colgroup>${widths.map((width) => `<col width="${width}" style="width:${width}px" />`).join('')}</colgroup>` : '';
  return `<table border="1" cellspacing="0" cellpadding="0"${attribute(style.table)}>${columns}<tbody>${children(node, style, false)}</tbody></table>`;
}

function serializeNode(node: EditorNode, style: ClipboardStyle, inList = false): string {
  switch (node.type) {
    case 'text': return withMarks(escapeText(node.text ?? ''), node.marks, style);
    case 'hardBreak': return '<br />';
    case 'horizontalRule': return `<hr${attribute(style.rule)} />`;
    // Word's own page-break spelling; Docs and our paste both read it.
    case 'pageBreak': return '<br clear="all" style="mso-special-character:line-break;page-break-before:always" />';
    case 'paragraph': return paragraph(node, style, inList);
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? Math.min(6, Math.max(1, node.attrs.level)) : 1;
      const own = formatOf(node);
      return `<h${level}${attribute(style.heading(level) + own)}${exact(own)}>${children(node, style, inList)}</h${level}>`;
    }
    case 'blockquote': return `<blockquote${attribute(style.blockquote)}>${children(node, style, inList)}</blockquote>`;
    case 'bulletList': {
      const bullet = typeof node.attrs?.listStyle === 'string' && BULLET_STYLES.includes(node.attrs.listStyle as 'disc') ? `list-style-type:${node.attrs.listStyle};` : '';
      return `<ul${attribute(style.list + bullet)}${exact(bullet)}>${children(node, style, true)}</ul>`;
    }
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' && node.attrs.start !== 1 ? ` start="${node.attrs.start}"` : '';
      const type = typeof node.attrs?.type === 'string' && OL_CSS[node.attrs.type] ? node.attrs.type : null;
      return `<ol${start}${type ? ` type="${type}"` : ''}${attribute(style.list + (type ? `list-style-type:${OL_CSS[type]};` : ''))}>${children(node, style, true)}</ol>`;
    }
    case 'listItem': return `<li>${children(node, style, true)}</li>`;
    case 'taskList': return `<ul data-type="taskList"${attribute(`${style.list}list-style-type:none;`)}>${children(node, style, true)}</ul>`;
    case 'taskItem': {
      const checked = node.attrs?.checked === true;
      const glyph = `<span ${TASK_GLYPH_ATTRIBUTE}="">${checked ? '\u2611' : '\u2610'} </span>`;
      const [first, ...rest] = node.content ?? [];
      const head = first?.type === 'paragraph' ? paragraph(first, style, true, glyph) : `${glyph}${first ? serializeNode(first, style, true) : ''}`;
      return `<li data-type="taskItem" data-checked="${checked}">${head}${rest.map((child) => serializeNode(child, style, true)).join('')}</li>`;
    }
    case 'table': return table(node, style);
    case 'tableRow': return `<tr>${children(node, style, inList)}</tr>`;
    case 'tableHeader':
    case 'tableCell': return cell(node, style);
    default: return children(node, style, inList);
  }
}

export type HtmlOptions = { mode?: ClipboardMode };

// A full HTML fragment for the clipboard; unknown nodes fall through to their children rather than being dropped.
// The wrapper carries the font and line height so every block inherits the canvas defaults.
export function documentHtml(value: unknown, options: HtmlOptions = {}): string {
  const document: EditorDocument = EditorDocumentSchema.parse(value);
  const style = clipboardStyle(options.mode ?? 'plain');
  const body = document.content.map((node) => serializeNode(node, style)).join('');
  return `<div${attribute(style.root)} ${OWN_CLIPBOARD_ATTRIBUTE}=""${exact('white-space:pre-wrap;')}>${body}</div>`;
}

export type CopyResult = 'rich' | 'plain';

// Writes both flavours so a paste into Word or Docs keeps the formatting and the spacing, while a paste into
// a terminal stays readable. Falls back to plain text wherever ClipboardItem is missing or the write is refused.
export async function copyRichText(value: unknown, plain: string, options: HtmlOptions = {}): Promise<CopyResult> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard) throw new Error('Clipboard unavailable');
  if (typeof ClipboardItem === 'function' && typeof clipboard.write === 'function') {
    try {
      const html = `<meta charset="utf-8">${documentHtml(value, options)}`;
      await clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
      return 'rich';
    } catch { /* falls through to plain text below */ }
  }
  await clipboard.writeText(plain);
  return 'plain';
}

// The selected slice as a standalone document: open ends are wrapped in the nearest ancestor that accepts them,
// so a partial paragraph keeps its attrs and a run of list items or table rows keeps its list or table.
export function selectionDocument(state: EditorState): EditorDocument | null {
  const { selection, doc } = state;
  if (selection.empty) return null;
  let fragment = selection.content().content;
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0 && !doc.type.validContent(fragment); depth--) {
    const ancestor = $from.node(depth);
    if (ancestor.type.validContent(fragment)) fragment = Fragment.from(ancestor.copy(fragment));
  }
  if (!doc.type.validContent(fragment)) return null;
  return EditorDocumentSchema.parse({ type: 'doc', content: fragment.toJSON() });
}

// Ctrl+C / Ctrl+X: our HTML and plain text replace ProseMirror's, so Docs and Word receive the same styled copy
// as the Salin button. Returns false to let ProseMirror's default run when the slice cannot be serialized.
export function handleClipboardEvent(view: EditorView, event: ClipboardEvent, options: HtmlOptions & { cut?: boolean } = {}): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  let html: string, plain: string;
  try {
    const document = selectionDocument(view.state);
    if (!document) return false;
    html = `<meta charset="utf-8">${documentHtml(document, options)}`;
    plain = documentText(document);
  } catch { return false; }
  event.preventDefault();
  data.clearData();
  data.setData('text/html', html);
  data.setData('text/plain', plain);
  if (options.cut && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  return true;
}
