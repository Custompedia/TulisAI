import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

// The paged canvas splits one long editor into Word-sized sheets with widget spacers only; the document and its
// offsets never change. It paginates the way Word does by default:
//   - a block that does not fit moves to the next sheet, and a paragraph is split between two sheets at a line
//     boundary instead, keeping at least two lines on each side (Word's widow and orphan control);
//   - a heading is kept with the block after it (Word's built-in headings are "keep with next");
//   - hard page breaks always start a new sheet.
// Measuring is incremental: a block's margins and line grid are cached on its ProseMirror node, which ProseMirror
// shares between versions of the document, so after a keystroke only the edited block is measured again.

// Line grid of a paragraph whose lines are all the same height: `offset` is where the first line starts below the
// block's border edge, all in unzoomed CSS px. A getter is evaluated only when the paragraph has to be split.
export type LineGrid = { count: number; pitch: number; offset: number };
// Measured block, in unzoomed CSS px. `gap` is the natural space above it (for the first block: its offset).
export type PageBlock = {
  height: number; gap: number; marginTop: number; marginBottom: number; breakBefore: boolean; pageBreak: boolean;
  lines?: LineGrid | (() => LineGrid | undefined); keepNext?: boolean;
};
export type SheetGeometry = { height: number; top: number; bottom: number; gutter: number };
// A spacer before block `index`: `height` px tall, with the grey gutter band starting `band` px from its top.
export type PageGap = { index: number; height: number; band: number };
// A spacer inside block `index`, before its line `line`, which then starts the next sheet.
export type PageSplit = { index: number; line: number; height: number; band: number };
export type PagePlan = { gaps: PageGap[]; splits: PageSplit[]; filler: number; pages: number };

const EPSILON = 0.5;
// Spacers applied per slice on a long notebook (see apply in paginationExtension).
const SLICE = 150;
// Word's widow and orphan control: never a single line alone at the foot or the head of a page.
const MIN_LINES = 2;

// Pure layout: where each sheet starts, so a block (or a paragraph's next line) lands on the next page's top margin.
export function planPages(blocks: PageBlock[], sheet: SheetGeometry): PagePlan {
  const body = sheet.height - sheet.top - sheet.bottom;
  const stride = sheet.height + sheet.gutter;
  const gaps: PageGap[] = []; const splits: PageSplit[] = [];
  let page = 0; let pageStart = 0; let bottom = 0; let marginBottom = 0; let placed = false;
  type Snapshot = { page: number; pageStart: number; bottom: number; marginBottom: number; placed: boolean; gaps: number; splits: number };
  const snapshots: Snapshot[] = []; const startsPage: boolean[] = []; const forced = new Set<number>();
  // A block taller than a page runs on over the next sheets; layout resumes on the sheet where it ends.
  const settle = () => { while (pageStart + body < bottom - EPSILON) { page++; pageStart += stride; } };
  const restore = (at: number) => {
    const state = snapshots[at]!;
    ({ page, pageStart, bottom, marginBottom, placed } = state);
    gaps.length = state.gaps; splits.length = state.splits;
  };
  // Keep with next: the heading before a block that starts a new sheet goes with it, unless it already heads a sheet.
  const keepWith = (index: number): boolean => {
    const previous = index - 1;
    if (previous < 0 || !blocks[previous]!.keepNext || startsPage[previous] || forced.has(previous)) return false;
    restore(previous); forced.add(previous);
    return true;
  };
  const gridOf = (block: PageBlock) => (typeof block.lines === 'function' ? block.lines() : block.lines);

  // Splits a paragraph at line boundaries; false when it cannot be split here (too few lines on either side).
  const split = (index: number, block: PageBlock, top: number): boolean => {
    const grid = gridOf(block);
    if (!grid || grid.count < MIN_LINES * 2 || grid.pitch <= 0) return false;
    let first = 0; let blockTop = top; let current = page; let currentStart = pageStart;
    const made: PageSplit[] = [];
    for (;;) {
      const fit = Math.floor((currentStart + body - (blockTop + grid.offset) + EPSILON) / grid.pitch);
      if (fit >= grid.count) break;
      let line = fit;
      if (grid.count - line < MIN_LINES) line = grid.count - MIN_LINES;
      if (line - first < MIN_LINES) { if (first === 0) return false; break; }
      const next = current + 1; const target = next * stride; const lineTop = blockTop + grid.offset + line * grid.pitch;
      made.push({ index, line, height: target - lineTop, band: target - sheet.top - sheet.gutter - lineTop });
      blockTop = target - grid.offset - line * grid.pitch; current = next; currentStart = target; first = line;
    }
    if (!made.length) return false;
    splits.push(...made);
    page = current; pageStart = currentStart; bottom = blockTop + block.height; marginBottom = block.marginBottom; startsPage[index] = false;
    settle();
    return true;
  };

  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index]!;
    snapshots[index] = { page, pageStart, bottom, marginBottom, placed, gaps: gaps.length, splits: splits.length };
    if (!placed) {
      placed = true; startsPage[index] = true;
      if (block.gap + block.height > body + EPSILON && block.lines && split(index, block, block.gap)) { startsPage[index] = true; index++; continue; }
      bottom = block.gap + block.height; marginBottom = block.marginBottom;
      settle(); index++; continue;
    }
    const top = bottom + block.gap;
    const hardBreak = block.breakBefore;
    const overflows = !block.pageBreak && top + block.height - pageStart > body + EPSILON;
    if (!hardBreak && !forced.has(index) && overflows && block.lines && split(index, block, top)) { index++; continue; }
    if (!hardBreak && (overflows || forced.has(index)) && keepWith(index)) { index--; continue; }
    if (hardBreak || overflows || forced.has(index)) {
      const spacerTop = bottom + marginBottom;
      let next = page + 1;
      while (next * stride - sheet.top - sheet.gutter < spacerTop - EPSILON) next++;
      const target = next * stride;
      gaps.push({ index, height: Math.max(0, target - block.marginTop - spacerTop), band: target - sheet.top - sheet.gutter - spacerTop });
      page = next; pageStart = target; bottom = target + block.height; startsPage[index] = true;
    } else { bottom = top + block.height; startsPage[index] = false; }
    marginBottom = block.marginBottom;
    settle();
    index++;
  }
  return { gaps, splits, filler: Math.max(0, pageStart + body - (bottom + (placed ? marginBottom : 0))), pages: page + 1 };
}

export const paginationKey = new PluginKey<DecorationSet>('pagination');
const NARROW = '(max-width: 860px)';
// The grey band drawn between two sheets, in CSS px; the running header and footer step by this too.
export const PAGE_GUTTER = 16;
const GUTTER = PAGE_GUTTER;

const px = (value: string) => { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : 0; };
// Two adjacent vertical margins collapse into one, per CSS 2.1 §8.3.1.
const collapse = (a: number, b: number) => (a >= 0 && b >= 0 ? Math.max(a, b) : a < 0 && b < 0 ? Math.min(a, b) : a + b);

// What gets its own place on a sheet: top-level blocks, and the items of a list, a quote or a table of contents, so a
// long reference list or contents page breaks between entries like it does in Word. Tables stay whole.
const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'tableOfContents', 'blockquote']);
// ProseMirror's view descriptions (internal, but stable): each holds a node and its DOM. Walking them in step with
// the document gives every block's DOM in one pass; view.nodeDOM() searches from the start of the document on every
// call, which for 12,000 blocks made one measurement quadratic.
type Desc = { node?: PMNode | null; dom: Node; children?: Desc[]; widget?: unknown; domFromPos?: (pos: number, side: number) => { node: Node; offset: number } };
const nodeDescs = (desc: Desc | undefined) => (desc?.children ?? []).filter((child) => child.node && !child.widget);
type Unit = { pos: number; node: PMNode; text: boolean; keepNext: boolean; desc?: Desc };
function unitsOf(doc: PMNode, root?: Desc): Unit[] {
  const units: Unit[] = [];
  const top = nodeDescs(root);
  const aligned = top.length === doc.childCount;
  doc.forEach((node, offset, index) => {
    const desc = aligned && top[index]!.node === node ? top[index] : undefined;
    if (CONTAINERS.has(node.type.name) && node.childCount) {
      const inner = nodeDescs(desc);
      node.forEach((child, childOffset, childIndex) => units.push({ pos: offset + 1 + childOffset, node: child, text: false, keepNext: false, desc: inner[childIndex]?.node === child ? inner[childIndex] : undefined }));
    } else units.push({ pos: offset, node, text: node.type.name === 'paragraph', keepNext: node.type.name === 'heading', desc });
  });
  return units;
}

// The top of the character at a position inside a block, found through the block's own description, so it costs the
// block's length rather than the document's. Null when the description cannot answer.
function topIn(unit: Unit, position: number, side: number): number | null {
  const desc = unit.desc;
  if (!desc?.domFromPos) return null;
  const { node, offset } = desc.domFromPos(position - unit.pos - 1, side);
  const range = document.createRange();
  if (node.nodeType === 3) {
    const length = node.nodeValue?.length ?? 0;
    if (side > 0 && offset < length) { range.setStart(node, offset); range.setEnd(node, offset + 1); }
    else if (offset > 0) { range.setStart(node, offset - 1); range.setEnd(node, offset); }
    else return null;
    const rects = range.getClientRects();
    return rects.length ? rects[side > 0 ? 0 : rects.length - 1]!.top : null;
  }
  const child = node.childNodes[side > 0 ? offset : offset - 1];
  if (child instanceof HTMLElement) return child.getBoundingClientRect().top;
  if (child && child.nodeType === 3) { range.selectNodeContents(child); const rects = range.getClientRects(); return rects.length ? rects[side > 0 ? 0 : rects.length - 1]!.top : null; }
  return null;
}
const topAt = (view: EditorView, unit: Unit, position: number, side: number) => topIn(unit, position, side) ?? view.coordsAtPos(position, side).top;

type Styled = { generation: number; marginTop: number; marginBottom: number; padTop: number; padBottom: number; padLeft: number; padRight: number };
type Grid = { generation: number; grid: LineGrid | null };
const styled = new WeakMap<PMNode, Styled>();
const grids = new WeakMap<PMNode, Grid>();
const lineStarts = new WeakMap<PMNode, { generation: number; starts: Map<number, number> }>();

type Spacer = { pos: number; height: number };
type Measured = {
  blocks: PageBlock[]; units: Unit[]; doms: HTMLElement[]; spacers: Spacer[][]; sheet: SheetGeometry; scale: number; rootLeft: number;
  pageWidth: number; marginLeft: number;
};

// Split spacers drawn by the last plan, by unit index, so a block is measured as if they were not there.
function innerSpacers(view: EditorView, units: Unit[]): Map<number, Array<{ pos: number; height: number }>> {
  const set = paginationKey.getState(view.state); const byUnit = new Map<number, Array<{ pos: number; height: number }>>();
  if (!set) return byUnit;
  const found = set.find(undefined, undefined, (spec) => (spec as { split?: boolean }).split === true);
  for (const decoration of found) {
    const at = decoration.from; let low = 0; let high = units.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (units[middle]!.pos <= at) low = middle; else high = middle - 1; }
    const list = byUnit.get(low) ?? []; list.push({ pos: at, height: (decoration.spec as { height: number }).height }); byUnit.set(low, list);
  }
  return byUnit;
}

function measure(view: EditorView, generation: number): Measured | null {
  const root = view.dom;
  const style = getComputedStyle(root);
  const contentWidth = px(style.getPropertyValue('--page-content-width'));
  const sheet = { height: px(style.getPropertyValue('--page-height')), top: px(style.getPropertyValue('--page-margin-top')), bottom: px(style.getPropertyValue('--page-margin-bottom')), gutter: GUTTER };
  const rootBox = root.getBoundingClientRect();
  if (!contentWidth || !sheet.height || rootBox.width === 0) return null;
  // Zoom scales every rect equally; dividing by it measures in the page's own CSS px.
  const scale = rootBox.width / contentWidth;
  const all = unitsOf(view.state.doc, (view as unknown as { docView?: Desc }).docView); const spacers = innerSpacers(view, all);
  const blocks: PageBlock[] = []; const units: Unit[] = []; const doms: HTMLElement[] = []; const ownSpacers: Spacer[][] = [];
  let previous: { box: DOMRect; marginBottom: number } | null = null; let afterBreak = false;
  all.forEach((unit, unitIndex) => {
    const dom = unit.desc?.dom ?? view.nodeDOM(unit.pos);
    if (!(dom instanceof HTMLElement)) return;
    const box = dom.getBoundingClientRect();
    let css = styled.get(unit.node);
    if (!css || css.generation !== generation) {
      const computed = getComputedStyle(dom);
      css = { generation, marginTop: px(computed.marginTop), marginBottom: px(computed.marginBottom), padTop: px(computed.paddingTop) + px(computed.borderTopWidth), padBottom: px(computed.paddingBottom) + px(computed.borderBottomWidth), padLeft: px(computed.paddingLeft) + px(computed.borderLeftWidth), padRight: px(computed.paddingRight) + px(computed.borderRightWidth) };
      styled.set(unit.node, css);
    }
    const own = spacers.get(unitIndex) ?? [];
    const spaced = dom.previousElementSibling?.classList.contains('ww-page-gap');
    const gap = !previous ? (box.top - rootBox.top) / scale : spaced ? collapse(previous.marginBottom, css.marginTop) : (box.top - previous.box.bottom) / scale;
    const pageBreak = unit.node.type.name === 'pageBreak';
    const height = box.height / scale - own.reduce((sum, item) => sum + item.height, 0);
    const block: PageBlock = { height, gap, marginTop: css.marginTop, marginBottom: css.marginBottom, breakBefore: afterBreak, pageBreak, keepNext: unit.keepNext };
    if (unit.text) block.lines = () => gridFor(view, unit, dom, height, css!, scale, own, generation);
    blocks.push(block); units.push(unit); doms.push(dom); ownSpacers.push(own);
    previous = { box, marginBottom: css.marginBottom }; afterBreak = pageBreak;
  });
  return { blocks, units, doms, spacers: ownSpacers, sheet, scale, rootLeft: rootBox.left, pageWidth: px(style.getPropertyValue('--page-width')), marginLeft: px(style.getPropertyValue('--page-margin-left')) };
}

// A paragraph's lines, when they are all one height: from the first and last line's tops and the content height,
// count = H / (H - (last - first)). Mixed sizes, pictures and floats give a fraction, and the paragraph then moves
// whole, as before. Split spacers already inside the paragraph are taken out of both numbers.
function gridFor(view: EditorView, unit: Unit, dom: HTMLElement, height: number, css: Styled, scale: number, own: Array<{ height: number }>, generation: number): LineGrid | undefined {
  const cached = grids.get(unit.node);
  if (cached && cached.generation === generation) return cached.grid ?? undefined;
  let grid: LineGrid | null = null;
  try {
    const from = unit.pos + 1; const to = unit.pos + unit.node.nodeSize - 1;
    if (to - from >= 2) {
      const first = topAt(view, unit, from, 1); const last = topAt(view, unit, to, -1);
      const content = height - css.padTop - css.padBottom;
      const spread = (last - first) / scale - own.reduce((sum, item) => sum + item.height, 0);
      if (content > 0 && spread > 0.5 && content - spread > 0.5) {
        const count = content / (content - spread);
        const rounded = Math.round(count);
        if (rounded >= MIN_LINES * 2 && Math.abs(count - rounded) < 0.12) grid = { count: rounded, pitch: content / rounded, offset: css.padTop };
      }
    }
  } catch { grid = null; }
  grids.set(unit.node, { generation, grid });
  void dom;
  return grid ?? undefined;
}

// Where line `line` of a paragraph starts, by binary search on the text positions' line tops (with any split spacer
// already in the paragraph taken out), moved back to the start of its word.
function lineStart(view: EditorView, unit: Unit, dom: HTMLElement, grid: LineGrid, line: number, scale: number, own: Array<{ pos: number; height: number }>, generation: number): number | null {
  let cache = lineStarts.get(unit.node);
  if (!cache || cache.generation !== generation) { cache = { generation, starts: new Map() }; lineStarts.set(unit.node, cache); }
  const known = cache.starts.get(line);
  if (known !== undefined) return unit.pos + known;
  const top = dom.getBoundingClientRect().top;
  const from = unit.pos + 1; const to = unit.pos + unit.node.nodeSize - 1;
  const lineOf = (position: number) => {
    const shift = own.reduce((sum, item) => sum + (item.pos <= position ? item.height : 0), 0);
    return Math.floor(((topAt(view, unit, position, 1) - top) / scale - shift - grid.offset) / grid.pitch + 0.25);
  };
  let low = from; let high = to;
  try {
    while (low < high) { const middle = (low + high) >> 1; if (lineOf(middle) >= line) high = middle; else low = middle + 1; }
  } catch { return null; }
  if (low <= from || low >= to) return null;
  const doc = view.state.doc;
  let position = low;
  for (let back = position; back > from && position - back < 80; back--) {
    const before = doc.textBetween(back - 1, back, '\n', '\0');
    if (/\s/u.test(before)) { position = back; break; }
    if (before === '\0' || before === '') break;
  }
  cache.starts.set(line, position - unit.pos);
  return position;
}

function band(gap: { band: number }, left: number, width: number) {
  const element = document.createElement('div');
  element.className = 'ww-page-gap-band';
  element.style.top = `${gap.band}px`; element.style.height = `${GUTTER}px`;
  element.style.left = `${left}px`; element.style.right = 'auto'; element.style.width = `${width}px`;
  return element;
}

function spacer(gap: PageGap | null, height: number, left: number, width: number) {
  const element = document.createElement('div');
  element.className = gap ? 'ww-page-gap' : 'ww-page-gap ww-page-filler';
  element.contentEditable = 'false';
  element.setAttribute('aria-hidden', 'true');
  element.style.height = `${height}px`;
  element.style.margin = '0';
  if (gap) element.appendChild(band(gap, left, width));
  return element;
}

function splitSpacer(split: PageSplit, left: number, width: number) {
  const element = document.createElement('span');
  element.className = 'ww-page-split';
  element.contentEditable = 'false';
  element.setAttribute('aria-hidden', 'true');
  element.style.height = `${split.height}px`;
  element.appendChild(band(split, left, width));
  return element;
}

function build(view: EditorView, measured: NonNullable<ReturnType<typeof measure>>, generation: number, onPages?: (pages: number) => void): DecorationSet {
  const plan = planPages(measured.blocks, measured.sheet);
  // The page count drives the running header and footer, which are drawn outside the editor.
  onPages?.(plan.pages);
  const round = (value: number) => Math.round(value * 100) / 100;
  // The band spans the whole sheet: from the sheet's left edge (less 4 px of shadow) across its width.
  const offsetOf = (index: number, content: boolean) => {
    const dom = measured.doms[index]!; const parent = dom.parentElement ?? dom;
    const rect = (content ? dom : parent).getBoundingClientRect();
    const css = styled.get(measured.units[index]!.node);
    const inset = (rect.left - measured.rootLeft) / measured.scale + (content ? css?.padLeft ?? 0 : parent === view.dom ? 0 : px(getComputedStyle(parent).paddingLeft));
    return { left: round(-(inset + measured.marginLeft + 4)), width: round(measured.pageWidth + 8) };
  };
  const decorations: Decoration[] = plan.gaps.map((gap) => {
    const shaped = { ...gap, height: round(gap.height), band: round(gap.band) };
    const { left, width } = offsetOf(gap.index, false);
    return Decoration.widget(measured.units[gap.index]!.pos, () => spacer(shaped, shaped.height, left, width), { side: -1, ignoreSelection: true, key: `page-gap-${shaped.height}-${shaped.band}-${left}` });
  });
  for (const split of plan.splits) {
    const unit = measured.units[split.index]!; const block = measured.blocks[split.index]!;
    const grid = typeof block.lines === 'function' ? block.lines() : block.lines;
    if (!grid) continue;
    const position = lineStart(view, unit, measured.doms[split.index]!, grid, split.line, measured.scale, measured.spacers[split.index] ?? [], generation);
    if (position === null) continue;
    const shaped = { ...split, height: round(split.height), band: round(split.band) };
    const { left, width } = offsetOf(split.index, true);
    decorations.push(Decoration.widget(position, () => splitSpacer(shaped, left, width), { side: -1, ignoreSelection: true, split: true, height: shaped.height, key: `page-split-${shaped.height}-${shaped.band}-${left}` }));
  }
  const filler = round(plan.filler);
  if (filler > 0) decorations.push(Decoration.widget(view.state.doc.content.size, () => spacer(null, filler, 0, 0), { side: 1, ignoreSelection: true, key: `page-filler-${filler}` }));
  return DecorationSet.create(view.state.doc, decorations);
}

const same = (a: DecorationSet, b: DecorationSet, size: number) => {
  const left = a.find(0, size); const right = b.find(0, size);
  return left.length === right.length && left.every((item, at) => item.from === right[at]!.from && (item.spec as { key?: string }).key === (right[at]!.spec as { key?: string }).key);
};

export function paginationExtension({ enabled, onPages }: { enabled: () => boolean; onPages?: (pages: number) => void }) {
  return Extension.create({
    name: 'pagination',
    addProseMirrorPlugins() {
      return [new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) { const next = tr.getMeta(paginationKey) as DecorationSet | undefined; return next ?? old.map(tr.mapping, tr.doc); },
        },
        props: {
          decorations(state) { return enabled() && !window.matchMedia(NARROW).matches ? paginationKey.getState(state) : DecorationSet.empty; },
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined; let width = -1; let wasEnabled = enabled();
          // Anything that reflows text (width, page setup, fonts) invalidates every cached measurement at once.
          let generation = 0;
          let host: Element | null = null;
          const vars = new MutationObserver(() => { generation++; schedule(0); });
          const watch = () => {
            const next = view.dom.closest('.editor-paged');
            if (next === host) return;
            vars.disconnect(); host = next; generation++;
            if (host) vars.observe(host, { attributes: true, attributeFilter: ['style'] });
          };
          // Applying thousands of changed spacers at once means one long reflow; a long notebook gets them in slices,
          // the part on screen first, with the browser free to handle typing in between. An edit cancels the rest:
          // the next run starts again from the document as it is.
          let pending: ReturnType<typeof setTimeout> | undefined;
          const apply = (next: DecorationSet) => {
            clearTimeout(pending);
            const doc = view.state.doc; const size = doc.content.size;
            const wanted = next.find(0, size);
            if (wanted.length < SLICE) { view.dispatch(view.state.tr.setMeta(paginationKey, next).setMeta('addToHistory', false)); return; }
            const box = view.dom.getBoundingClientRect(); const scroller = view.dom.closest('.editor-paged') ?? document.documentElement;
            const visible = scroller.getBoundingClientRect();
            const at = (y: number) => view.posAtCoords({ left: box.left + 4, top: Math.min(Math.max(y, box.top + 1), box.bottom - 1) })?.pos ?? 0;
            const first = at(visible.top - visible.height); const last = at(visible.bottom + visible.height);
            const cuts = [0];
            for (let index = SLICE; index < wanted.length; index += SLICE) cuts.push(wanted[index]!.from);
            cuts.push(size + 1);
            const slices = cuts.slice(1).map((to, index) => [cuts[index]!, to] as const);
            slices.sort((a, b) => Number(!(a[0] <= last && a[1] > first)) - Number(!(b[0] <= last && b[1] > first)) || a[0] - b[0]);
            const step = (index: number) => {
              if (view.isDestroyed || view.state.doc !== doc) return;
              const [from, to] = slices[index]!;
              const current = paginationKey.getState(view.state) ?? DecorationSet.empty;
              const merged = current.remove(current.find(from, to - 1)).add(doc, wanted.filter((item) => item.from >= from && item.from < to));
              view.dispatch(view.state.tr.setMeta(paginationKey, merged).setMeta('addToHistory', false));
              if (index + 1 < slices.length) pending = setTimeout(() => step(index + 1), 0);
            };
            step(0);
          };
          const run = () => {
            if (view.isDestroyed) return;
            watch();
            if (view.composing) { schedule(); return; }
            const active = enabled() && !window.matchMedia(NARROW).matches;
            const measured = active ? measure(view, generation) : null;
            if (active && !measured) return;
            const next = measured ? build(view, measured, generation, onPages) : DecorationSet.empty;
            if (!measured) onPages?.(1);
            const current = paginationKey.getState(view.state) ?? DecorationSet.empty;
            if (same(current, next, view.state.doc.content.size)) return;
            apply(next);
          };
          // A long notebook waits for a longer pause before re-measuring, so typing never queues behind a reflow.
          const schedule = (delay?: number) => {
            const size = view.state.doc.content.size;
            clearTimeout(timer);
            // A timer, not an animation frame: a tab in the background still gets its pages counted.
            timer = setTimeout(run, delay ?? (size > 3_000_000 ? 800 : size > 500_000 ? 400 : 120));
          };
          // Only width changes reflow text; height changes are our own spacers and must not retrigger.
          const resize = new ResizeObserver((entries) => {
            const next = Math.round(entries[0]?.contentRect.width ?? 0);
            if (next !== width) { width = next; generation++; schedule(40); }
          });
          resize.observe(view.dom);
          const media = window.matchMedia(NARROW);
          const onMedia = () => { generation++; schedule(0); };
          media.addEventListener('change', onMedia);
          const fonts = document.fonts;
          const onFonts = () => { generation++; schedule(0); };
          fonts?.addEventListener('loadingdone', onFonts);
          void fonts?.ready.then(onFonts);
          // The first measurement waits for the page fonts (ready.then above), so a long notebook is not measured twice.
          if (!fonts || fonts.status === 'loaded') schedule(0);
          return {
            update(updated, previous) {
              const now = enabled();
              watch();
              if (updated.state.doc !== previous.doc || now !== wasEnabled) { wasEnabled = now; schedule(); }
            },
            destroy() {
              clearTimeout(timer); clearTimeout(pending); resize.disconnect(); vars.disconnect();
              media.removeEventListener('change', onMedia); fonts?.removeEventListener('loadingdone', onFonts);
            },
          };
        },
      })];
    },
  });
}
