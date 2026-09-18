import { EditorDocumentSchema } from '../contracts';
import type { EditorDocument, EditorNode } from '../editor/document';
import { zip, type ZipEntry } from './zip';
import { element, escapeXml, XML_DECLARATION } from './xml';
import {
  alignmentFrom, contentWidth, DEFAULT_FONT, DEFAULT_FONT_POINTS, defaultPageSize, HEADING_FONT, HEADINGS,
  JUSTIFICATION, LINE_RULE_AUTO, PAGES, pointsToHalfPoints, SPACE_AFTER_TWIPS, SPACE_BEFORE_TWIPS, type PageSize,
} from './office-defaults';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const BULLET_NUM_ID = 1;
const ORDERED_NUM_ID = 2;

type Mark = NonNullable<EditorNode['marks']>[number];
type Relationship = { id: string; target: string };

// Word keeps significant spaces only when the run says so.
const textElement = (value: string) => `<w:t xml:space="preserve">${escapeXml(value)}</w:t>`;

function runProperties(marks: Mark[] | undefined, link: boolean): string {
  const parts: string[] = [];
  const types = new Set((marks ?? []).map((mark) => mark.type));
  if (link) parts.push(element('w:rStyle', { 'w:val': 'Hyperlink' }));
  if (types.has('bold')) parts.push(element('w:b'));
  if (types.has('italic')) parts.push(element('w:i'));
  if (types.has('underline')) parts.push(element('w:u', { 'w:val': 'single' }));
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function runs(node: EditorNode, relationships: Relationship[]): string {
  if (node.type === 'hardBreak') return `<w:r>${element('w:br')}</w:r>`;
  if (node.type !== 'text') return (node.content ?? []).map((child) => runs(child, relationships)).join('');
  const text = node.text ?? '';
  if (!text) return '';
  const link = (node.marks ?? []).find((mark) => mark.type === 'link');
  const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : '';
  const run = `<w:r>${runProperties(node.marks, Boolean(href))}${textElement(text)}</w:r>`;
  if (!href) return run;
  const id = `rId${relationships.length + 10}`;
  relationships.push({ id, target: href });
  return element('w:hyperlink', { 'r:id': id }, run);
}

type ParagraphOptions = { style?: string; numId?: number; indent?: number };

function paragraph(node: EditorNode, relationships: Relationship[], options: ParagraphOptions = {}): string {
  const properties: string[] = [];
  if (options.style) properties.push(element('w:pStyle', { 'w:val': options.style }));
  if (options.numId !== undefined) properties.push(element('w:numPr', {}, `${element('w:ilvl', { 'w:val': 0 })}${element('w:numId', { 'w:val': options.numId })}`));
  if (options.indent !== undefined) properties.push(element('w:ind', { 'w:left': options.indent }));
  const align = alignmentFrom(node.attrs?.textAlign);
  if (align) properties.push(element('w:jc', { 'w:val': JUSTIFICATION[align] }));
  const body = (node.content ?? []).map((child) => runs(child, relationships)).join('');
  const prefix = properties.length ? `<w:pPr>${properties.join('')}</w:pPr>` : '';
  return `<w:p>${prefix}${body}</w:p>`;
}

function listParagraphs(node: EditorNode, relationships: Relationship[], numId: number): string {
  return (node.content ?? []).flatMap((item) => (item.content ?? []).map((block, index) =>
    // The marker belongs to the item's first block; a second block inside the same item is a continuation.
    block.type === 'paragraph'
      ? paragraph(block, relationships, index === 0 ? { style: 'ListParagraph', numId } : { style: 'ListParagraph', indent: 720 })
      : blocks(block, relationships),
  )).join('');
}

function tableXml(node: EditorNode, relationships: Relationship[], size: PageSize): string {
  const rows = node.content ?? [];
  const columns = Math.max(1, ...rows.map((row) => (row.content ?? []).length));
  const total = contentWidth(size);
  const width = Math.floor(total / columns);
  const grid = element('w:tblGrid', {}, Array.from({ length: columns }, () => element('w:gridCol', { 'w:w': width })).join(''));
  const borders = element('w:tblBorders', {}, (['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const)
    .map((side) => element(`w:${side}`, { 'w:val': 'single', 'w:sz': 4, 'w:space': 0, 'w:color': 'auto' })).join(''));
  const properties = element('w:tblPr', {}, `${element('w:tblStyle', { 'w:val': 'TableGrid' })}${element('w:tblW', { 'w:w': 0, 'w:type': 'auto' })}${borders}`);
  const body = rows.map((row) => {
    const cells = (row.content ?? []).map((cell) => {
      const span = typeof cell.attrs?.colspan === 'number' && cell.attrs.colspan > 1 ? element('w:gridSpan', { 'w:val': cell.attrs.colspan }) : '';
      const vMerge = typeof cell.attrs?.rowspan === 'number' && cell.attrs.rowspan > 1 ? element('w:vMerge', { 'w:val': 'restart' }) : '';
      const cellProperties = element('w:tcPr', {}, `${element('w:tcW', { 'w:w': width, 'w:type': 'dxa' })}${span}${vMerge}`);
      const content = (cell.content ?? []).map((block) => blocks(block, relationships, cell.type === 'tableHeader')).join('') || '<w:p/>';
      return element('w:tc', {}, `${cellProperties}${content}`);
    }).join('');
    return element('w:tr', {}, cells);
  }).join('');
  return element('w:tbl', {}, `${properties}${grid}${body}`);
}

function blocks(node: EditorNode, relationships: Relationship[], header = false, size: PageSize = 'a4'): string {
  switch (node.type) {
    case 'paragraph': return paragraph(node, relationships, header ? { style: 'Strong' } : {});
    case 'heading': {
      const level = Math.min(6, Math.max(1, typeof node.attrs?.level === 'number' ? node.attrs.level : 1)) as 1 | 2 | 3 | 4 | 5 | 6;
      return paragraph(node, relationships, { style: `Heading${level}` });
    }
    case 'blockquote': return (node.content ?? []).map((child) => child.type === 'paragraph' ? paragraph(child, relationships, { style: 'Quote' }) : blocks(child, relationships, header, size)).join('');
    case 'bulletList': return listParagraphs(node, relationships, BULLET_NUM_ID);
    case 'orderedList': return listParagraphs(node, relationships, ORDERED_NUM_ID);
    case 'horizontalRule': return `<w:p><w:pPr>${element('w:pBdr', {}, element('w:bottom', { 'w:val': 'single', 'w:sz': 6, 'w:space': 1, 'w:color': 'auto' }))}</w:pPr></w:p>`;
    case 'table': return tableXml(node, relationships, size);
    default: return (node.content ?? []).map((child) => blocks(child, relationships, header, size)).join('');
  }
}

function stylesXml(): string {
  const docDefaults = element('w:docDefaults', {},
    element('w:rPrDefault', {}, element('w:rPr', {},
      `${element('w:rFonts', { 'w:ascii': DEFAULT_FONT, 'w:hAnsi': DEFAULT_FONT, 'w:eastAsia': DEFAULT_FONT, 'w:cs': 'Times New Roman' })}${element('w:sz', { 'w:val': pointsToHalfPoints(DEFAULT_FONT_POINTS) })}${element('w:szCs', { 'w:val': pointsToHalfPoints(DEFAULT_FONT_POINTS) })}`)) +
    element('w:pPrDefault', {}, element('w:pPr', {},
      `${element('w:spacing', { 'w:after': SPACE_AFTER_TWIPS, 'w:before': SPACE_BEFORE_TWIPS, 'w:line': LINE_RULE_AUTO, 'w:lineRule': 'auto' })}${element('w:widowControl')}`)));

  // docDefaults already carries the font, but stating it on Normal too keeps readers that ignore docDefaults correct.
  const normal = element('w:style', { 'w:type': 'paragraph', 'w:default': '1', 'w:styleId': 'Normal' },
    `${element('w:name', { 'w:val': 'Normal' })}${element('w:qFormat')}` +
    element('w:rPr', {}, `${element('w:rFonts', { 'w:ascii': DEFAULT_FONT, 'w:hAnsi': DEFAULT_FONT })}${element('w:sz', { 'w:val': pointsToHalfPoints(DEFAULT_FONT_POINTS) })}${element('w:szCs', { 'w:val': pointsToHalfPoints(DEFAULT_FONT_POINTS) })}`));
  const headings = (Object.entries(HEADINGS) as Array<[string, (typeof HEADINGS)[1]]>).map(([level, style]) => {
    const font = style.light ? element('w:rFonts', { 'w:ascii': HEADING_FONT, 'w:hAnsi': HEADING_FONT }) : '';
    return element('w:style', { 'w:type': 'paragraph', 'w:styleId': `Heading${level}` },
      `${element('w:name', { 'w:val': `heading ${level}` })}${element('w:basedOn', { 'w:val': 'Normal' })}${element('w:next', { 'w:val': 'Normal' })}${element('w:qFormat')}` +
      element('w:pPr', {}, `${element('w:keepNext')}${element('w:keepLines')}${element('w:spacing', { 'w:before': style.spaceBefore, 'w:after': 0 })}${element('w:outlineLvl', { 'w:val': Number(level) - 1 })}`) +
      element('w:rPr', {}, `${font}${element('w:color', { 'w:val': style.color })}${element('w:sz', { 'w:val': pointsToHalfPoints(style.points) })}${element('w:szCs', { 'w:val': pointsToHalfPoints(style.points) })}`));
  }).join('');
  const listParagraph = element('w:style', { 'w:type': 'paragraph', 'w:styleId': 'ListParagraph' },
    `${element('w:name', { 'w:val': 'List Paragraph' })}${element('w:basedOn', { 'w:val': 'Normal' })}${element('w:qFormat')}` +
    element('w:pPr', {}, `${element('w:ind', { 'w:left': 720 })}${element('w:contextualSpacing')}`));
  const quote = element('w:style', { 'w:type': 'paragraph', 'w:styleId': 'Quote' },
    `${element('w:name', { 'w:val': 'Quote' })}${element('w:basedOn', { 'w:val': 'Normal' })}${element('w:qFormat')}` +
    element('w:pPr', {}, `${element('w:spacing', { 'w:before': 200, 'w:after': 200 })}${element('w:ind', { 'w:left': 720, 'w:right': 720 })}`) +
    element('w:rPr', {}, `${element('w:i')}${element('w:color', { 'w:val': '404040' })}`));
  const strong = element('w:style', { 'w:type': 'paragraph', 'w:styleId': 'Strong' },
    `${element('w:name', { 'w:val': 'Strong Paragraph' })}${element('w:basedOn', { 'w:val': 'Normal' })}` + element('w:rPr', {}, element('w:b')));
  const hyperlink = element('w:style', { 'w:type': 'character', 'w:styleId': 'Hyperlink' },
    `${element('w:name', { 'w:val': 'Hyperlink' })}` + element('w:rPr', {}, `${element('w:color', { 'w:val': '0563C1' })}${element('w:u', { 'w:val': 'single' })}`));
  const tableGrid = element('w:style', { 'w:type': 'table', 'w:styleId': 'TableGrid' }, `${element('w:name', { 'w:val': 'Table Grid' })}${element('w:basedOn', { 'w:val': 'TableNormal' })}`);

  return `${XML_DECLARATION}<w:styles ${W}>${docDefaults}${normal}${headings}${listParagraph}${quote}${strong}${hyperlink}${tableGrid}</w:styles>`;
}

function numberingXml(): string {
  const level = (format: string, text: string, symbolFont?: string) => element('w:lvl', { 'w:ilvl': 0 },
    `${element('w:start', { 'w:val': 1 })}${element('w:numFmt', { 'w:val': format })}${element('w:lvlText', { 'w:val': text })}${element('w:lvlJc', { 'w:val': 'left' })}` +
    element('w:pPr', {}, element('w:ind', { 'w:left': 720, 'w:hanging': 360 })) +
    (symbolFont ? element('w:rPr', {}, element('w:rFonts', { 'w:ascii': symbolFont, 'w:hAnsi': symbolFont, 'w:hint': 'default' })) : ''));
  const abstract = (id: number, body: string) => element('w:abstractNum', { 'w:abstractNumId': id }, `${element('w:multiLevelType', { 'w:val': 'hybridMultilevel' })}${body}`);
  const num = (id: number, abstractId: number) => element('w:num', { 'w:numId': id }, element('w:abstractNumId', { 'w:val': abstractId }));
  return `${XML_DECLARATION}<w:numbering ${W}>${abstract(0, level('bullet', '•', 'Symbol'))}${abstract(1, level('decimal', '%1.'))}${num(BULLET_NUM_ID, 0)}${num(ORDERED_NUM_ID, 1)}</w:numbering>`;
}

function sectionProperties(size: PageSize): string {
  const page = PAGES[size];
  return element('w:sectPr', {},
    element('w:pgSz', { 'w:w': page.width, 'w:h': page.height }) +
    element('w:pgMar', { 'w:top': page.margin.top, 'w:right': page.margin.right, 'w:bottom': page.margin.bottom, 'w:left': page.margin.left, 'w:header': 720, 'w:footer': 720, 'w:gutter': 0 }) +
    element('w:cols', { 'w:space': 720 }) +
    element('w:docGrid', { 'w:linePitch': 360 }));
}

const CONTENT_TYPES = `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const PACKAGE_RELS = `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const coreXml = (title: string, modified: string) =>
  `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified></cp:coreProperties>`;

function documentRels(relationships: Relationship[]): string {
  const links = relationships.map((relationship) =>
    `<Relationship Id="${relationship.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(relationship.target)}" TargetMode="External"/>`).join('');
  return `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${links}</Relationships>`;
}

export type ExportOptions = { title?: string; language?: string; pageSize?: PageSize; modified?: Date };

// The body XML plus the hyperlink relationships it needs; exported separately so tests can read it directly.
export function documentXml(value: unknown, size: PageSize): { xml: string; relationships: Relationship[] } {
  const document: EditorDocument = EditorDocumentSchema.parse(value);
  const relationships: Relationship[] = [];
  const body = document.content.map((node) => blocks(node, relationships, false, size)).join('') || '<w:p/>';
  return { xml: `${XML_DECLARATION}<w:document ${W} ${R}><w:body>${body}${sectionProperties(size)}</w:body></w:document>`, relationships };
}

export async function editorDocumentToDocx(value: unknown, options: ExportOptions = {}): Promise<Uint8Array> {
  const size = options.pageSize ?? defaultPageSize(options.language ?? 'id');
  const { xml, relationships } = documentXml(value, size);
  const encoder = new TextEncoder();
  const modified = (options.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(PACKAGE_RELS) },
    { name: 'docProps/core.xml', data: encoder.encode(coreXml(options.title ?? 'Document', modified)) },
    { name: 'word/document.xml', data: encoder.encode(xml) },
    { name: 'word/styles.xml', data: encoder.encode(stylesXml()) },
    { name: 'word/numbering.xml', data: encoder.encode(numberingXml()) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(documentRels(relationships)) },
  ];
  return zip(entries);
}

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// A filename Word, macOS and Linux all accept; the fallback keeps an all-punctuation title from producing an empty name.
export const docxFilename = (title: string) => `${(title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document')}.docx`;
