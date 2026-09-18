import { EditorDocumentSchema } from '../contracts';
import type { EditorDocument, EditorNode } from '../editor/document';
import { documentSchema } from '../editor/extensions';
import { unzip, ZipError, type ZipLimits } from './zip';
import { DEFAULT_FONT, DEFAULT_FONT_POINTS, defaultPageSize, fontLineFactor, HEADING_FONT, HEADINGS, LINE_HEIGHT, PAGES, parseMargins, formatMargins, SPACE_AFTER_TWIPS, type PageMargins, type PageSize } from './office-defaults';
import { advance, levelOf, listShape, parseNumbering, type ListShape, type Numbering } from './numbering';
import { inlinesFrom, marksFor, PAGE_BREAK, pushText, type Baseline, type NoteKind, type RunContext } from './runs';
import { applyParagraph, applyRun, defaultParagraph, defaultRun, headingLevel, paragraphStyleProps, parseStyles, parseTheme, type ParaProps, type Styles } from './styles';
import { tableFrom, type CellBase } from './tables';
import { attr, childrenNamed, findDeep, firstNamed, parseXml, type XmlNode } from './xml';

export class DocxError extends Error {}

export type DocxImport = { content: EditorDocument; title: string; pageSize: PageSize; pageMargins: PageMargins };
export type ImportOptions = { language?: string; limits?: ZipLimits };

export const MAX_IMPORT_CHARACTERS = 200_000;
const DECODER = new TextDecoder();

// A DOCX is a ZIP whose first bytes are the local file header; the MIME type a browser reports is not evidence.
export const looksLikeDocx = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

type Context = RunContext & { numbering: Numbering };
type ListInfo = { ilvl: number; shape: Exclude<ListShape, { kind: 'literal' }>; value: number | null };
type ParaRecord = {
  kind: 'para'; styleId: string; para: ParaProps; before: number; after: number; role: 'paragraph' | 'heading' | 'quote';
  level: number; top: boolean; firstFont?: string; content: EditorNode[]; list?: ListInfo;
};
type Entry = ParaRecord | { kind: 'block'; node: EditorNode };

const BODY: Baseline = { font: DEFAULT_FONT, size: DEFAULT_FONT_POINTS, color: '000000', bold: false, italic: false };
const QUOTE: Baseline = { ...BODY, color: '404040', italic: true };
const headingBaseline = (level: number): Baseline => {
  const style = HEADINGS[level as 1] ?? HEADINGS[1];
  return { font: style.light ? HEADING_FONT : DEFAULT_FONT, size: style.points, color: style.color.toUpperCase(), bold: false, italic: false };
};

// Not every list carries w:numPr: "List Bullet 2" and "List Number" mark a list on their own name.
const LIST_STYLE = /^List\s*(Bullet|Number)\s*([2-9])?$/iu;
const QUOTE_STYLE = /^(?:Quote|IntenseQuote|Intense Quote)$/iu;
const pt = (twips: number) => `${Number((twips / 20).toFixed(2))}pt`;
const ALIGN: Partial<Record<string, string>> = { both: 'justify', distribute: 'justify', lowKashida: 'justify', mediumKashida: 'justify', highKashida: 'justify', thaiDistribute: 'justify', center: 'center', right: 'right', end: 'right' };

function paragraphEntries(node: XmlNode, context: Context, top: boolean, cell?: CellBase): Entry[] {
  const styles = context.styles;
  const pPr = firstNamed(node, 'w:pPr');
  const styleId = attr(pPr && firstNamed(pPr, 'w:pStyle'), 'w:val') ?? styles.defaultParagraph ?? '';
  const styled = paragraphStyleProps(styles, styleId, cell?.run ?? defaultRun(styles), cell?.para ?? defaultParagraph(styles));
  let para = applyParagraph(styled.para, pPr);
  const run = styled.run;

  // Numbering indents sit between the paragraph style and direct formatting.
  const numId = para.numId && para.numId !== '0' ? para.numId : undefined;
  const ilvl = Math.max(0, Math.min(8, para.ilvl ?? 0));
  const level = numId ? levelOf(context.numbering, numId, ilvl) : null;
  if (level) para = applyParagraph(applyParagraph(styled.para, level.pPr), pPr);

  const heading = headingLevel(styles, styleId, para);
  const quote = !heading && QUOTE_STYLE.test(styles.byId.get(styleId)?.name ?? styleId);
  const baseline = heading ? headingBaseline(heading) : quote ? QUOTE : cell?.header ? { ...BODY, bold: true } : BODY;
  const role: ParaRecord['role'] = heading ? 'heading' : quote ? 'quote' : 'paragraph';

  let list: ListInfo | undefined;
  const prefix: EditorNode[] = [];
  if (numId && level) {
    const counted = advance(context.numbering, numId, ilvl);
    const shape = listShape(level, ilvl);
    if (counted && (heading || shape.kind === 'literal')) {
      const suffix = level.suffix === 'space' ? ' ' : level.suffix === 'nothing' ? '' : '\t';
      const text = counted.label ? `${counted.label}${suffix}` : '';
      if (text) pushText(prefix, text, marksFor(applyRun(run, level.rPr, styles.theme), baseline));
    } else if (counted && shape.kind !== 'literal') list = { ilvl, shape, value: shape.kind === 'ordered' ? counted.value : null };
  } else if (!para.numId && !heading) {
    const match = LIST_STYLE.exec(styles.byId.get(styleId)?.name ?? styleId);
    if (match) list = { ilvl: match[2] ? Number(match[2]) - 1 : 0, shape: /bullet/iu.test(match[1]!) ? { kind: 'bullet', listStyle: 'disc' } : { kind: 'ordered', type: '1' }, value: null };
  }

  const inlines = inlinesFrom(node, run, baseline, context);
  const entries: Entry[] = [];
  if (para.pageBreakBefore) entries.push({ kind: 'block', node: { type: 'pageBreak' } });

  // A page break inside a paragraph splits it; the empty halves Word leaves around the break are dropped.
  const segments: EditorNode[][] = [[]];
  for (const inline of inlines.nodes) if (inline === PAGE_BREAK) segments.push([]); else segments[segments.length - 1]!.push(inline);
  const borders = pPr && firstNamed(pPr, 'w:pBdr');
  let first = true;
  segments.forEach((segment, index) => {
    if (index > 0) entries.push({ kind: 'block', node: { type: 'pageBreak' } });
    if (!segment.length && segments.length > 1) return;
    // A paragraph whose only decoration is a bottom border is Word's horizontal rule.
    if (!segment.length && !prefix.length && borders && firstNamed(borders, 'w:bottom')) { entries.push({ kind: 'block', node: { type: 'horizontalRule' } }); return; }
    const content: EditorNode[] = [];
    for (const inline of first ? [...prefix, ...segment] : segment) if (inline.type === 'text') pushText(content, inline.text ?? '', inline.marks ?? []); else content.push(inline);
    entries.push({ kind: 'para', styleId, para, before: para.before ?? 0, after: para.after ?? 0, role, level: heading ?? 0, top, firstFont: inlines.firstFont ?? run.font, content, ...(first && list ? { list } : {}) });
    first = false;
  });

  // A section break of any kind but "continuous" starts the next section on a new page.
  const section = pPr && firstNamed(pPr, 'w:sectPr');
  if (section && attr(firstNamed(section, 'w:type'), 'w:val') !== 'continuous') entries.push({ kind: 'block', node: { type: 'pageBreak' } });

  // Text boxes are read after the paragraph that anchors them.
  for (const box of context.textBoxes.splice(0)) entries.push(...entriesFrom(box, context, top, cell));
  return entries;
}

function entriesFrom(container: XmlNode, context: Context, top: boolean, cell?: CellBase): Entry[] {
  const entries: Entry[] = [];
  for (const child of container.children) {
    switch (child.name) {
      case 'w:p': entries.push(...paragraphEntries(child, context, top, cell)); break;
      case 'w:tbl': {
        const base = { run: cell?.run ?? defaultRun(context.styles), para: cell?.para ?? defaultParagraph(context.styles) };
        const table = tableFrom(child, context.styles, base, (tc, cellBase) => assemble(entriesFrom(tc, context, false, cellBase)));
        if (table) entries.push({ kind: 'block', node: table });
        break;
      }
      case 'w:sdt': { const content = firstNamed(child, 'w:sdtContent'); if (content) entries.push(...entriesFrom(content, context, top, cell)); break; }
      case 'w:customXml': case 'w:ins': case 'w:moveTo': case 'w:smartTag': entries.push(...entriesFrom(child, context, top, cell)); break;
      default: break;
    }
  }
  return entries;
}

// Contextual spacing: Word drops the space between two paragraphs of the same style when either asks for it.
function contextualSpacing(records: Entry[]) {
  for (let index = 0; index + 1 < records.length; index++) {
    const current = records[index]!; const next = records[index + 1]!;
    if (current.kind !== 'para' || next.kind !== 'para' || current.styleId !== next.styleId) continue;
    if (current.para.contextual) current.after = 0;
    if (next.para.contextual) next.before = 0;
  }
}

function paragraphNode(record: ParaRecord): EditorNode {
  const { para } = record;
  const nested = !record.top || record.list !== undefined;
  const attrs: Record<string, unknown> = {};
  const align = ALIGN[para.align ?? ''];
  if (align) attrs.textAlign = align;
  if (para.line !== undefined) {
    if (para.lineRule === 'exact' || para.lineRule === 'atLeast') attrs.lineHeight = pt(para.line);
    else {
      const ratio = Number(((para.line / 240) * fontLineFactor(record.firstFont)).toFixed(4));
      if (Math.abs(ratio - LINE_HEIGHT) > 0.005) attrs.lineHeight = String(ratio);
    }
  }
  if (record.role !== 'quote') {
    // What the canvas already gives each block: 8 pt after a body paragraph, the heading's own space before, nothing when nested.
    const baseBefore = record.role === 'heading' ? HEADINGS[record.level as 1]?.spaceBefore ?? 0 : 0;
    const baseAfter = record.role === 'paragraph' && !nested ? SPACE_AFTER_TWIPS : 0;
    if (record.before !== baseBefore) attrs.spaceBefore = pt(record.before);
    if (record.after !== baseAfter) attrs.spaceAfter = pt(record.after);
    if (!record.list && para.left) attrs.indentLeft = pt(para.left);
    if (para.right) attrs.indentRight = pt(para.right);
    if (!record.list && para.firstLine) attrs.indentFirstLine = pt(para.firstLine);
  }
  if (record.role === 'heading') attrs.level = record.level;
  const node: EditorNode = { type: record.role === 'heading' ? 'heading' : 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), ...(record.content.length ? { content: record.content } : {}) };
  return record.role === 'quote' ? { type: 'blockquote', content: [node] } : node;
}

// Numbered paragraphs become real nested lists: ilvl sets the depth, and a list restarts where the counter would not continue.
function assemble(records: Entry[]): EditorNode[] {
  contextualSpacing(records);
  const output: EditorNode[] = [];
  type Open = { ilvl: number; key: string; node: EditorNode; next: number | null };
  let stack: Open[] = [];
  let lastItem: EditorNode | null = null;
  // Word's space after the last item is the gap the canvas already puts under every list.
  const closeList = () => { if (lastItem?.attrs?.spaceAfter === pt(SPACE_AFTER_TWIPS)) delete lastItem.attrs.spaceAfter; if (lastItem?.attrs && !Object.keys(lastItem.attrs).length) delete lastItem.attrs; lastItem = null; stack = []; };
  for (const record of records) {
    if (record.kind === 'block') { closeList(); output.push(record.node); continue; }
    const node = paragraphNode(record);
    const list = record.list;
    if (!list) { closeList(); output.push(node); continue; }
    const key = JSON.stringify(list.shape);
    while (stack.length && stack[stack.length - 1]!.ilvl > list.ilvl) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.ilvl === list.ilvl && (top.key !== key || (list.value !== null && top.next !== null && list.value !== top.next))) { stack.pop(); top = stack[stack.length - 1]; }
    if (!top || top.ilvl < list.ilvl) {
      const attrs: Record<string, unknown> = {};
      if (list.shape.kind === 'ordered') { if ((list.value ?? 1) !== 1) attrs.start = list.value; if (list.shape.type !== '1') attrs.type = list.shape.type; }
      else if (list.shape.listStyle !== 'disc') attrs.listStyle = list.shape.listStyle;
      const created: EditorNode = { type: list.shape.kind === 'ordered' ? 'orderedList' : 'bulletList', ...(Object.keys(attrs).length ? { attrs } : {}), content: [] };
      const parentItem = top?.node.content?.[top.node.content.length - 1];
      if (parentItem) parentItem.content!.push(created); else output.push(created);
      top = { ilvl: list.ilvl, key, node: created, next: null };
      stack.push(top);
    }
    lastItem = node.type === 'paragraph' ? node : { type: 'paragraph', ...(node.content ? { content: node.content } : {}) };
    top.node.content!.push({ type: 'listItem', content: [lastItem] });
    top.next = list.value === null ? null : list.value + 1;
  }
  closeList();
  return output;
}

// Leading, doubled and trailing page breaks would only print blank pages.
function tidyBreaks(blocks: EditorNode[]): EditorNode[] {
  const output: EditorNode[] = [];
  for (const block of blocks) {
    if (block.type === 'pageBreak' && (!output.length || output[output.length - 1]!.type === 'pageBreak')) continue;
    output.push(block);
  }
  while (output[output.length - 1]?.type === 'pageBreak') output.pop();
  return output;
}

const NOTES_TITLE = { id: 'Catatan kaki', en: 'Notes' };

function notesSection(files: Map<string, Uint8Array>, context: Context, parts: Record<NoteKind, string>, language: string): EditorNode[] {
  if (!context.notes.length) return [];
  const bodies = new Map<string, XmlNode>();
  for (const kind of ['footnote', 'endnote'] as const) {
    const root = readXml(files, parts[kind]);
    if (root) for (const note of childrenNamed(firstNamed(root, `w:${kind}s`) ?? root, `w:${kind}`)) { const id = attr(note, 'w:id'); if (id) bodies.set(`${kind}:${id}`, note); }
  }
  const records: Entry[] = [];
  for (let index = 0; index < context.notes.length && index < 2000; index++) {
    const note = context.notes[index]!;
    const body = bodies.get(`${note.kind}:${note.id}`);
    if (!body) continue;
    context.currentNote = { kind: note.kind, number: note.number };
    records.push(...entriesFrom(body, context, true));
  }
  context.currentNote = undefined;
  const blocks = assemble(records);
  if (!blocks.length) return [];
  const title: EditorNode = { type: 'paragraph', content: [{ type: 'text', text: language === 'en' ? NOTES_TITLE.en : NOTES_TITLE.id, marks: [{ type: 'bold' }] }] };
  return [{ type: 'horizontalRule' }, title, ...blocks];
}

function readXml(files: Map<string, Uint8Array>, path: string | undefined): XmlNode | null {
  const part = path ? files.get(path) : undefined;
  return part ? parseXml(DECODER.decode(part)) : null;
}

function relationshipsOf(files: Map<string, Uint8Array>, path: string) {
  const byId = new Map<string, string>(); const byType = new Map<string, string>();
  const root = readXml(files, path);
  if (root) for (const relationship of childrenNamed(firstNamed(root, 'Relationships') ?? root, 'Relationship')) {
    const id = attr(relationship, 'Id'); const target = attr(relationship, 'Target'); const type = attr(relationship, 'Type') ?? '';
    if (!id || !target) continue;
    byId.set(id, target);
    const kind = type.slice(type.lastIndexOf('/') + 1);
    if (!byType.has(kind)) byType.set(kind, target);
  }
  return { byId, byType };
}

// Resolves a relationship target against the part that owns it, the way OPC defines it.
function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const piece of target.split('/')) { if (piece === '..') parts.pop(); else if (piece && piece !== '.') parts.push(piece); }
  return parts.join('/');
}

function pageFrom(body: XmlNode, language: string): { pageSize: PageSize; pageMargins: PageMargins } {
  const section = childrenNamed(body, 'w:sectPr').pop() ?? findDeep(body, 'w:sectPr');
  const size = section && firstNamed(section, 'w:pgSz');
  const width = Number(attr(size, 'w:w') ?? '0'); const height = Number(attr(size, 'w:h') ?? '0');
  let pageSize = defaultPageSize(language);
  if (width > 0 && height > 0) {
    const short = Math.min(width, height); const long = Math.max(width, height);
    const distance = (page: PageSize) => Math.abs(PAGES[page].width - short) + Math.abs(PAGES[page].height - long);
    pageSize = distance('letter') < distance('a4') ? 'letter' : 'a4';
  }
  const margin = section && firstNamed(section, 'w:pgMar');
  const twips = (name: string) => Math.abs(Math.round(Number(attr(margin, name) ?? 'NaN')));
  const read = margin ? { top: twips('w:top'), right: twips('w:right'), bottom: twips('w:bottom'), left: twips('w:left') + (twips('w:gutter') || 0) } : null;
  const valid = read && Object.values(read).every(Number.isFinite) ? parseMargins(formatMargins(read), pageSize) : null;
  return { pageSize, pageMargins: valid ?? { ...PAGES[pageSize].margin } };
}

const titleFrom = (files: Map<string, Uint8Array>): string => {
  const root = readXml(files, 'docProps/core.xml');
  return root ? (findDeep(root, 'dc:title')?.text ?? '').trim().slice(0, 180) : '';
};

const textOf = (node: EditorNode): string => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(textOf).join('');
// The first heading, or the first non-empty paragraph, names the notebook when the file carries no title.
function titleFromContent(content: EditorNode[]): string {
  const heading = content.find((node) => node.type === 'heading' && textOf(node).trim());
  const first = heading ?? content.find((node) => node.type === 'paragraph' && textOf(node).trim());
  return textOf(first ?? { type: 'paragraph' }).trim().replace(/\s+/g, ' ').slice(0, 180);
}

export async function docxToEditorDocument(bytes: Uint8Array, options: ImportOptions = {}): Promise<DocxImport> {
  if (!looksLikeDocx(bytes)) throw new DocxError('This file is not a .docx document.');
  let files: Map<string, Uint8Array>;
  try { files = await unzip(bytes, options.limits); }
  catch (error) { throw new DocxError(error instanceof ZipError ? error.message : 'This .docx file could not be read.'); }
  if (!files.has('[Content_Types].xml')) throw new DocxError('This file is not a .docx document.');

  const main = resolvePart('', relationshipsOf(files, '_rels/.rels').byType.get('officeDocument') ?? 'word/document.xml');
  const documentPath = files.has(main) ? main : 'word/document.xml';
  const root = readXml(files, documentPath);
  const body = root && findDeep(root, 'w:body');
  if (!body) throw new DocxError('This .docx file has no document body.');

  const relsPath = `${documentPath.replace(/[^/]+$/u, '')}_rels/${documentPath.split('/').pop()}.rels`;
  const rels = relationshipsOf(files, relsPath);
  const part = (type: string, fallback: string) => { const target = rels.byType.get(type); return target ? resolvePart(documentPath, target) : fallback; };
  const theme = parseTheme(readXml(files, part('theme', 'word/theme/theme1.xml')));
  const styles: Styles = parseStyles(readXml(files, part('styles', 'word/styles.xml')), theme);
  const context: Context = {
    styles, numbering: parseNumbering(readXml(files, part('numbering', 'word/numbering.xml')), styles),
    relationships: rels.byId, fields: [], notes: [], noteCounts: { footnote: 0, endnote: 0 }, textBoxes: [],
  };
  const language = options.language ?? 'id';

  let content: EditorDocument;
  try {
    const blocks = assemble(entriesFrom(body, context, true));
    context.fields.length = 0;
    const notes = notesSection(files, context, { footnote: part('footnotes', 'word/footnotes.xml'), endnote: part('endnotes', 'word/endnotes.xml') }, language);
    const all = tidyBreaks([...blocks, ...notes]);
    const characters = all.reduce((sum, node) => sum + textOf(node).length, 0);
    if (!characters) throw new DocxError('This document has no readable text.');
    if (characters > MAX_IMPORT_CHARACTERS) throw new DocxError(`This document has ${characters.toLocaleString('en-US')} characters of text; the limit is ${MAX_IMPORT_CHARACTERS.toLocaleString('en-US')}. Split it into smaller files first.`);
    // Both the stored-document contract and the editor schema must accept the result, or the notebook would not open.
    content = EditorDocumentSchema.parse({ type: 'doc', content: all });
    documentSchema.nodeFromJSON(content).check();
  } catch (error) {
    if (error instanceof DocxError) throw error;
    throw new DocxError('This document is too large or too complex to import. Split it into smaller files and try again.');
  }

  return { content, title: titleFrom(files) || titleFromContent(content.content) || 'Untitled document', ...pageFrom(body, language) };
}

