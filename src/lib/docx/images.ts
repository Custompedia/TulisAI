import type { EditorNode } from '../editor/document';
import { imagePoints, type ImageWrap } from '../editor/extensions/image-space';
import { attr, firstNamed, type XmlNode } from './xml';

// Word pictures become empty spaces of the same size (see extensions/image-space.ts). The picture is never read: only
// its frame, which says how big it is and how the text flows around it.
//
//   wp:inline                       an inline box on the text line (the common "In line with text").
//   wp:anchor + wrapTopAndBottom    a full-width block at the top of its paragraph; the text continues under it.
//   wp:anchor + wrapSquare/Tight/Through   a floated box on the picture's side; the text flows beside it.
//   wp:anchor + wrapNone (behind or in front of text)   nothing: the text never moved for it in Word.
// The same rules read the older VML frames (w:pict, w:object) that Word 2003 files and embedded objects still use.

export const EMU_PER_POINT = 12700;
const points = (emu: string | undefined) => { const value = Number(emu); return Number.isFinite(value) && value > 0 ? value / EMU_PER_POINT : 0; };
const gap = (value: number) => (value > 0 ? Math.round(value * 100) / 100 : undefined);

export type SpaceResult = { node: EditorNode; anchored: boolean };
export type SpaceWarning = 'imageWrap';

function space(width: number, height: number, wrap: ImageWrap, margins: { top?: number; right?: number; bottom?: number; left?: number } = {}): EditorNode | null {
  const w = imagePoints(width); const h = imagePoints(height);
  if (!w || !h) return null;
  const attrs: Record<string, unknown> = { width: w, height: h, ...(wrap === 'inline' ? {} : { wrap }) };
  const top = gap(margins.top ?? 0); const right = gap(margins.right ?? 0); const bottom = gap(margins.bottom ?? 0); const left = gap(margins.left ?? 0);
  if (top) attrs.marginTop = top; if (right) attrs.marginRight = right; if (bottom) attrs.marginBottom = bottom; if (left) attrs.marginLeft = left;
  return { type: 'imageSpace', attrs };
}

// Which side a wrapped picture sits on: its stated alignment, else whether its centre is right of the column's.
function side(align: string | undefined, offset: number, width: number, column: number): ImageWrap | null {
  const value = (align ?? '').trim();
  if (value === 'right' || value === 'outside') return 'right';
  if (value === 'left' || value === 'inside') return 'left';
  if (value === 'center') return null;
  return offset + width / 2 > column / 2 ? 'right' : 'left';
}

function drawingSpaces(drawing: XmlNode, column: number, warn: (warning: SpaceWarning) => void): SpaceResult[] {
  const out: SpaceResult[] = [];
  for (const frame of drawing.children) {
    if (frame.name !== 'wp:inline' && frame.name !== 'wp:anchor') continue;
    const extent = firstNamed(frame, 'wp:extent');
    const width = points(attr(extent, 'cx')); const height = points(attr(extent, 'cy'));
    if (frame.name === 'wp:inline') { const node = space(width, height, 'inline'); if (node) out.push({ node, anchored: false }); continue; }
    const wrap = frame.children.find((child) => /^wp:wrap(?:None|Square|Tight|Through|TopAndBottom)$/u.test(child.name));
    if (!wrap || wrap.name === 'wp:wrapNone') continue;
    const dist = (name: string) => points(attr(frame, name));
    if (wrap.name === 'wp:wrapTopAndBottom') {
      const node = space(width, height, 'block', { top: dist('distT'), bottom: dist('distB') });
      if (node) out.push({ node, anchored: true });
      continue;
    }
    const position = firstNamed(frame, 'wp:positionH');
    const placed = side(firstNamed(position ?? frame, 'wp:align')?.text, points(firstNamed(position ?? frame, 'wp:posOffset')?.text), width, column);
    if (!placed) warn('imageWrap');
    const node = space(width, height, placed ?? 'block', placed ? { top: dist('distT'), right: dist('distR'), bottom: dist('distB'), left: dist('distL') } : { top: dist('distT'), bottom: dist('distB') });
    if (node) out.push({ node, anchored: true });
  }
  return out;
}

// VML lengths: pt, in, cm, mm, pc and px (a bare number is px).
const VML_UNITS: Record<string, number> = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12, px: 0.75, '': 0.75 };
function vmlLength(value: string | undefined): number {
  const match = /^\s*(-?[\d.]+)\s*(pt|in|cm|mm|pc|px)?\s*$/iu.exec(value ?? '');
  if (!match) return 0;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount * VML_UNITS[(match[2] ?? '').toLowerCase()]! : 0;
}
const VML_SHAPES = new Set(['v:shape', 'v:rect', 'v:roundrect', 'v:oval', 'v:image', 'v:group', 'v:line', 'v:polyline', 'v:arc', 'v:curve']);

function vmlSpaces(pict: XmlNode, column: number, warn: (warning: SpaceWarning) => void): SpaceResult[] {
  const out: SpaceResult[] = [];
  for (const shape of pict.children) {
    if (!VML_SHAPES.has(shape.name)) continue;
    const style = new Map((attr(shape, 'style') ?? '').split(';').map((part) => { const at = part.indexOf(':'); return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()] as const; }).filter(([key]) => key));
    const width = vmlLength(style.get('width')); const height = vmlLength(style.get('height'));
    const absolute = style.get('position') === 'absolute';
    if (!absolute) { const node = space(width, height, 'inline'); if (node) out.push({ node, anchored: false }); continue; }
    const wrap = attr(firstNamed(shape, 'w10:wrap'), 'type');
    if (wrap === 'topAndBottom') { const node = space(width, height, 'block'); if (node) out.push({ node, anchored: true }); continue; }
    if (wrap !== 'square' && wrap !== 'tight' && wrap !== 'through') continue;
    const placed = side(style.get('mso-position-horizontal'), vmlLength(style.get('margin-left')), width, column);
    if (!placed) warn('imageWrap');
    const node = space(width, height, placed ?? 'block', placed === 'left' ? { right: 9 } : placed === 'right' ? { left: 9 } : {});
    if (node) out.push({ node, anchored: true });
  }
  return out;
}

// The spaces a run object leaves, whatever form it takes. `column` is the text column width in points, which decides
// the side of a picture positioned by offset.
export function objectSpaces(node: XmlNode, column: number, warn: (warning: SpaceWarning) => void): SpaceResult[] {
  switch (node.name) {
    case 'w:drawing': return drawingSpaces(node, column, warn);
    case 'w:pict': case 'w:object': return vmlSpaces(node, column, warn);
    case 'mc:AlternateContent': {
      const branch = firstNamed(node, 'mc:Choice') ?? firstNamed(node, 'mc:Fallback');
      return branch ? branch.children.flatMap((child) => objectSpaces(child, column, warn)) : [];
    }
    default: return [];
  }
}
