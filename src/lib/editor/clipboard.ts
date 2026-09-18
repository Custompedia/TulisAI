import { EditorDocumentSchema } from '../contracts';
import type { EditorDocument, EditorNode } from './document';
import { clipboardStyle, withAlignment, type ClipboardMode, type ClipboardStyle } from './clipboard-style';

// Copying wrote text/plain only, so headings, bold, lists and tables were lost on paste into Word or Docs.
// The HTML now also carries the canvas spacing as inline CSS, because without it the destination app applies
// its own defaults and the paste does not match what the writer saw.
//
// This is a separate string serializer on purpose: documentText() and mapping() define the offsets every AI
// anchor and the server SOURCE_MISMATCH check depend on, and must keep flattening exactly as they do.

type Mark = NonNullable<EditorNode['marks']>[number];

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, '&quot;');

const MARK_TAGS: Record<string, string> = { bold: 'strong', italic: 'em', underline: 'u' };
const attribute = (declarations: string) => (declarations ? ` style="${escapeAttribute(declarations)}"` : '');

function withMarks(html: string, marks: Mark[] | undefined, style: ClipboardStyle): string {
  if (!marks?.length) return html;
  // Applied outermost-first so the emitted nesting matches the order the marks are stored in.
  return [...marks].reverse().reduce((inner, mark) => {
    if (mark.type === 'link') {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
      return href ? `<a href="${escapeAttribute(href)}"${attribute(style.link)}>${inner}</a>` : inner;
    }
    const tag = MARK_TAGS[mark.type];
    return tag ? `<${tag}>${inner}</${tag}>` : inner;
  }, html);
}

const alignOf = (node: EditorNode) => (typeof node.attrs?.textAlign === 'string' ? node.attrs.textAlign : null);

function children(node: EditorNode, style: ClipboardStyle, inList: boolean): string {
  return (node.content ?? []).map((child) => serializeNode(child, style, inList)).join('');
}

function serializeNode(node: EditorNode, style: ClipboardStyle, inList = false): string {
  switch (node.type) {
    case 'text': return withMarks(escapeText(node.text ?? ''), node.marks, style);
    case 'hardBreak': return '<br />';
    case 'horizontalRule': return `<hr${attribute(style.rule)} />`;
    case 'paragraph': {
      const inner = children(node, style, inList);
      const declarations = withAlignment(inList ? style.listItemParagraph : style.paragraph, alignOf(node));
      // An empty paragraph needs a non-breaking space or the blank line disappears on paste.
      return `<p${attribute(declarations)}>${inner || '&nbsp;'}</p>`;
    }
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? Math.min(6, Math.max(1, node.attrs.level)) : 1;
      return `<h${level}${attribute(withAlignment(style.heading(level), alignOf(node)))}>${children(node, style, inList)}</h${level}>`;
    }
    case 'blockquote': return `<blockquote${attribute(style.blockquote)}>${children(node, style, inList)}</blockquote>`;
    case 'bulletList': return `<ul${attribute(style.list)}>${children(node, style, true)}</ul>`;
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' && node.attrs.start !== 1 ? ` start="${node.attrs.start}"` : '';
      return `<ol${start}${attribute(style.list)}>${children(node, style, true)}</ol>`;
    }
    case 'listItem': return `<li>${children(node, style, true)}</li>`;
    case 'table': return `<table border="1" cellspacing="0" cellpadding="0"${attribute(style.table)}><tbody>${children(node, style, inList)}</tbody></table>`;
    case 'tableRow': return `<tr>${children(node, style, inList)}</tr>`;
    case 'tableHeader':
    case 'tableCell': {
      const header = node.type === 'tableHeader';
      const tag = header ? 'th' : 'td';
      const span = (name: 'colspan' | 'rowspan') => {
        const value = node.attrs?.[name];
        return typeof value === 'number' && value > 1 ? ` ${name}="${value}"` : '';
      };
      // Cell paragraphs use the tight list spacing so a table does not gain a blank line per cell.
      return `<${tag}${span('colspan')}${span('rowspan')}${attribute(header ? style.headerCell : style.cell)}>${children(node, style, true)}</${tag}>`;
    }
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
  return `<div${attribute(style.root)}>${body}</div>`;
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
