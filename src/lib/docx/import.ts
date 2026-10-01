import { EditorDocumentSchema } from '../contracts';
import type { EditorDocument, EditorNode } from '../editor/document';
import { jsonDocumentTextLength, schemaProblem } from '../editor/validate';
import { MAX_DOCUMENT_CHARACTERS, MAX_TOP_LEVEL_BLOCKS } from '../limits';
import { safeAnchor } from '../editor/extensions/anchors';
import { MAX_FOOTNOTE_CHARS } from '../editor/extensions/footnote';
import { formatTabStops } from '../editor/extensions/paragraph-format';
import { readZipEntry, streamZipEntry, ZIP_LIMITS, zipDirectory, ZipError, type ZipDirectoryEntry, type ZipLimits } from './zip';
import { BORDER_SIDES, borderAttr, cssBorder } from './borders';
import { asRunningText, PAGE_TOKEN, PAGES_TOKEN, type RunningText } from './running';
import { asColumns, contentWidth, TWIPS_PER_POINT, DEFAULT_FONT, DEFAULT_FONT_POINTS, defaultPageSize, fontLineFactor, HEADING_FONT, HEADINGS, LINE_HEIGHT, MAX_COLUMNS, PAGES, pageGeometry, parseMargins, formatMargins, SPACE_AFTER_TWIPS, type Orientation, type PageMargins, type PageSize } from './office-defaults';
import { advance, levelOf, listShape, parseNumbering, type ListShape, type Numbering } from './numbering';
import { inlinesFrom, marksFor, PAGE_BREAK, pushText, type Baseline, type ImportWarning, type NoteKind, type RunContext } from './runs';
import { applyParagraph, applyRun, defaultParagraph, defaultRun, headingLevel, paragraphStyleProps, parseStyles, parseTheme, type ParaProps, type Styles } from './styles';
import { tableFrom, type CellBase } from './tables';
import { attr, childrenNamed, collectElements, findDeep, firstNamed, forEachBodyChild, parseXml, textChunks, type XmlNode } from './xml';

export class DocxError extends Error {}

export type DocxImport = {
  content: EditorDocument; title: string; pageSize: PageSize; pageMargins: PageMargins;
  orientation: Orientation; columns: number; header: RunningText | null; footer: RunningText | null; warnings: ImportWarning[];
};
// maxCharacters lowers the text cap (tests use it to keep fixtures small); it never raises it.
export type ImportOptions = { language?: string; limits?: ZipLimits; maxCharacters?: number };

// Any realistic length imports: the cap is the notebook's own (src/lib/limits.ts), about 2,600 A4 pages of text.
export const MAX_IMPORT_CHARACTERS = MAX_DOCUMENT_CHARACTERS;
const DECODER = new TextDecoder();

// A DOCX is a ZIP whose first bytes are the local file header; the MIME type a browser reports is not evidence.
export const looksLikeDocx = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

type Context = RunContext & { numbering: Numbering; contentWidth: number };
// `indent` is where the item's text sits, in points from the left margin, which is the second axis Word nests on:
// a CV often uses one numbering level and a deeper indent instead of a real sub-level.
type ListInfo = { ilvl: number; shape: Exclude<ListShape, { kind: 'literal' }>; value: number | null; indent: number };
type ParaRecord = {
  kind: 'para'; styleId: string; para: ParaProps; before: number; after: number; role: 'paragraph' | 'heading' | 'quote';
  level: number; top: boolean; firstFont?: string; content: EditorNode[]; list?: ListInfo; anchor?: string; toc?: boolean;
  // The paragraph mark's font and size: an empty paragraph is exactly one line of it in Word.
  markFont?: string; markSize?: number;
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

// A bookmark Word wrote just before a heading belongs to that heading, not to the body.
const bookmarkNames = (node: XmlNode): string[] => childrenNamed(node, 'w:bookmarkStart').map((mark) => safeAnchor(attr(mark, 'w:name'))).filter((name): name is string => !!name);

// Word's own default is half an inch per level, which is also what the canvas draws when nothing says otherwise.
const LIST_STEP_POINTS = 36;
const listIndent = (para: ParaProps, ilvl: number) => {
  const left = (para.left ?? 0) / TWIPS_PER_POINT;
  return left > 0 ? left : LIST_STEP_POINTS * (ilvl + 1);
};

function paragraphEntries(node: XmlNode, context: Context, top: boolean, cell?: CellBase, pending?: string): Entry[] {
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
    } else if (counted && shape.kind !== 'literal') list = { ilvl, shape, value: shape.kind === 'ordered' ? counted.value : null, indent: listIndent(para, ilvl) };
  } else if (!para.numId && !heading) {
    const match = LIST_STYLE.exec(styles.byId.get(styleId)?.name ?? styleId);
    if (match) {
      const ilvl = match[2] ? Number(match[2]) - 1 : 0;
      list = { ilvl, shape: /bullet/iu.test(match[1]!) ? { kind: 'bullet', listStyle: 'disc' } : { kind: 'ordered', type: '1' }, value: null, indent: listIndent(para, ilvl) };
    }
  }

  // A TOC field spans several paragraphs; the field stack tells us which side of it this paragraph sits on.
  const inToc = () => context.fields.some((field) => /^\s*TOC\b/iu.test(field.instr));
  const tocBefore = inToc();
  const inlines = inlinesFrom(node, run, baseline, context);
  const toc = tocBefore || inToc();
  // Word bookmarks a heading so its table of contents can link to it; the name becomes the heading's id.
  const anchor = bookmarkNames(node)[0] ?? pending;
  const entries: Entry[] = [];
  if (para.pageBreakBefore) entries.push({ kind: 'block', node: { type: 'pageBreak' } });
  const mark = applyRun(run, pPr && firstNamed(pPr, 'w:rPr'), styles.theme);
  // Floating pictures sit at the top of their paragraph, before the list label and the text.
  const lead = [...inlines.anchored, ...prefix];

  // A page break inside a paragraph splits it; the empty halves Word leaves around the break are dropped.
  const segments: EditorNode[][] = [[]];
  for (const inline of inlines.nodes) if (inline === PAGE_BREAK) segments.push([]); else segments[segments.length - 1]!.push(inline);
  const borders = pPr && firstNamed(pPr, 'w:pBdr');
  let first = true;
  segments.forEach((segment, index) => {
    if (index > 0) entries.push({ kind: 'block', node: { type: 'pageBreak' } });
    if (!segment.length && segments.length > 1 && !(first && inlines.anchored.length)) return;
    // A paragraph whose only decoration is a bottom border is Word's horizontal rule.
    if (!segment.length && !lead.length && borders && firstNamed(borders, 'w:bottom')) { entries.push({ kind: 'block', node: { type: 'horizontalRule' } }); return; }
    const content: EditorNode[] = [];
    for (const inline of first ? [...lead, ...segment] : segment) if (inline.type === 'text') pushText(content, inline.text ?? '', inline.marks ?? []); else content.push(inline);
    entries.push({ kind: 'para', styleId, para, before: para.before ?? 0, after: para.after ?? 0, role, level: heading ?? 0, top, firstFont: inlines.firstFont ?? run.font, markFont: mark.font, markSize: mark.size, content, ...(first && list ? { list } : {}), ...(anchor ? { anchor } : {}), ...(toc ? { toc: true } : {}) });
    first = false;
  });

  // A section break of any kind but "continuous" starts the next section on a new page.
  const section = pPr && firstNamed(pPr, 'w:sectPr');
  if (section && attr(firstNamed(section, 'w:type'), 'w:val') !== 'continuous') entries.push({ kind: 'block', node: { type: 'pageBreak' } });

  // Text boxes are read after the paragraph that anchors them.
  for (const box of context.textBoxes.splice(0)) entries.push(...entriesFrom(box, context, top, cell));
  return entries;
}

// Reads a container's children one at a time, so the document body can be fed to it as it streams in. A bookmark
// Word wrote just before a heading is carried to that heading.
function blockReader(context: Context, top: boolean, cell?: CellBase): (child: XmlNode) => Entry[] {
  let pending: string | undefined;
  return (child) => {
    switch (child.name) {
      case 'w:bookmarkStart': { const name = safeAnchor(attr(child, 'w:name')); if (name) pending = name; return []; }
      case 'w:p': { const entries = paragraphEntries(child, context, top, cell, pending); pending = undefined; return entries; }
      case 'w:tbl': {
        const base = { run: cell?.run ?? defaultRun(context.styles), para: cell?.para ?? defaultParagraph(context.styles) };
        const table = tableFrom(child, context.styles, base, (tc, cellBase) => assemble(entriesFrom(tc, context, false, cellBase)), context.contentWidth);
        return table ? [{ kind: 'block', node: table }] : [];
      }
      case 'w:sdt': { const content = firstNamed(child, 'w:sdtContent'); return content ? entriesFrom(content, context, top, cell) : []; }
      case 'w:customXml': case 'w:ins': case 'w:moveTo': case 'w:smartTag': return entriesFrom(child, context, top, cell);
      default: return [];
    }
  };
}

function entriesFrom(container: XmlNode, context: Context, top: boolean, cell?: CellBase): Entry[] {
  const read = blockReader(context, top, cell);
  const entries: Entry[] = [];
  for (const child of container.children) for (const entry of read(child)) entries.push(entry);
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
    else if (!record.content.length && record.markSize) {
      // An empty paragraph is one line of its mark's font: stated in points, because the canvas would otherwise size
      // it from its own 11 pt default, and a thesis full of blank 12 pt lines would drift a little on every one.
      attrs.lineHeight = pt((para.line / 240) * fontLineFactor(record.markFont) * record.markSize * 20);
    } else {
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
  if (record.role === 'heading') { attrs.level = record.level; if (record.anchor) attrs.id = record.anchor; }
  // Word's section rule is a border on the heading paragraph itself, so it has to survive as one.
  for (const side of BORDER_SIDES) { const line = para.borders?.[side]; if (line !== undefined) attrs[borderAttr(side)] = cssBorder(line); }
  const tabs = formatTabStops((para.tabs ?? []).map((stop) => ({ position: stop.pos / 20, align: stop.val as 'left' })));
  if (tabs) attrs.tabStops = tabs;
  const node: EditorNode = { type: record.role === 'heading' ? 'heading' : 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), ...(record.content.length ? { content: record.content } : {}) };
  return record.role === 'quote' ? { type: 'blockquote', content: [node] } : node;
}

// Numbered paragraphs become real nested lists: ilvl sets the depth, and a list restarts where the counter would not continue.
function assemble(records: Entry[]): EditorNode[] {
  contextualSpacing(records);
  const output: EditorNode[] = [];
  type Open = { ilvl: number; key: string; node: EditorNode; next: number | null; indent: number };
  let stack: Open[] = [];
  let lastItem: EditorNode | null = null;
  // Consecutive paragraphs that came out of one TOC field become the notebook's own table of contents block.
  let toc: EditorNode | null = null;
  // The paragraphs that only carried the field's begin and end markers come out empty and are dropped.
  const closeToc = () => {
    const entries = (toc?.content ?? []).filter((entry) => textOf(entry).trim());
    if (entries.length) output.push({ type: 'tableOfContents', content: entries });
    toc = null;
  };
  // Word's space after the last item is the gap the canvas already puts under every list.
  const closeList = () => { if (lastItem?.attrs?.spaceAfter === pt(SPACE_AFTER_TWIPS)) delete lastItem.attrs.spaceAfter; if (lastItem?.attrs && !Object.keys(lastItem.attrs).length) delete lastItem.attrs; lastItem = null; stack = []; };
  for (const record of records) {
    if (record.kind === 'block') { closeList(); closeToc(); output.push(record.node); continue; }
    const node = paragraphNode(record);
    if (record.toc && record.top) {
      closeList();
      if (!toc) toc = { type: 'tableOfContents', content: [] };
      toc.content!.push(node.type === 'paragraph' ? node : { type: 'paragraph', ...(node.content ? { content: node.content } : {}) });
      continue;
    }
    closeToc();
    const list = record.list;
    if (!list) { closeList(); output.push(node); continue; }
    const key = JSON.stringify(list.shape);
    const deeper = (open: Open) => open.ilvl > list.ilvl || open.indent > list.indent + 0.5;
    const level = (open: Open) => open.ilvl === list.ilvl && Math.abs(open.indent - list.indent) <= 0.5;
    while (stack.length && deeper(stack[stack.length - 1]!)) stack.pop();
    let top = stack[stack.length - 1];
    // A different glyph, a restarted counter or a different indent all start a new list rather than continue this one.
    if (top && level(top) && (top.key !== key || (list.value !== null && top.next !== null && list.value !== top.next))) { stack.pop(); top = stack[stack.length - 1]; }
    if (!top || !level(top)) {
      const attrs: Record<string, unknown> = {};
      if (list.shape.kind === 'ordered') { if ((list.value ?? 1) !== 1) attrs.start = list.value; if (list.shape.type !== '1') attrs.type = list.shape.type; }
      else if (list.shape.listStyle !== 'disc') attrs.listStyle = list.shape.listStyle;
      const step = Math.round((list.indent - (top?.indent ?? 0)) * 100) / 100;
      if (step > 0 && Math.abs(step - LIST_STEP_POINTS) > 0.5) attrs.indent = `${step}pt`;
      const created: EditorNode = { type: list.shape.kind === 'ordered' ? 'orderedList' : 'bulletList', ...(Object.keys(attrs).length ? { attrs } : {}), content: [] };
      const parentItem = top?.node.content?.[top.node.content.length - 1];
      if (parentItem) parentItem.content!.push(created); else output.push(created);
      top = { ilvl: list.ilvl, key, node: created, next: null, indent: list.indent };
      stack.push(top);
    }
    lastItem = node.type === 'paragraph' ? node : { type: 'paragraph', ...(node.content ? { content: node.content } : {}) };
    top.node.content!.push({ type: 'listItem', content: [lastItem] });
    top.next = list.value === null ? null : list.value + 1;
  }
  closeList();
  closeToc();
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

// A note body as plain text: the marker run, tabs and breaks all collapse into single spaces.
function plainText(node: XmlNode): string {
  let out = '';
  const walk = (current: XmlNode) => {
    for (const child of current.children) {
      if (child.name === 'w:t') out += child.text;
      else if (child.name === 'w:tab' || child.name === 'w:br' || child.name === 'w:cr' || child.name === 'w:p') { out += ' '; walk(child); }
      else if (!child.name.endsWith('Pr')) walk(child);
    }
  };
  walk(node);
  return out.replace(/\s+/gu, ' ').trim();
}

// Footnote and endnote bodies, keyed by kind and id, read before the body so every marker can carry its text.
function noteTexts(files: Map<string, Uint8Array>, parts: Record<NoteKind, string>): Map<string, string> {
  const texts = new Map<string, string>();
  for (const kind of ['footnote', 'endnote'] as const) {
    const root = readXml(files, parts[kind]);
    if (!root) continue;
    for (const note of childrenNamed(firstNamed(root, `w:${kind}s`) ?? root, `w:${kind}`)) {
      const id = attr(note, 'w:id');
      // The separator notes carry a w:type and are Word's own furniture, not content.
      if (!id || attr(note, 'w:type')) continue;
      const text = plainText(note).slice(0, MAX_FOOTNOTE_CHARS);
      if (text) texts.set(`${kind}:${id}`, text);
    }
  }
  return texts;
}

const fieldToken = (instruction: string): string | null =>
  /\bNUMPAGES\b/iu.test(instruction) ? PAGES_TOKEN : /\bPAGE\b/iu.test(instruction) ? PAGE_TOKEN : null;

// One header or footer paragraph as text, with Word's PAGE and NUMPAGES fields standing as tokens.
function runningLine(paragraph: XmlNode): string {
  let out = '';
  const stack: Array<{ instr: string; phase: 'instr' | 'result'; replaced: boolean }> = [];
  const walk = (node: XmlNode) => {
    for (const child of node.children) {
      if (child.name === 'w:fldSimple') { const token = fieldToken(attr(child, 'w:instr') ?? ''); if (token) out += token; else walk(child); continue; }
      if (child.name === 'w:r') {
        for (const piece of child.children) {
          if (piece.name === 'w:fldChar') {
            const type = attr(piece, 'w:fldCharType');
            if (type === 'begin') stack.push({ instr: '', phase: 'instr', replaced: false });
            else if (type === 'separate') {
              const field = stack[stack.length - 1];
              if (field) { field.phase = 'result'; const token = fieldToken(field.instr); if (token) { out += token; field.replaced = true; } }
            } else if (type === 'end') stack.pop();
            continue;
          }
          if (piece.name === 'w:instrText') { const field = stack[stack.length - 1]; if (field && field.instr.length < 500) field.instr += piece.text; continue; }
          if (stack.some((field) => field.phase === 'instr' || field.replaced)) continue;
          if (piece.name === 'w:t') out += piece.text;
          else if (piece.name === 'w:tab') out += ' ';
        }
        continue;
      }
      if (['w:hyperlink', 'w:sdt', 'w:sdtContent', 'w:ins', 'w:smartTag', 'w:customXml'].includes(child.name)) walk(child);
    }
  };
  walk(paragraph);
  return out;
}

// The first non-empty line of a header or footer part; anything richer is reported rather than half-imported.
function runningFrom(root: XmlNode | null, warn: (warning: ImportWarning) => void): RunningText | null {
  if (!root) return null;
  const container = firstNamed(root, 'w:hdr') ?? firstNamed(root, 'w:ftr') ?? root;
  const paragraphs = childrenNamed(container, 'w:p');
  const lines = paragraphs.map((paragraph) => ({ paragraph, text: runningLine(paragraph) })).filter((line) => line.text.trim());
  if (childrenNamed(container, 'w:tbl').length || lines.length > 1 || findDeep(container, 'w:drawing') || findDeep(container, 'w:pict')) warn('runningRich');
  const first = lines[0];
  if (!first) return null;
  const justification = attr(firstNamed(firstNamed(first.paragraph, 'w:pPr') ?? first.paragraph, 'w:jc'), 'w:val');
  const align = justification === 'center' ? 'center' : justification === 'right' || justification === 'end' ? 'right' : 'left';
  return asRunningText(first.text, align);
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

type PageSetup = { pageSize: PageSize; pageMargins: PageMargins; orientation: Orientation; columns: number };
function sectionPage(section: XmlNode | undefined, language: string): PageSetup {
  const size = section && firstNamed(section, 'w:pgSz');
  const width = Number(attr(size, 'w:w') ?? '0'); const height = Number(attr(size, 'w:h') ?? '0');
  let pageSize = defaultPageSize(language);
  if (width > 0 && height > 0) {
    const short = Math.min(width, height); const long = Math.max(width, height);
    const distance = (page: PageSize) => Math.abs(PAGES[page].width - short) + Math.abs(PAGES[page].height - long);
    pageSize = distance('letter') < distance('a4') ? 'letter' : 'a4';
  }
  // A sheet wider than it is tall is landscape, whether or not the writer stated w:orient.
  const orientation: Orientation = attr(size, 'w:orient') === 'landscape' || (width > 0 && height > 0 && width > height) ? 'landscape' : 'portrait';
  const margin = section && firstNamed(section, 'w:pgMar');
  const twips = (name: string) => Math.abs(Math.round(Number(attr(margin, name) ?? 'NaN')));
  const read = margin ? { top: twips('w:top'), right: twips('w:right'), bottom: twips('w:bottom'), left: twips('w:left') + (twips('w:gutter') || 0) } : null;
  const valid = read && Object.values(read).every(Number.isFinite) ? parseMargins(formatMargins(read), pageSize, orientation) : null;
  const columnCount = Number(attr(section && firstNamed(section, 'w:cols'), 'w:num') ?? '1');
  const columns = asColumns(Math.min(MAX_COLUMNS, Number.isFinite(columnCount) ? columnCount : 1));
  return { pageSize, pageMargins: valid ?? { ...pageGeometry(pageSize, orientation).margin }, orientation, columns };
}

// A notebook has one page setup, so the first section's (the one the document opens with) is used; a document whose
// later sections differ says so in a warning. Sections are listed in document order, the body's own last.
function pageFrom(sections: XmlNode[], language: string, warn: (warning: ImportWarning) => void): PageSetup {
  const setups = sections.map((section) => sectionPage(section, language));
  const first = setups[0] ?? sectionPage(undefined, language);
  const key = (setup: PageSetup) => `${setup.pageSize}|${setup.orientation}|${formatMargins(setup.pageMargins)}|${setup.columns}`;
  if (setups.some((setup) => key(setup) !== key(first))) warn('sectionsDiffer');
  return first;
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
  const limits = options.limits ?? ZIP_LIMITS;
  const maxCharacters = Math.min(MAX_IMPORT_CHARACTERS, options.maxCharacters ?? MAX_IMPORT_CHARACTERS);
  let directory: Map<string, ZipDirectoryEntry>;
  try { directory = zipDirectory(bytes, limits.maxEntries); }
  catch (error) { throw new DocxError(error instanceof ZipError ? error.message : 'This .docx file could not be read.'); }
  // Every part is attacker-shaped: any failure past the ZIP layer is reported as an unreadable file, never a 500.
  try {
    if (!directory.has('[Content_Types].xml')) throw new DocxError('This file is not a .docx document.');
    // Only the parts that are mapped are ever inflated: pictures, fonts and embedded files stay compressed and unread,
    // which is why a 50 MB thesis full of figures costs no more than its text.
    const files = new Map<string, Uint8Array>(); let inflated = 0;
    const charge = (entry: ZipDirectoryEntry) => { inflated += entry.uncompressedSize; if (inflated > limits.maxTotalBytes) throw new ZipError('ZIP contents exceed the allowed total size.'); };
    const load = async (path: string | undefined) => {
      const entry = path ? directory.get(path) : undefined;
      if (!entry || files.has(entry.name)) return;
      if (entry.uncompressedSize > limits.maxEntryBytes) throw new ZipError(`ZIP entry ${entry.name} is too large.`);
      charge(entry);
      files.set(entry.name, await readZipEntry(bytes, entry, limits.maxEntryBytes));
    };

    await load('_rels/.rels');
    const main = resolvePart('', relationshipsOf(files, '_rels/.rels').byType.get('officeDocument') ?? 'word/document.xml');
    const documentPath = directory.has(main) ? main : 'word/document.xml';
    const mainEntry = directory.get(documentPath);
    if (!mainEntry) throw new DocxError('This .docx file has no document body.');
    const streamLimit = limits.maxStreamBytes ?? limits.maxEntryBytes;
    charge(mainEntry);
    // The body is read twice as a stream: first for its sections (the page setup decides table widths), then block by
    // block. It never exists as one string, so its size is bounded by what it produces, not by the XML around it.
    const body = () => textChunks(streamZipEntry(bytes, mainEntry, streamLimit));

    const relsPath = `${documentPath.replace(/[^/]+$/u, '')}_rels/${documentPath.split('/').pop()}.rels`;
    await load(relsPath);
    const rels = relationshipsOf(files, relsPath);
    const part = (type: string, fallback: string) => { const target = rels.byType.get(type); return target ? resolvePart(documentPath, target) : fallback; };
    const parts = { theme: part('theme', 'word/theme/theme1.xml'), styles: part('styles', 'word/styles.xml'), numbering: part('numbering', 'word/numbering.xml'), footnotes: part('footnotes', 'word/footnotes.xml'), endnotes: part('endnotes', 'word/endnotes.xml') };
    for (const path of [...Object.values(parts), 'docProps/core.xml']) await load(path);
    const theme = parseTheme(readXml(files, parts.theme));
    const styles: Styles = parseStyles(readXml(files, parts.styles), theme);
    const language = options.language ?? 'id';

    const found = new Set<ImportWarning>();
    const warn = (warning: ImportWarning) => { found.add(warning); };
    const sections = await collectElements(body(), 'w:sectPr');
    const page = pageFrom(sections, language, warn);
    const width = contentWidth(page.pageSize, page.pageMargins, page.orientation);
    const context: Context = {
      styles, numbering: parseNumbering(readXml(files, parts.numbering), styles),
      relationships: rels.byId, fields: [], textBoxes: [], warn,
      noteTexts: noteTexts(files, { footnote: parts.footnotes, endnote: parts.endnotes }),
      contentWidth: width, columnPoints: width / 20,
    };
    if (directory.has('word/comments.xml')) warn('comments');

    // A header or footer is the default reference of the last section that has one, which is what Word shows on the
    // pages that carry the body text (a cover section often has none).
    const reference = async (name: 'w:headerReference' | 'w:footerReference') => {
      const section = [...sections].reverse().find((candidate) => childrenNamed(candidate, name).length);
      const nodes = section ? childrenNamed(section, name) : [];
      const chosen = nodes.find((node) => attr(node, 'w:type') === 'default') ?? nodes[0];
      const target = chosen && rels.byId.get(attr(chosen, 'r:id') ?? '');
      if (!target) return null;
      const path = resolvePart(documentPath, target);
      await load(path);
      return readXml(files, path);
    };
    const header = runningFrom(await reference('w:headerReference'), warn);
    const footer = runningFrom(await reference('w:footerReference'), warn);

    const tooLong = (characters: number) => new DocxError(`This document has ${characters.toLocaleString('en-US')} characters of text; the limit is ${maxCharacters.toLocaleString('en-US')}. Split it into smaller files first.`);
    const records: Entry[] = []; let characters = 0;
    const read = blockReader(context, true);
    await forEachBodyChild(body(), (child) => {
      for (const entry of read(child)) {
        characters += entry.kind === 'para' ? entry.content.reduce((sum, node) => sum + textOf(node).length, 0) : textOf(entry.node).length;
        if (characters > maxCharacters) throw tooLong(characters);
        records.push(entry);
      }
    });
    const all = tidyBreaks(assemble(records));
    records.length = 0;
    context.fields.length = 0;
    if (!characters) throw new DocxError('This document has no readable text.');
    if (all.length > MAX_TOP_LEVEL_BLOCKS) throw new DocxError('This document has too many paragraphs to import. Split it into smaller files first.');
    // Both the stored-document contract and the editor schema must accept the result, or the notebook would not open;
    // both checks walk the JSON as it is, with no copy and no ProseMirror tree.
    const content = EditorDocumentSchema.parse({ type: 'doc', content: all });
    const problem = schemaProblem(content);
    if (problem) throw new Error(problem);
    // The saved-document limit counts block and cell separators too, so an import it would refuse is refused here.
    const stored = jsonDocumentTextLength(content);
    if (stored > maxCharacters) throw tooLong(stored);
    return {
      content, title: titleFrom(files) || titleFromContent(content.content) || 'Untitled document',
      pageSize: page.pageSize, pageMargins: page.pageMargins, orientation: page.orientation, columns: page.columns,
      header, footer, warnings: [...found],
    };
  } catch (error) {
    if (error instanceof DocxError) throw error;
    if (error instanceof ZipError) throw new DocxError(error.message);
    throw new DocxError('This document is too large or too complex to import. Split it into smaller files and try again.');
  }
}
