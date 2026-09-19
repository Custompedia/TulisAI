import type { EditorNode } from '../editor/document';
import { BORDER_SIDES, borderAttr, borderFromOoxml, cssBorder, DEFAULT_BORDER, type BorderLine } from './borders';
import { twipsToPx } from './office-defaults';
import { applyParagraph, applyRun, styleChain, type ParaProps, type RunProps, type Styles } from './styles';
import { attr, childrenNamed, firstNamed, isOn, type XmlNode } from './xml';

// Formatting a cell inherits before its paragraphs apply their own styles: table style, then conditional parts.
export type CellBase = { run: RunProps; para: ParaProps; header: boolean };
export type CellBlocks = (cell: XmlNode, base: CellBase) => EditorNode[];

const hexFill = (node: XmlNode | undefined) => { const fill = attr(node && firstNamed(node, 'w:shd'), 'w:fill'); return fill && /^[\da-f]{6}$/iu.test(fill) ? fill.toUpperCase() : undefined; };

// Rows and cells can be wrapped in content controls, custom XML or tracked insertions.
function unwrap(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) => {
    if (child.name === name) return [child];
    if (child.name === 'w:sdt') { const content = firstNamed(child, 'w:sdtContent'); return content ? unwrap(content, name) : []; }
    if (child.name === 'w:customXml' || child.name === 'w:ins' || child.name === 'w:moveTo') return unwrap(child, name);
    return [];
  });
}

type Look = { firstRow: boolean; lastRow: boolean; firstColumn: boolean; lastColumn: boolean; noHBand: boolean; noVBand: boolean };
function lookOf(tblPr: XmlNode | undefined): Look {
  const look = tblPr && firstNamed(tblPr, 'w:tblLook');
  const bits = parseInt(attr(look, 'w:val') ?? '0', 16) || 0;
  const flag = (name: string, bit: number) => { const value = attr(look, `w:${name}`); return value !== undefined ? value === '1' || value === 'true' : (bits & bit) !== 0; };
  return { firstRow: flag('firstRow', 0x20), lastRow: flag('lastRow', 0x40), firstColumn: flag('firstColumn', 0x80), lastColumn: flag('lastColumn', 0x100), noHBand: flag('noHBand', 0x200), noVBand: flag('noVBand', 0x400) };
}

// The six sides OOXML names on a table: the four edges plus the two inner grid lines.
type BorderSet = Partial<Record<'top' | 'right' | 'bottom' | 'left' | 'insideH' | 'insideV', BorderLine | null>>;
const BORDER_NAMES = ['top', 'right', 'bottom', 'left', 'insideH', 'insideV'] as const;

function bordersOf(node: XmlNode | undefined, name: 'w:tblBorders' | 'w:tcBorders'): BorderSet {
  const container = node && firstNamed(node, name);
  if (!container) return {};
  const set: BorderSet = {};
  for (const side of BORDER_NAMES) {
    // OOXML spells the horizontal edges "top"/"bottom" and the vertical ones "start"/"left" depending on the writer.
    const element = firstNamed(container, `w:${side}`) ?? (side === 'left' ? firstNamed(container, 'w:start') : side === 'right' ? firstNamed(container, 'w:end') : undefined);
    const line = borderFromOoxml(attr(element, 'w:val'), attr(element, 'w:sz'), attr(element, 'w:color'));
    if (line !== undefined) set[side] = line;
  }
  return set;
}

const sameBorder = (line: BorderLine | null) =>
  line !== null && Math.abs(line.width - DEFAULT_BORDER.width) < 0.01 && line.style === DEFAULT_BORDER.style && line.color === DEFAULT_BORDER.color;

type Part = { pPr?: XmlNode; rPr?: XmlNode; tcPr?: XmlNode; tblPr?: XmlNode };
function tableStyleParts(styles: Styles, id: string | undefined) {
  const whole: Part[] = []; const conditional = new Map<string, Part[]>();
  for (const style of styleChain(styles, id)) {
    whole.push({ pPr: style.pPr, rPr: style.rPr, tcPr: firstNamed(style.node, 'w:tcPr'), tblPr: firstNamed(style.node, 'w:tblPr') });
    for (const part of childrenNamed(style.node, 'w:tblStylePr')) {
      const type = attr(part, 'w:type');
      if (type) conditional.set(type, [...(conditional.get(type) ?? []), { pPr: firstNamed(part, 'w:pPr'), rPr: firstNamed(part, 'w:rPr'), tcPr: firstNamed(part, 'w:tcPr'), tblPr: firstNamed(part, 'w:tblPr') }]);
    }
  }
  return { whole, conditional };
}

type Slot = { node: XmlNode; column: number; span: number; merge: 'restart' | 'continue' | null };

export function tableFrom(table: XmlNode, styles: Styles, base: { run: RunProps; para: ParaProps }, cellBlocks: CellBlocks, contentWidth = 0): EditorNode | null {
  const tblPr = firstNamed(table, 'w:tblPr');
  const look = lookOf(tblPr);
  const { whole, conditional } = tableStyleParts(styles, attr(tblPr && firstNamed(tblPr, 'w:tblStyle'), 'w:val'));
  const grid = childrenNamed(firstNamed(table, 'w:tblGrid') ?? table, 'w:gridCol').map((column) => Number(attr(column, 'w:w') ?? '0') || 0);
  const rows = unwrap(table, 'w:tr');
  if (!rows.length) return null;
  // The table's own lines, which every cell falls back to for the sides it does not state itself.
  let tableBorders: BorderSet = {};
  for (const layer of whole) tableBorders = { ...tableBorders, ...bordersOf(layer.tblPr, 'w:tblBorders') };
  tableBorders = { ...tableBorders, ...bordersOf(tblPr, 'w:tblBorders') };

  const slots: Slot[][] = rows.map((row) => {
    let column = Number(attr(firstNamed(firstNamed(row, 'w:trPr') ?? row, 'w:gridBefore'), 'w:val') ?? '0') || 0;
    return unwrap(row, 'w:tc').map((cell) => {
      const tcPr = firstNamed(cell, 'w:tcPr');
      const span = Math.max(1, Math.min(100, Number(attr(tcPr && firstNamed(tcPr, 'w:gridSpan'), 'w:val') ?? '1') || 1));
      const vMerge = tcPr && firstNamed(tcPr, 'w:vMerge');
      const slot: Slot = { node: cell, column, span, merge: vMerge ? (attr(vMerge, 'w:val') === 'restart' ? 'restart' : 'continue') : null };
      column += span;
      return slot;
    });
  });
  const headerRows = rows.findIndex((row) => { const trPr = firstNamed(row, 'w:trPr'); return !isOn(trPr && firstNamed(trPr, 'w:tblHeader')); });
  const headerCount = headerRows < 0 ? rows.length : headerRows;
  const lastColumn = Math.max(0, ...slots.map((row) => row.reduce((end, slot) => Math.max(end, slot.column + slot.span), 0))) - 1;
  const bodyStart = look.firstRow ? 1 : 0;
  // First row holding a merged cell per grid column, so a continuation check is O(1) instead of a scan of every row above.
  const firstMerge = new Map<number, number>();
  slots.forEach((row, rowIndex) => { for (const cell of row) if (cell.merge && !firstMerge.has(cell.column)) firstMerge.set(cell.column, rowIndex); });

  const output = slots.map((row, rowIndex) => {
    const cells = row.flatMap((slot): EditorNode[] => {
      // A continuation cell exists only to be covered by the restart cell above it.
      if (slot.merge === 'continue' && (firstMerge.get(slot.column) ?? rowIndex) < rowIndex) return [];
      let rowspan = 1;
      if (slot.merge === 'restart') while (slots[rowIndex + rowspan]?.some((cell) => cell.column === slot.column && cell.merge === 'continue')) rowspan++;

      const parts: string[] = [];
      if (!look.noVBand) parts.push((slot.column - (look.firstColumn ? 1 : 0)) % 2 === 0 ? 'band1Vert' : 'band2Vert');
      if (!look.noHBand && rowIndex >= bodyStart && !(look.lastRow && rowIndex === rows.length - 1)) parts.push((rowIndex - bodyStart) % 2 === 0 ? 'band1Horz' : 'band2Horz');
      if (look.firstColumn && slot.column === 0) parts.push('firstCol');
      if (look.lastColumn && slot.column + slot.span - 1 === lastColumn) parts.push('lastCol');
      if (look.firstRow && rowIndex === 0) parts.push('firstRow');
      if (look.lastRow && rowIndex === rows.length - 1) parts.push('lastRow');
      const layers = [...whole, ...parts.flatMap((part) => conditional.get(part) ?? [])];
      let run = base.run; let para = base.para; let background: string | undefined; let inherited: BorderSet = {};
      for (const layer of layers) {
        run = applyRun(run, layer.rPr, styles.theme); para = applyParagraph(para, layer.pPr); background = hexFill(layer.tcPr) ?? background;
        inherited = { ...inherited, ...bordersOf(layer.tcPr, 'w:tcBorders') };
      }

      const tcPr = firstNamed(slot.node, 'w:tcPr');
      background = hexFill(tcPr) ?? background;
      const vAlign = attr(tcPr && firstNamed(tcPr, 'w:vAlign'), 'w:val');
      const widths = grid.slice(slot.column, slot.column + slot.span);
      const cellWidth = Number(attr(tcPr && firstNamed(tcPr, 'w:tcW'), 'w:w') ?? '0');
      const colwidth = widths.length === slot.span && widths.every((width) => width > 0) ? widths.map((width) => Math.round(twipsToPx(width)))
        : cellWidth > 0 && attr(tcPr && firstNamed(tcPr, 'w:tcW'), 'w:type') === 'dxa' ? Array<number>(slot.span).fill(Math.round(twipsToPx(cellWidth / slot.span))) : null;
      const header = rowIndex < headerCount;
      const attrs: Record<string, unknown> = {};
      if (slot.span > 1) attrs.colspan = slot.span;
      if (rowspan > 1) attrs.rowspan = rowspan;
      if (colwidth) attrs.colwidth = colwidth;
      if (background && background !== 'FFFFFF') attrs.background = `#${background}`;
      // Only a side that differs from the 0.5 pt grid the canvas already draws needs to be stored.
      const own = bordersOf(tcPr, 'w:tcBorders');
      const edge = { top: rowIndex === 0, bottom: rowIndex === rows.length - 1, left: slot.column === 0, right: slot.column + slot.span - 1 === lastColumn };
      for (const side of BORDER_SIDES) {
        const inner: keyof BorderSet = side === 'top' || side === 'bottom' ? 'insideH' : 'insideV';
        // "No line" is a stated value, so presence decides which layer wins rather than nullishness.
        const layers: BorderSet[] = [own, inherited, edge[side] ? { [side]: tableBorders[side] } : { [side]: tableBorders[inner] }];
        const layer = layers.find((set) => side in set && set[side] !== undefined);
        const line = layer?.[side];
        if (line === undefined || sameBorder(line)) continue;
        attrs[borderAttr(side)] = cssBorder(line);
      }
      if (vAlign === 'center' || vAlign === 'bottom') attrs.verticalAlign = vAlign === 'center' ? 'middle' : 'bottom';
      const content = cellBlocks(slot.node, { run, para, header });
      return [{ type: header ? 'tableHeader' : 'tableCell', ...(Object.keys(attrs).length ? { attrs } : {}), content: content.length ? content : [{ type: 'paragraph' }] }];
    });
    return { type: 'tableRow', content: cells } as EditorNode;
  });
  if (!output.some((row) => row.content?.length)) return null;
  const tableAttrs: Record<string, unknown> = {};
  const jc = attr(tblPr && firstNamed(tblPr, 'w:jc'), 'w:val') ?? attr(whole.map((layer) => layer.tblPr && firstNamed(layer.tblPr, 'w:jc')).filter(Boolean).pop(), 'w:val');
  if (jc === 'center' || jc === 'right' || jc === 'end') tableAttrs.align = jc === 'end' ? 'right' : jc;
  // Word's "autofit to contents" only shrinks the table when its grid really is narrower than the text column.
  const tblW = tblPr && firstNamed(tblPr, 'w:tblW');
  const gridTotal = grid.reduce((sum, width) => sum + width, 0);
  if (attr(tblW, 'w:type') === 'auto' && contentWidth > 0 && gridTotal > 0 && gridTotal < contentWidth * 0.9) tableAttrs.width = 'auto';
  return { type: 'table', ...(Object.keys(tableAttrs).length ? { attrs: tableAttrs } : {}), content: output };
}
