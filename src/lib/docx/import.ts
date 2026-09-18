import { EditorDocumentSchema } from '../contracts';
import type { EditorDocument, EditorNode } from '../editor/document';
import { unzip, ZipError, type ZipLimits } from './zip';
import { alignmentOf, defaultPageSize, type PageSize } from './office-defaults';
import { attr, childrenNamed, findDeep, firstNamed, isOn, parseXml, type XmlNode } from './xml';

export class DocxError extends Error {}

export type ImportWarning =
  | 'tracked-deletions-dropped' | 'images-dropped' | 'footnotes-dropped' | 'comments-dropped'
  | 'fields-flattened' | 'nested-lists-flattened' | 'unsupported-links-dropped' | 'headers-dropped' | 'empty-document';

export type DocxImport = { content: EditorDocument; title: string; pageSize: PageSize; warnings: ImportWarning[] };

const DECODER = new TextDecoder();
const MARK_TYPES = { b: 'bold', i: 'italic', u: 'underline' } as const;

type Context = { relationships: Map<string, string>; numbering: Map<string, 'bullet' | 'ordered'>; warnings: Set<ImportWarning> };

// A DOCX is a ZIP whose first bytes are the local file header; the MIME type a browser reports is not evidence.
export const looksLikeDocx = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

function relationships(files: Map<string, Uint8Array>, context: Context) {
  const part = files.get('word/_rels/document.xml.rels');
  if (!part) return;
  // parseXml returns a synthetic root, so the <Relationships> wrapper has to be stepped into first.
  const root = parseXml(DECODER.decode(part));
  for (const relationship of childrenNamed(firstNamed(root, 'Relationships') ?? root, 'Relationship')) {
    const id = attr(relationship, 'Id'); const target = attr(relationship, 'Target');
    if (id && target) context.relationships.set(id, target);
  }
}

// Maps each w:numId to a bullet or an ordered list by reading the numbering format of its first level.
function numbering(files: Map<string, Uint8Array>, context: Context) {
  const part = files.get('word/numbering.xml');
  if (!part) return;
  const root = parseXml(DECODER.decode(part));
  const numbered = firstNamed(root, 'w:numbering') ?? root;
  const formats = new Map<string, 'bullet' | 'ordered'>();
  for (const abstract of childrenNamed(numbered, 'w:abstractNum')) {
    const id = attr(abstract, 'w:abstractNumId');
    const level = childrenNamed(abstract, 'w:lvl').find((item) => attr(item, 'w:ilvl') === '0') ?? childrenNamed(abstract, 'w:lvl')[0];
    const format = attr(firstNamed(level ?? abstract, 'w:numFmt'), 'w:val');
    if (id) formats.set(id, format === 'bullet' || format === 'none' ? 'bullet' : 'ordered');
  }
  for (const num of childrenNamed(numbered, 'w:num')) {
    const id = attr(num, 'w:numId');
    const abstractId = attr(firstNamed(num, 'w:abstractNumId'), 'w:val');
    if (id) context.numbering.set(id, (abstractId && formats.get(abstractId)) || 'ordered');
  }
}

const HTTP_LINK = /^https?:\/\//i;

// Runs carry the text and the character formatting; w:del is a tracked deletion and is not part of the text.
function inlineFrom(node: XmlNode, context: Context, marks: EditorNode['marks'] = []): EditorNode[] {
  const output: EditorNode[] = [];
  for (const child of node.children) {
    switch (child.name) {
      case 'w:del': context.warnings.add('tracked-deletions-dropped'); break;
      case 'w:ins': output.push(...inlineFrom(child, context, marks)); break;
      case 'w:hyperlink': {
        const id = attr(child, 'r:id');
        const target = id ? context.relationships.get(id) : undefined;
        if (target && HTTP_LINK.test(target)) output.push(...inlineFrom(child, context, [...(marks ?? []), { type: 'link', attrs: { href: target } }]));
        else { if (id) context.warnings.add('unsupported-links-dropped'); output.push(...inlineFrom(child, context, marks)); }
        break;
      }
      case 'w:r': {
        const properties = firstNamed(child, 'w:rPr');
        const runMarks = [...(marks ?? [])];
        if (properties) for (const [tag, type] of Object.entries(MARK_TYPES)) if (isOn(firstNamed(properties, `w:${tag}`))) runMarks.push({ type });
        for (const piece of child.children) {
          if (piece.name === 'w:t' && piece.text) output.push({ type: 'text', text: piece.text, ...(runMarks.length ? { marks: runMarks } : {}) });
          else if (piece.name === 'w:br' || piece.name === 'w:cr') output.push({ type: 'hardBreak' });
          else if (piece.name === 'w:tab') output.push({ type: 'text', text: ' ' });
          else if (piece.name === 'w:drawing' || piece.name === 'w:pict' || piece.name === 'w:object') context.warnings.add('images-dropped');
          else if (piece.name === 'w:footnoteReference' || piece.name === 'w:endnoteReference') context.warnings.add('footnotes-dropped');
          else if (piece.name === 'w:instrText') context.warnings.add('fields-flattened');
        }
        break;
      }
      case 'w:commentRangeStart': case 'w:commentReference': context.warnings.add('comments-dropped'); break;
      case 'w:smartTag': case 'w:sdt': case 'w:sdtContent': case 'w:fldSimple':
        output.push(...inlineFrom(child, context, marks));
        break;
      default: break;
    }
  }
  return output;
}

type Paragraph = { node: EditorNode; list: 'bullet' | 'ordered' | null; level: number };

const HEADING_STYLE = /^(?:Heading|heading)\s*([1-6])$/;
// Not every list carries w:numPr: Word's built-in "List Bullet" and "List Number" styles mark a list on their own,
// and converters and templates lean on them. The trailing digit is the nesting level.
const LIST_STYLE = /^List\s*(Bullet|Number|Paragraph)\s*([2-9])?$/i;
function listFromStyle(style: string): { list: 'bullet' | 'ordered'; level: number } | null {
  const match = LIST_STYLE.exec(style.replace(/\s+/g, ''));
  if (!match) return null;
  const kind = match[1]!.toLowerCase();
  // "List Paragraph" alone is just an indent; only Bullet and Number are lists by themselves.
  if (kind === 'paragraph') return null;
  return { list: kind === 'bullet' ? 'bullet' : 'ordered', level: match[2] ? Number(match[2]) - 1 : 0 };
}

function paragraphFrom(node: XmlNode, context: Context): Paragraph {
  const properties = firstNamed(node, 'w:pPr');
  const style = attr(firstNamed(properties ?? node, 'w:pStyle'), 'w:val') ?? '';
  const align = alignmentOf(attr(firstNamed(properties ?? node, 'w:jc'), 'w:val'));
  const rightToLeft = isOn(firstNamed(properties ?? node, 'w:bidi'));
  const content = inlineFrom(node, context);
  const attrs: Record<string, unknown> = {};
  // A right-to-left paragraph without explicit justification reads right-aligned, which is how Word renders it.
  const effective = align ?? (rightToLeft ? 'right' : null);
  if (effective && effective !== 'left') attrs.textAlign = effective;

  const numbering = firstNamed(properties ?? node, 'w:numPr');
  const numId = attr(firstNamed(numbering ?? node, 'w:numId'), 'w:val');
  const styled = listFromStyle(style);
  const level = Number(attr(firstNamed(numbering ?? node, 'w:ilvl'), 'w:val') ?? '0') || styled?.level || 0;
  // w:numPr is the stronger signal; the style is the fallback for files that only say it there.
  const list = numbering && numId ? context.numbering.get(numId) ?? 'ordered' : styled?.list ?? null;

  const heading = HEADING_STYLE.exec(style);
  if (heading && !list) return { node: { type: 'heading', attrs: { ...attrs, level: Number(heading[1]) }, content }, list: null, level: 0 };

  const quote = style === 'Quote' || style === 'IntenseQuote';
  const paragraph: EditorNode = { type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) };
  if (quote && !list) return { node: { type: 'blockquote', content: [paragraph] }, list: null, level: 0 };

  // A paragraph whose only decoration is a bottom border is Word's horizontal rule.
  const borders = firstNamed(properties ?? node, 'w:pBdr');
  if (borders && !content.length && firstNamed(borders, 'w:bottom')) return { node: { type: 'horizontalRule' }, list: null, level: 0 };

  return { node: paragraph, list, level };
}

function tableFrom(node: XmlNode, context: Context): EditorNode {
  const rows = childrenNamed(node, 'w:tr').map((row, rowIndex) => {
    const cells = childrenNamed(row, 'w:tc').map((cell) => {
      const properties = firstNamed(cell, 'w:tcPr');
      const span = Number(attr(firstNamed(properties ?? cell, 'w:gridSpan'), 'w:val') ?? '1') || 1;
      const content = blocksFrom(cell, context);
      const attrs = span > 1 ? { colspan: span } : undefined;
      return { type: rowIndex === 0 ? 'tableHeader' : 'tableCell', ...(attrs ? { attrs } : {}), content: content.length ? content : [{ type: 'paragraph' as const }] } as EditorNode;
    });
    return { type: 'tableRow', content: cells.length ? cells : [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] } as EditorNode;
  });
  return { type: 'table', content: rows.length ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] };
}

// Consecutive numbered paragraphs of the same kind become one list; deeper levels are flattened with a warning,
// because the editor's schema has a single list level.
function blocksFrom(container: XmlNode, context: Context): EditorNode[] {
  const output: EditorNode[] = [];
  let list: { type: 'bulletList' | 'orderedList'; items: EditorNode[] } | null = null;
  const flush = () => { if (list) { output.push({ type: list.type, content: list.items }); list = null; } };

  for (const child of container.children) {
    if (child.name === 'w:p') {
      const paragraph = paragraphFrom(child, context);
      if (paragraph.list) {
        if (paragraph.level > 0) context.warnings.add('nested-lists-flattened');
        const type = paragraph.list === 'bullet' ? 'bulletList' : 'orderedList';
        if (!list || list.type !== type) { flush(); list = { type, items: [] }; }
        list.items.push({ type: 'listItem', content: [paragraph.node.type === 'paragraph' ? paragraph.node : { type: 'paragraph', content: paragraph.node.content }] });
        continue;
      }
      flush();
      output.push(paragraph.node);
      continue;
    }
    if (child.name === 'w:tbl') { flush(); output.push(tableFrom(child, context)); continue; }
    if (child.name === 'w:sdt' || child.name === 'w:sdtContent') { flush(); output.push(...blocksFrom(child, context)); continue; }
  }
  flush();
  return output;
}

// Word stores the page size in the body's section properties; anything unfamiliar falls back to the locale default.
function pageSizeFrom(body: XmlNode, language: string): PageSize {
  const width = Number(attr(findDeep(body, 'w:pgSz'), 'w:w') ?? '0');
  if (width >= 12100) return 'letter';
  if (width > 0) return 'a4';
  return defaultPageSize(language);
}

const titleFrom = (files: Map<string, Uint8Array>): string => {
  const part = files.get('docProps/core.xml');
  if (!part) return '';
  const root = parseXml(DECODER.decode(part));
  return (findDeep(root, 'dc:title')?.text ?? '').trim().slice(0, 180);
};

// The first heading, or the first non-empty paragraph, names the notebook when the file carries no title.
function titleFromContent(content: EditorNode[]): string {
  const textOf = (node: EditorNode): string => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(textOf).join('');
  const heading = content.find((node) => node.type === 'heading' && textOf(node).trim());
  const first = heading ?? content.find((node) => node.type === 'paragraph' && textOf(node).trim());
  return textOf(first ?? { type: 'paragraph' }).trim().replace(/\s+/g, ' ').slice(0, 180);
}

export type ImportOptions = { language?: string; limits?: ZipLimits };

export async function docxToEditorDocument(bytes: Uint8Array, options: ImportOptions = {}): Promise<DocxImport> {
  if (!looksLikeDocx(bytes)) throw new DocxError('This file is not a .docx document.');
  let files: Map<string, Uint8Array>;
  try { files = await unzip(bytes, options.limits); }
  catch (error) { throw new DocxError(error instanceof ZipError ? error.message : 'This .docx file could not be read.'); }
  if (!files.has('[Content_Types].xml')) throw new DocxError('This file is not a .docx document.');

  const part = files.get('word/document.xml');
  if (!part) throw new DocxError('This .docx file has no document body.');

  const context: Context = { relationships: new Map(), numbering: new Map(), warnings: new Set() };
  relationships(files, context);
  numbering(files, context);
  if (files.has('word/header1.xml') || files.has('word/footer1.xml')) context.warnings.add('headers-dropped');

  const root = parseXml(DECODER.decode(part));
  const body = findDeep(root, 'w:body');
  if (!body) throw new DocxError('This .docx file has no document body.');

  const blocks = blocksFrom(body, context);
  if (!blocks.length) context.warnings.add('empty-document');
  // Parsing through the schema makes whitelist compliance structural rather than a promise.
  const content = EditorDocumentSchema.parse({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] });

  return {
    content,
    title: titleFrom(files) || titleFromContent(content.content) || 'Untitled document',
    pageSize: pageSizeFrom(body, options.language ?? 'id'),
    warnings: [...context.warnings],
  };
}

type Copy = (id: string, en: string) => string;
// Named warnings, so the import dialog says exactly what was left behind instead of a vague notice.
export function warningText(warning: ImportWarning, t: Copy): string {
  const messages: Record<ImportWarning, [string, string]> = {
    'tracked-deletions-dropped': ['Perubahan terlacak yang dihapus tidak dibawa; teks final yang dipakai.', 'Tracked deletions were not carried over; the final text was used.'],
    'images-dropped': ['Gambar tidak dibawa masuk.', 'Images were not imported.'],
    'footnotes-dropped': ['Catatan kaki tidak dibawa masuk.', 'Footnotes were not imported.'],
    'comments-dropped': ['Komentar tidak dibawa masuk.', 'Comments were not imported.'],
    'fields-flattened': ['Field otomatis (mis. daftar isi) dibawa sebagai teks biasa.', 'Automatic fields such as a table of contents came in as plain text.'],
    'nested-lists-flattened': ['Daftar bertingkat diratakan menjadi satu tingkat.', 'Nested lists were flattened to one level.'],
    'unsupported-links-dropped': ['Tautan non-web dilepas, teksnya tetap ada.', 'Non-web links were removed; their text stayed.'],
    'headers-dropped': ['Header dan footer halaman tidak dibawa masuk.', 'Page headers and footers were not imported.'],
    'empty-document': ['Dokumen ini tidak berisi teks yang bisa dibaca.', 'This document had no readable text.'],
  };
  const [id, en] = messages[warning];
  return t(id, en);
}
