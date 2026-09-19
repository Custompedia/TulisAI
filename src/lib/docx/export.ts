import { EditorDocumentSchema } from '../contracts';
import type { EditorDocument, EditorNode } from '../editor/document';
import { zip, type ZipEntry } from './zip';
import { element, escapeXml, XML_DECLARATION } from './xml';
import {
  alignmentFrom, asColumns, asOrientation, columnWidth, COLUMN_GAP_TWIPS, contentWidth, DEFAULT_FONT, DEFAULT_FONT_POINTS, defaultPageSize,
  FOOTER_DISTANCE_TWIPS, fontFromStack, fontLineFactor, HEADER_DISTANCE_TWIPS, HEADING_FONT, HEADINGS, HIGHLIGHT_COLORS, JUSTIFICATION,
  LINE_HEIGHT, LINE_RULE_AUTO, pageGeometry, pointsToHalfPoints, SPACE_AFTER_TWIPS, SPACE_BEFORE_TWIPS, TWIPS_PER_PX,
  type Orientation, type PageMargins, type PageSize,
} from './office-defaults';
import { BORDER_SIDES, borderAttr, DEFAULT_BORDER, ooxmlBorderAttrs, parseCssBorder } from './borders';
import { runningParts, type RunningText } from './running';
import { footnoteText } from '../editor/extensions/footnote';
import { parseTabStops } from '../editor/extensions/paragraph-format';
import { safeAnchor } from '../editor/extensions/anchors';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

type Mark = NonNullable<EditorNode['marks']>[number];
type Relationship = { id: string; target: string };
// One w:num per list node, so every list keeps its own format, start and level.
type ListDefinition = { id: number; level: number; ordered: boolean; type: string; start: number; bullet: string };
type Writer = {
  relationships: Relationship[]; lists: ListDefinition[]; size: PageSize; margins: PageMargins;
  orientation: Orientation; columns: number; footnotes: string[]; bookmarks: number;
};

const ORDERED_FORMAT: Record<string, string> = { '1': 'decimal', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman' };
const BULLETS: Record<string, { glyph: string; font?: string }> = { disc: { glyph: '•' }, circle: { glyph: 'o', font: 'Courier New' }, square: { glyph: '▪' } };
const HIGHLIGHT_NAMES = new Map(Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => [hex, name]));

// Word keeps significant spaces only when the run says so; a tab is its own element.
const textElements = (value: string) => value.split('\t').map((part, index) => `${index ? '<w:tab/>' : ''}${part ? `<w:t xml:space="preserve">${escapeXml(part)}</w:t>` : ''}`).join('');

// CSS colours as OOXML's 6-digit hex; anything unparseable is dropped rather than written wrong.
export function hexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/iu.exec(color);
  if (short) return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#([\da-f]{6})(?:[\da-f]{2})?$/iu.exec(color);
  if (long) return long[1]!.toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/iu.exec(color);
  return rgb ? rgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
}

// CSS lengths as twips; unitless numbers are read as points.
export function lengthTwips(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(-?[\d.]+)(pt|px|in|cm|mm|em|rem)?$/u.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const perUnit: Record<string, number> = { pt: 20, px: TWIPS_PER_PX, in: 1440, cm: 1440 / 2.54, mm: 144 / 2.54, em: DEFAULT_FONT_POINTS * 20, rem: DEFAULT_FONT_POINTS * 20 };
  return Number.isFinite(amount) ? Math.round(amount * perUnit[match[2] ?? 'pt']!) : null;
}

const fontOf = (marks: Mark[] | undefined) => {
  const style = marks?.find((mark) => mark.type === 'textStyle');
  return typeof style?.attrs?.fontFamily === 'string' ? fontFromStack(style.attrs.fontFamily) : null;
};

function runProperties(marks: Mark[] | undefined, link: boolean): string {
  const byType = new Map((marks ?? []).map((mark) => [mark.type, mark]));
  const style = byType.get('textStyle')?.attrs ?? {};
  const parts: string[] = [];
  if (link) parts.push(element('w:rStyle', { 'w:val': 'Hyperlink' }));
  const font = fontOf(marks);
  if (font) parts.push(element('w:rFonts', { 'w:ascii': font, 'w:hAnsi': font, 'w:cs': font }));
  if (byType.has('bold')) parts.push(element('w:b'));
  if (byType.has('italic')) parts.push(element('w:i'));
  if (byType.has('strike')) parts.push(element('w:strike'));
  const color = hexColor(style.color);
  if (color) parts.push(element('w:color', { 'w:val': color }));
  const size = lengthTwips(style.fontSize);
  if (size && size > 0) { const half = Math.round(size / 10); parts.push(element('w:sz', { 'w:val': half }), element('w:szCs', { 'w:val': half })); }
  const highlight = byType.get('highlight');
  const highlightHex = highlight ? hexColor(highlight.attrs?.color) ?? HIGHLIGHT_COLORS.yellow! : null;
  const named = highlightHex ? HIGHLIGHT_NAMES.get(highlightHex) : undefined;
  if (named) parts.push(element('w:highlight', { 'w:val': named }));
  if (byType.has('underline')) parts.push(element('w:u', { 'w:val': 'single' }));
  // A highlight colour Word cannot name, or a background colour, travels as run shading.
  const shade = (highlightHex && !named ? highlightHex : null) ?? hexColor(style.backgroundColor);
  if (shade) parts.push(element('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': shade }));
  if (byType.has('superscript')) parts.push(element('w:vertAlign', { 'w:val': 'superscript' }));
  else if (byType.has('subscript')) parts.push(element('w:vertAlign', { 'w:val': 'subscript' }));
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function runs(node: EditorNode, writer: Writer): string {
  if (node.type === 'hardBreak') return `<w:r>${element('w:br')}</w:r>`;
  // A footnote marker: the note itself is written into footnotes.xml, numbered by Word from the reference order.
  if (node.type === 'footnote') {
    const text = footnoteText(node.attrs?.text);
    writer.footnotes.push(text);
    const id = writer.footnotes.length;
    return `<w:r>${element('w:rPr', {}, element('w:rStyle', { 'w:val': 'FootnoteReference' }))}${element('w:footnoteReference', { 'w:id': id })}</w:r>`;
  }
  if (node.type !== 'text') return (node.content ?? []).map((child) => runs(child, writer)).join('');
  const text = node.text ?? '';
  if (!text) return '';
  const link = (node.marks ?? []).find((mark) => mark.type === 'link');
  const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : '';
  const run = `<w:r>${runProperties(node.marks, Boolean(href))}${textElements(text)}</w:r>`;
  if (!href) return run;
  const id = `rId${writer.relationships.length + 10}`;
  writer.relationships.push({ id, target: href });
  return element('w:hyperlink', { 'r:id': id }, run);
}

type ParagraphOptions = { style?: string; list?: { numId: number; level: number }; indent?: number; hanging?: number; prefix?: string; header?: boolean };

function paragraphProperties(node: EditorNode, options: ParagraphOptions): string {
  const attrs = node.attrs ?? {};
  const properties: string[] = [];
  if (options.style) properties.push(element('w:pStyle', { 'w:val': options.style }));
  if (options.list) properties.push(element('w:numPr', {}, `${element('w:ilvl', { 'w:val': options.list.level })}${element('w:numId', { 'w:val': options.list.numId })}`));
  // w:pPr has a fixed child order: borders and tab stops come before spacing and indents.
  const sides = BORDER_SIDES.map((side) => ({ side, line: parseCssBorder(attrs[borderAttr(side)]) })).filter((entry) => entry.line !== undefined);
  if (sides.length) properties.push(element('w:pBdr', {}, sides.map((entry) => element(`w:${entry.side}`, { ...ooxmlBorderAttrs(entry.line!), 'w:space': 1 })).join('')));
  const stops = parseTabStops(attrs.tabStops);
  if (stops.length) properties.push(element('w:tabs', {}, stops.map((stop) => element('w:tab', { 'w:val': stop.align === 'decimal' ? 'decimal' : stop.align, 'w:pos': Math.round(stop.position * 20) })).join('')));
  // List items sit tight on the canvas, so once List Paragraph's contextual spacing is off both sides are stated.
  const listed = options.style === 'ListParagraph' && (attrs.spaceBefore != null || attrs.spaceAfter != null);
  const before = lengthTwips(attrs.spaceBefore) ?? (listed ? 0 : null); const after = lengthTwips(attrs.spaceAfter) ?? (listed ? 0 : null);
  let line: Record<string, string | number> = {};
  // The canvas ratio already includes the font's own line height, which Word multiplies in again.
  const font = fontOf((node.content ?? []).find((child) => child.type === 'text')?.marks) ?? (node.type === 'heading' ? HEADING_FONT : DEFAULT_FONT);
  const factor = fontLineFactor(font);
  if (typeof attrs.lineHeight === 'string') {
    const exact = lengthTwips(/[a-z%]$/iu.test(attrs.lineHeight) ? attrs.lineHeight : '');
    const ratio = Number(attrs.lineHeight);
    if (exact && exact > 0) line = { 'w:line': exact, 'w:lineRule': 'exact' };
    else if (Number.isFinite(ratio) && ratio > 0) line = { 'w:line': Math.round((ratio / factor) * 240), 'w:lineRule': 'auto' };
  } else if (factor !== fontLineFactor(DEFAULT_FONT)) line = { 'w:line': Math.round((LINE_HEIGHT / factor) * 240), 'w:lineRule': 'auto' };
  if (before !== null || after !== null || line['w:line'] !== undefined) properties.push(element('w:spacing', { 'w:before': before ?? undefined, 'w:after': after ?? undefined, ...line }));
  const left = lengthTwips(attrs.indentLeft) ?? options.indent ?? null; const right = lengthTwips(attrs.indentRight);
  // A list marker hangs to the left of its text, which is the only place `hanging` comes from.
  const first = lengthTwips(attrs.indentFirstLine) ?? (options.hanging ? -options.hanging : null);
  if (left !== null || right !== null || first !== null) {
    properties.push(element('w:ind', { 'w:left': left ?? undefined, 'w:right': right ?? undefined, ...(first !== null ? (first < 0 ? { 'w:hanging': -first } : { 'w:firstLine': first }) : {}) }));
  }
  // List Paragraph drops spacing between items; stated spacing has to switch that off to survive.
  if (listed) properties.push(element('w:contextualSpacing', { 'w:val': 0 }));
  const align = alignmentFrom(attrs.textAlign);
  if (align) properties.push(element('w:jc', { 'w:val': JUSTIFICATION[align] }));
  return properties.length ? `<w:pPr>${properties.join('')}</w:pPr>` : '';
}

function paragraph(node: EditorNode, writer: Writer, options: ParagraphOptions = {}): string {
  const prefix = options.prefix ? `<w:r>${textElements(options.prefix)}</w:r>` : '';
  const body = (node.content ?? []).map((child) => runs(child, writer)).join('');
  return `<w:p>${paragraphProperties(node, options)}${prefix}${body}</w:p>`;
}

const LIST_STEP_TWIPS = 720;
const LIST_HANGING_TWIPS = 360;

function listParagraphs(node: EditorNode, writer: Writer, level: number, base = 0): string {
  const ordered = node.type === 'orderedList';
  const attrs = node.attrs ?? {};
  // How far this level sits from the one around it, so an imported list keeps the indent it came with.
  const indent = base + (lengthTwips(attrs.indent) ?? LIST_STEP_TWIPS);
  const definition: ListDefinition = {
    id: writer.lists.length + 1, level: Math.min(level, 8), ordered,
    type: typeof attrs.type === 'string' && ORDERED_FORMAT[attrs.type] ? attrs.type : '1',
    start: typeof attrs.start === 'number' && attrs.start >= 0 ? Math.floor(attrs.start) : 1,
    bullet: typeof attrs.listStyle === 'string' && BULLETS[attrs.listStyle] ? attrs.listStyle : 'disc',
  };
  writer.lists.push(definition);
  return (node.content ?? []).flatMap((item) => (item.content ?? []).map((block, index) => {
    // The marker belongs to the item's first block; later blocks continue the item at its indent.
    if (block.type === 'paragraph') {
      return paragraph(block, writer, index === 0
        ? { style: 'ListParagraph', list: { numId: definition.id, level: definition.level }, indent, hanging: LIST_HANGING_TWIPS }
        : { style: 'ListParagraph', indent });
    }
    if (block.type === 'bulletList' || block.type === 'orderedList') return listParagraphs(block, writer, level + 1, indent);
    if (block.type === 'taskList') return taskParagraphs(block, writer, level + 1);
    return blocks(block, writer);
  })).join('');
}

// Word has no checklist; a ballot box keeps the state readable.
function taskParagraphs(node: EditorNode, writer: Writer, level: number): string {
  return (node.content ?? []).flatMap((item) => (item.content ?? []).map((block, index) => {
    if (block.type === 'paragraph') return paragraph(block, writer, { indent: level ? 720 * level : undefined, prefix: index === 0 ? (item.attrs?.checked === true ? '☒ ' : '☐ ') : undefined });
    if (block.type === 'taskList') return taskParagraphs(block, writer, level + 1);
    if (block.type === 'bulletList' || block.type === 'orderedList') return listParagraphs(block, writer, level + 1);
    return blocks(block, writer);
  })).join('');
}

// Only the sides the cell actually states; the rest keep the table's own border.
function cellBorders(attrs: Record<string, unknown>): string {
  const sides = BORDER_SIDES.map((side) => ({ side, line: parseCssBorder(attrs[borderAttr(side)]) })).filter((entry) => entry.line !== undefined);
  if (!sides.length) return '';
  return element('w:tcBorders', {}, sides.map((entry) => element(`w:${entry.side}`, ooxmlBorderAttrs(entry.line!))).join(''));
}

function tableXml(node: EditorNode, writer: Writer): string {
  const rows = node.content ?? [];
  const spanOf = (cell: EditorNode) => typeof cell.attrs?.colspan === 'number' && cell.attrs.colspan > 1 ? Math.floor(cell.attrs.colspan) : 1;
  const rowSpanOf = (cell: EditorNode) => typeof cell.attrs?.rowspan === 'number' && cell.attrs.rowspan > 1 ? Math.floor(cell.attrs.rowspan) : 1;

  // Lay the cells onto a grid first: a rowspan occupies columns in the rows below it, which Word marks with vMerge continuations.
  const occupied: Array<Map<number, { span: number }>> = rows.map(() => new Map());
  const placed = rows.map((row, rowIndex) => {
    let column = 0;
    return (row.content ?? []).map((cell) => {
      while (occupied[rowIndex]!.has(column)) column += occupied[rowIndex]!.get(column)!.span;
      const span = spanOf(cell); const rowspan = rowSpanOf(cell);
      for (let below = 1; below < rowspan && rowIndex + below < rows.length; below++) occupied[rowIndex + below]!.set(column, { span });
      const at = column; column += span;
      return { cell, column: at, span, rowspan };
    });
  });
  const columns = Math.max(1, ...placed.map((row, rowIndex) => Math.max(0, ...row.map((slot) => slot.column + slot.span), ...[...occupied[rowIndex]!].map(([column, slot]) => column + slot.span))));

  const widths: Array<number | null> = Array(columns).fill(null);
  for (const row of placed) for (const slot of row) {
    const colwidth = Array.isArray(slot.cell.attrs?.colwidth) ? slot.cell.attrs.colwidth as unknown[] : [];
    colwidth.forEach((width, offset) => { if (typeof width === 'number' && width > 0 && widths[slot.column + offset] === null) widths[slot.column + offset] = Math.round(width * TWIPS_PER_PX); });
  }
  const known = widths.filter((width): width is number => width !== null);
  const fallback = Math.max(360, Math.floor((contentWidth(writer.size, writer.margins) - known.reduce((sum, width) => sum + width, 0)) / Math.max(1, columns - known.length)));
  const grid = widths.map((width) => width ?? (known.length === columns ? 0 : fallback));

  // The table default every cell falls back to; a cell that states its own side overrides it in w:tcBorders.
  const borders = element('w:tblBorders', {}, (['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const)
    .map((side) => element(`w:${side}`, ooxmlBorderAttrs(DEFAULT_BORDER))).join(''));
  const auto = node.attrs?.width === 'auto';
  const align = node.attrs?.align === 'center' || node.attrs?.align === 'right' ? node.attrs.align : null;
  const properties = element('w:tblPr', {}, `${element('w:tblStyle', { 'w:val': 'TableGrid' })}` +
    `${element('w:tblW', auto ? { 'w:w': 0, 'w:type': 'auto' } : { 'w:w': 5000, 'w:type': 'pct' })}` +
    `${align ? element('w:jc', { 'w:val': align }) : ''}${borders}${element('w:tblLayout', { 'w:type': auto ? 'autofit' : 'fixed' })}`);
  const gridXml = element('w:tblGrid', {}, grid.map((width) => element('w:gridCol', { 'w:w': width })).join(''));
  const widthOf = (column: number, span: number) => grid.slice(column, column + span).reduce((sum, width) => sum + width, 0);

  const body = placed.map((row, rowIndex) => {
    const header = row.length > 0 && row.every((slot) => slot.cell.type === 'tableHeader');
    const continuations = [...occupied[rowIndex]!].map(([column, slot]) => ({ column, span: slot.span, xml: element('w:tc', {},
      `${element('w:tcPr', {}, `${element('w:tcW', { 'w:w': widthOf(column, slot.span), 'w:type': 'dxa' })}${slot.span > 1 ? element('w:gridSpan', { 'w:val': slot.span }) : ''}${element('w:vMerge')}`)}<w:p/>`) }));
    const cells = row.map((slot) => {
      const attrs = slot.cell.attrs ?? {};
      const shading = hexColor(attrs.background);
      const vAlign = attrs.verticalAlign === 'middle' ? 'center' : attrs.verticalAlign === 'bottom' ? 'bottom' : null;
      const cellProperties = element('w:tcPr', {},
        element('w:tcW', { 'w:w': widthOf(slot.column, slot.span), 'w:type': 'dxa' }) +
        (slot.span > 1 ? element('w:gridSpan', { 'w:val': slot.span }) : '') +
        (slot.rowspan > 1 ? element('w:vMerge', { 'w:val': 'restart' }) : '') +
        cellBorders(attrs) +
        (shading ? element('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': shading }) : '') +
        (vAlign ? element('w:vAlign', { 'w:val': vAlign }) : ''));
      const content = (slot.cell.content ?? []).map((block) => blocks(block, writer, slot.cell.type === 'tableHeader')).join('') || '<w:p/>';
      return { column: slot.column, xml: element('w:tc', {}, `${cellProperties}${content}`) };
    });
    const ordered = [...cells, ...continuations].sort((a, b) => a.column - b.column).map((cell) => cell.xml).join('');
    return element('w:tr', {}, `${header ? element('w:trPr', {}, element('w:tblHeader')) : ''}${ordered}`);
  }).join('');
  return element('w:tbl', {}, `${properties}${gridXml}${body}`);
}

// Word's TOC field, with the entries we generated as its cached result, so the list reads correctly before
// Word refreshes it and carries real page numbers after.
function tocXml(node: EditorNode, writer: Writer): string {
  const entries = (node.content ?? []).filter((child) => child.type === 'paragraph');
  if (!entries.length) return '';
  const begin = `<w:r>${element('w:fldChar', { 'w:fldCharType': 'begin', 'w:dirty': 'true' })}</w:r>` +
    `<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>` +
    `<w:r>${element('w:fldChar', { 'w:fldCharType': 'separate' })}</w:r>`;
  const end = `<w:r>${element('w:fldChar', { 'w:fldCharType': 'end' })}</w:r>`;
  return entries.map((entry, index) => {
    const body = (entry.content ?? []).map((child) => runs(child, writer)).join('');
    return `<w:p>${paragraphProperties(entry, {})}${index === 0 ? begin : ''}${body}${index === entries.length - 1 ? end : ''}</w:p>`;
  }).join('');
}

function blocks(node: EditorNode, writer: Writer, header = false): string {
  switch (node.type) {
    case 'paragraph': return paragraph(node, writer, header ? { style: 'Strong' } : {});
    case 'heading': {
      const level = Math.min(6, Math.max(1, typeof node.attrs?.level === 'number' ? node.attrs.level : 1)) as 1 | 2 | 3 | 4 | 5 | 6;
      const body = paragraph(node, writer, { style: `Heading${level}` });
      const anchor = safeAnchor(node.attrs?.id);
      if (!anchor) return body;
      // A bookmark around the heading is what a TOC field links to and what Word keeps when it refreshes one.
      const id = ++writer.bookmarks;
      return `${element('w:bookmarkStart', { 'w:id': id, 'w:name': anchor })}${body}${element('w:bookmarkEnd', { 'w:id': id })}`;
    }
    case 'tableOfContents': return tocXml(node, writer);
    case 'blockquote': return (node.content ?? []).map((child) => child.type === 'paragraph' ? paragraph(child, writer, { style: 'Quote' }) : blocks(child, writer, header)).join('');
    case 'bulletList': case 'orderedList': return listParagraphs(node, writer, 0);
    case 'taskList': return taskParagraphs(node, writer, 0);
    case 'horizontalRule': return `<w:p><w:pPr>${element('w:pBdr', {}, element('w:bottom', { 'w:val': 'single', 'w:sz': 6, 'w:space': 1, 'w:color': 'auto' }))}</w:pPr></w:p>`;
    case 'pageBreak': return `<w:p><w:r>${element('w:br', { 'w:type': 'page' })}</w:r></w:p>`;
    case 'table': return tableXml(node, writer);
    default: return (node.content ?? []).map((child) => blocks(child, writer, header)).join('');
  }
}

function stylesXml(width: number): string {
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
    `${element('w:name', { 'w:val': 'Strong Paragraph' })}${element('w:basedOn', { 'w:val': 'Normal' })}` +
    element('w:pPr', {}, element('w:spacing', { 'w:after': 0 })) + element('w:rPr', {}, element('w:b')));
  const hyperlink = element('w:style', { 'w:type': 'character', 'w:styleId': 'Hyperlink' },
    `${element('w:name', { 'w:val': 'Hyperlink' })}` + element('w:rPr', {}, `${element('w:color', { 'w:val': '0563C1' })}${element('w:u', { 'w:val': 'single' })}`));
  // Cell paragraphs sit tight in Word's Table Grid, as they do on the canvas.
  const tableGrid = element('w:style', { 'w:type': 'table', 'w:styleId': 'TableGrid' },
    `${element('w:name', { 'w:val': 'Table Grid' })}${element('w:pPr', {}, element('w:spacing', { 'w:after': 0 }))}`);

  // Footnote text is 10 pt with no spacing; its reference is the superscript number in the body.
  const footnoteText = element('w:style', { 'w:type': 'paragraph', 'w:styleId': 'FootnoteText' },
    `${element('w:name', { 'w:val': 'footnote text' })}${element('w:basedOn', { 'w:val': 'Normal' })}` +
    element('w:pPr', {}, `${element('w:spacing', { 'w:after': 0, 'w:line': 240, 'w:lineRule': 'auto' })}`) +
    element('w:rPr', {}, `${element('w:sz', { 'w:val': pointsToHalfPoints(10) })}${element('w:szCs', { 'w:val': pointsToHalfPoints(10) })}`));
  const footnoteReference = element('w:style', { 'w:type': 'character', 'w:styleId': 'FootnoteReference' },
    `${element('w:name', { 'w:val': 'footnote reference' })}` + element('w:rPr', {}, element('w:vertAlign', { 'w:val': 'superscript' })));
  // Header and footer carry Word's centre and right tab stops, so a centred or right-aligned line lands where Word puts it.
  const running = (id: 'Header' | 'Footer', width: number) => element('w:style', { 'w:type': 'paragraph', 'w:styleId': id },
    `${element('w:name', { 'w:val': id.toLowerCase() })}${element('w:basedOn', { 'w:val': 'Normal' })}` +
    element('w:pPr', {}, `${element('w:tabs', {}, `${element('w:tab', { 'w:val': 'center', 'w:pos': Math.round(width / 2) })}${element('w:tab', { 'w:val': 'right', 'w:pos': width })}`)}${element('w:spacing', { 'w:after': 0, 'w:line': 240, 'w:lineRule': 'auto' })}`));

  return `${XML_DECLARATION}<w:styles ${W}>${docDefaults}${normal}${headings}${listParagraph}${quote}${strong}${hyperlink}${tableGrid}${footnoteText}${footnoteReference}${running('Header', width)}${running('Footer', width)}</w:styles>`;
}

function numberingXml(lists: ListDefinition[]): string {
  const level = (ilvl: number, list: ListDefinition | null) => {
    // Levels other than the list's own keep a sensible default, in case Word's UI promotes or demotes an item.
    const ordered = list ? list.ordered : ilvl % 2 === 1;
    const format = ordered ? ORDERED_FORMAT[list?.type ?? '1']! : 'bullet';
    const bullet = BULLETS[list?.bullet ?? 'disc']!;
    const text = ordered ? `%${ilvl + 1}.` : bullet.glyph;
    return element('w:lvl', { 'w:ilvl': ilvl },
      `${element('w:start', { 'w:val': list?.start ?? 1 })}${element('w:numFmt', { 'w:val': format })}${element('w:lvlText', { 'w:val': text })}${element('w:lvlJc', { 'w:val': 'left' })}` +
      element('w:pPr', {}, element('w:ind', { 'w:left': 720 * (ilvl + 1), 'w:hanging': 360 })) +
      (!ordered && bullet.font ? element('w:rPr', {}, element('w:rFonts', { 'w:ascii': bullet.font, 'w:hAnsi': bullet.font, 'w:hint': 'default' })) : ''));
  };
  const abstracts = lists.map((list) => element('w:abstractNum', { 'w:abstractNumId': list.id },
    `${element('w:multiLevelType', { 'w:val': 'hybridMultilevel' })}${Array.from({ length: 9 }, (_, ilvl) => level(ilvl, ilvl === list.level ? list : null)).join('')}`)).join('');
  const nums = lists.map((list) => element('w:num', { 'w:numId': list.id }, element('w:abstractNumId', { 'w:val': list.id }))).join('');
  return `${XML_DECLARATION}<w:numbering ${W}>${abstracts}${nums}</w:numbering>`;
}

function sectionProperties(writer: Writer, refs: { header?: string; footer?: string }): string {
  const page = pageGeometry(writer.size, writer.orientation);
  const margins = writer.margins;
  const columns = asColumns(writer.columns);
  return element('w:sectPr', {},
    (refs.header ? element('w:headerReference', { 'w:type': 'default', 'r:id': refs.header }) : '') +
    (refs.footer ? element('w:footerReference', { 'w:type': 'default', 'r:id': refs.footer }) : '') +
    element('w:pgSz', { 'w:w': page.width, 'w:h': page.height, 'w:orient': writer.orientation === 'landscape' ? 'landscape' : undefined }) +
    element('w:pgMar', { 'w:top': margins.top, 'w:right': margins.right, 'w:bottom': margins.bottom, 'w:left': margins.left, 'w:header': HEADER_DISTANCE_TWIPS, 'w:footer': FOOTER_DISTANCE_TWIPS, 'w:gutter': 0 }) +
    (columns > 1
      ? element('w:cols', { 'w:num': columns, 'w:space': COLUMN_GAP_TWIPS, 'w:equalWidth': 1 })
      : element('w:cols', { 'w:space': 720 })) +
    element('w:docGrid', { 'w:linePitch': 360 }));
}

// A field whose cached result is the number Word will recompute, so the file reads correctly before it is opened.
const field = (instruction: string, cached: string) =>
  `<w:r>${element('w:fldChar', { 'w:fldCharType': 'begin' })}</w:r>` +
  `<w:r><w:instrText xml:space="preserve"> ${escapeXml(instruction)} </w:instrText></w:r>` +
  `<w:r>${element('w:fldChar', { 'w:fldCharType': 'separate' })}</w:r>` +
  `<w:r><w:t>${escapeXml(cached)}</w:t></w:r>` +
  `<w:r>${element('w:fldChar', { 'w:fldCharType': 'end' })}</w:r>`;

function runningXml(kind: 'hdr' | 'ftr', running: RunningText): string {
  const style = kind === 'hdr' ? 'Header' : 'Footer';
  const body = runningParts(running.text).map((part) => part.kind === 'text'
    ? `<w:r>${textElements(part.value)}</w:r>`
    : field(part.field, '1')).join('');
  const properties = `<w:pPr>${element('w:pStyle', { 'w:val': style })}${running.align === 'left' ? '' : element('w:jc', { 'w:val': running.align })}</w:pPr>`;
  return `${XML_DECLARATION}<w:${kind} ${W} ${R}><w:p>${properties}${body}</w:p></w:${kind}>`;
}

function footnotesXml(notes: string[]): string {
  const spacing = `<w:pPr>${element('w:pStyle', { 'w:val': 'FootnoteText' })}</w:pPr>`;
  // Word expects the separator pair before the real notes; without them it repairs the file on open.
  const separator = (id: number, type: string, mark: string) =>
    element('w:footnote', { 'w:type': type, 'w:id': id }, `<w:p><w:pPr>${element('w:spacing', { 'w:after': 0, 'w:line': 240, 'w:lineRule': 'auto' })}</w:pPr><w:r>${element(mark)}</w:r></w:p>`);
  const body = notes.map((text, index) => element('w:footnote', { 'w:id': index + 1 },
    `<w:p>${spacing}<w:r>${element('w:rPr', {}, element('w:rStyle', { 'w:val': 'FootnoteReference' }))}${element('w:footnoteRef')}</w:r>` +
    `<w:r>${textElements(` ${text}`)}</w:r></w:p>`)).join('');
  return `${XML_DECLARATION}<w:footnotes ${W} ${R}>${separator(-1, 'separator', 'w:separator')}${separator(0, 'continuationSeparator', 'w:continuationSeparator')}${body}</w:footnotes>`;
}

const OVERRIDE: Record<string, string> = {
  'word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  'word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  'word/numbering.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  'word/footnotes.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  'word/header1.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  'word/footer1.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  'docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
};

const contentTypes = (parts: string[]) =>
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
  parts.filter((part) => OVERRIDE[part]).map((part) => `<Override PartName="/${part}" ContentType="${OVERRIDE[part]}"/>`).join('') +
  `</Types>`;

const PACKAGE_RELS = `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const coreXml = (title: string, modified: string) =>
  `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified></cp:coreProperties>`;

const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function documentRels(relationships: Relationship[], parts: Array<{ id: string; type: string; target: string }>): string {
  const fixed = parts.map((part) => `<Relationship Id="${part.id}" Type="${REL_TYPE}/${part.type}" Target="${part.target}"/>`).join('');
  const links = relationships.map((relationship) =>
    `<Relationship Id="${relationship.id}" Type="${REL_TYPE}/hyperlink" Target="${escapeXml(relationship.target)}" TargetMode="External"/>`).join('');
  return `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fixed}${links}</Relationships>`;
}

export type ExportOptions = {
  title?: string; language?: string; pageSize?: PageSize; margins?: PageMargins | null; modified?: Date;
  orientation?: Orientation; columns?: number; header?: RunningText | null; footer?: RunningText | null;
};

export type DocumentXmlOptions = { orientation?: Orientation; columns?: number; header?: RunningText | null; footer?: RunningText | null };

// The body XML plus what it references; exported separately so tests can read it directly.
export function documentXml(value: unknown, size: PageSize, margins?: PageMargins | null, options: DocumentXmlOptions = {}):
  { xml: string; relationships: Relationship[]; numbering: string; footnotes: string[] } {
  const document: EditorDocument = EditorDocumentSchema.parse(value);
  const orientation = asOrientation(options.orientation);
  const writer: Writer = {
    relationships: [], lists: [], size, margins: margins ?? pageGeometry(size, orientation).margin,
    orientation, columns: asColumns(options.columns), footnotes: [], bookmarks: 0,
  };
  const body = document.content.map((node) => blocks(node, writer)).join('') || '<w:p/>';
  const refs = { header: options.header ? 'rId3' : undefined, footer: options.footer ? 'rId4' : undefined };
  return {
    xml: `${XML_DECLARATION}<w:document ${W} ${R}><w:body>${body}${sectionProperties(writer, refs)}</w:body></w:document>`,
    relationships: writer.relationships, numbering: numberingXml(writer.lists), footnotes: writer.footnotes,
  };
}

export async function editorDocumentToDocx(value: unknown, options: ExportOptions = {}): Promise<Uint8Array> {
  const size = options.pageSize ?? defaultPageSize(options.language ?? 'id');
  const orientation = asOrientation(options.orientation);
  const columns = asColumns(options.columns);
  const margins = options.margins ?? pageGeometry(size, orientation).margin;
  const header = options.header ?? null;
  const footer = options.footer ?? null;
  const { xml, relationships, numbering, footnotes } = documentXml(value, size, margins, { orientation, columns, header, footer });
  const encoder = new TextEncoder();
  const modified = (options.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parts: Array<{ id: string; type: string; target: string }> = [
    { id: 'rId1', type: 'styles', target: 'styles.xml' },
    { id: 'rId2', type: 'numbering', target: 'numbering.xml' },
  ];
  if (header) parts.push({ id: 'rId3', type: 'header', target: 'header1.xml' });
  if (footer) parts.push({ id: 'rId4', type: 'footer', target: 'footer1.xml' });
  if (footnotes.length) parts.push({ id: 'rId5', type: 'footnotes', target: 'footnotes.xml' });

  const entries: ZipEntry[] = [
    { name: '_rels/.rels', data: encoder.encode(PACKAGE_RELS) },
    { name: 'docProps/core.xml', data: encoder.encode(coreXml(options.title ?? 'Document', modified)) },
    { name: 'word/document.xml', data: encoder.encode(xml) },
    { name: 'word/styles.xml', data: encoder.encode(stylesXml(columnWidth(size, margins, orientation, columns))) },
    { name: 'word/numbering.xml', data: encoder.encode(numbering) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(documentRels(relationships, parts)) },
  ];
  if (header) entries.push({ name: 'word/header1.xml', data: encoder.encode(runningXml('hdr', header)) });
  if (footer) entries.push({ name: 'word/footer1.xml', data: encoder.encode(runningXml('ftr', footer)) });
  if (footnotes.length) entries.push({ name: 'word/footnotes.xml', data: encoder.encode(footnotesXml(footnotes)) });
  entries.unshift({ name: '[Content_Types].xml', data: encoder.encode(contentTypes(entries.map((entry) => entry.name))) });
  return zip(entries);
}

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// A filename Word, macOS and Linux all accept; the fallback keeps an all-punctuation title from producing an empty name.
export const docxFilename = (title: string) => `${(title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document')}.docx`;
