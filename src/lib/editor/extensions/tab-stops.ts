import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { parseTabStops, type TabStop } from './paragraph-format';

// Word's default grid when a paragraph states no stops of its own: every half inch from the left margin.
export const DEFAULT_TAB_POINTS = 36;
const EPSILON = 0.01;
export const tabStopsKey = new PluginKey<DecorationSet>('tabStops');

// The stop a tab at `x` lands on: the first stated stop past it, or the next default step after them all.
export function nextStop(stops: TabStop[], x: number, limit: number): TabStop {
  const stated = stops.find((stop) => stop.position > x + EPSILON);
  if (stated) return stated;
  const floor = Math.max(x, stops.length ? stops[stops.length - 1]!.position : 0);
  const position = (Math.floor(floor / DEFAULT_TAB_POINTS) + 1) * DEFAULT_TAB_POINTS;
  return { position: Math.min(position, limit), align: 'left' };
}

// Widths for each tab in one line, from the widths of the text between them. All lengths are points.
// `segments[0]` is the text before the first tab, so there is one tab fewer than there are segments.
export function planTabs(segments: number[], stops: TabStop[], start: number, limit: number): number[] {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const widths: number[] = [];
  let x = start + (segments[0] ?? 0);
  for (let index = 1; index < segments.length; index++) {
    const width = segments[index] ?? 0;
    const stop = nextStop(sorted, x, limit);
    // A right or centre stop places the text that follows, so the tab takes up whatever is left in front of it.
    const textStart = stop.align === 'right' || stop.align === 'decimal' ? stop.position - width
      : stop.align === 'center' ? stop.position - width / 2
      : stop.position;
    widths.push(Math.max(0, textStart - x));
    x = Math.max(x, textStart) + width;
  }
  return widths;
}

const PX_PER_POINT = 96 / 72;
const px = (value: string) => { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : 0; };

type Block = { positions: number[]; stops: TabStop[]; blockStart: number; blockEnd: number };

// Every text block that actually contains a tab, with the document positions of those tabs.
function tabbedBlocks(view: EditorView): Block[] {
  const blocks: Block[] = [];
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!node.textContent.includes('\t')) return false;
    const blockStart = pos + 1;
    const positions: number[] = [];
    let offset = 0;
    node.forEach((child) => {
      if (child.isText) {
        const text = child.text ?? '';
        for (let index = 0; index < text.length; index++) if (text[index] === '\t') positions.push(blockStart + offset + index);
      }
      offset += child.nodeSize;
    });
    if (positions.length) blocks.push({ positions, stops: parseTabStops(node.attrs.tabStops), blockStart, blockEnd: blockStart + node.content.size });
    return false;
  });
  return blocks;
}

// The width of the text between two positions. A Range measures the run itself, so it stays correct even when
// the line around it wraps — which is exactly the state a mispositioned tab leaves the paragraph in.
function segmentWidth(view: EditorView, from: number, to: number): number | null {
  if (to <= from) return 0;
  try {
    const start = view.domAtPos(from); const end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rects = range.getClientRects();
    // More than one rect means the run itself breaks across lines, and no single tab width can fix that.
    if (rects.length !== 1) return rects.length === 0 ? 0 : null;
    return rects[0]!.width;
  } catch { return null; }
}

function build(view: EditorView): DecorationSet {
  const style = getComputedStyle(view.dom);
  const contentWidth = px(style.getPropertyValue('--page-content-width'));
  const box = view.dom.getBoundingClientRect();
  if (!contentWidth || box.width === 0) return DecorationSet.empty;
  // Zoom scales every measurement equally, so dividing by it brings them back to the page's own pixels.
  const scale = box.width / contentWidth;
  const points = (value: number) => (value / scale) / PX_PER_POINT;
  const limit = points(box.width);

  const decorations: Decoration[] = [];
  for (const block of tabbedBlocks(view)) {
    // Segment 0 runs from the block start to the first tab; every later one runs from a tab to the next.
    const edges = [block.blockStart, ...block.positions.flatMap((position) => [position, position + 1]), block.blockEnd];
    const segments: number[] = [];
    for (let index = 0; index + 1 < edges.length; index += 2) {
      const width = segmentWidth(view, edges[index]!, edges[index + 1]!);
      if (width === null) { segments.length = 0; break; }
      segments.push(points(width));
    }
    if (!segments.length) continue;
    let start = 0;
    try { start = points(view.coordsAtPos(block.blockStart).left - box.left); } catch { continue; }
    const widths = planTabs(segments, block.stops, Math.max(0, start), limit);
    block.positions.forEach((position, index) => {
      const width = Math.round((widths[index] ?? 0) * PX_PER_POINT * 100) / 100;
      decorations.push(Decoration.inline(position, position + 1, { style: `display:inline-block;width:${width}px;overflow:hidden` }, { key: `tab-${position}-${width}` }));
    });
  }
  return DecorationSet.create(view.state.doc, decorations);
}

const same = (a: DecorationSet, b: DecorationSet, size: number) => {
  const left = a.find(0, size); const right = b.find(0, size);
  return left.length === right.length && left.every((item, at) => item.from === right[at]!.from && (item.spec as { key?: string }).key === (right[at]!.spec as { key?: string }).key);
};

// Real tab stops: a tab is measured and given the width that lands the text on its stop, the way Word does it,
// instead of the browser's fixed tab grid. That is what puts a right-aligned date at the margin.
export function tabStopsExtension({ enabled }: { enabled: () => boolean }) {
  return Extension.create({
    name: 'tabStops',
    addProseMirrorPlugins() {
      return [new Plugin<DecorationSet>({
        key: tabStopsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) { const next = tr.getMeta(tabStopsKey) as DecorationSet | undefined; return next ?? old.map(tr.mapping, tr.doc); },
        },
        props: { decorations(state) { return enabled() ? tabStopsKey.getState(state) : DecorationSet.empty; } },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined; let frame = 0; let width = -1;
          const run = () => {
            frame = 0;
            if (view.isDestroyed || view.composing) return;
            const next = enabled() ? build(view) : DecorationSet.empty;
            const current = tabStopsKey.getState(view.state) ?? DecorationSet.empty;
            if (same(current, next, view.state.doc.content.size)) return;
            view.dispatch(view.state.tr.setMeta(tabStopsKey, next).setMeta('addToHistory', false));
          };
          const schedule = (delay = 60) => {
            clearTimeout(timer);
            timer = setTimeout(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(run); }, delay);
          };
          const resize = new ResizeObserver((entries) => {
            const next = Math.round(entries[0]?.contentRect.width ?? 0);
            if (next !== width) { width = next; schedule(30); }
          });
          resize.observe(view.dom);
          const fonts = document.fonts;
          const onFonts = () => schedule(0);
          fonts?.addEventListener('loadingdone', onFonts);
          void fonts?.ready.then(onFonts);
          schedule(0);
          return {
            update(updated, previous) { if (updated.state.doc !== previous.doc) schedule(); },
            destroy() { clearTimeout(timer); cancelAnimationFrame(frame); resize.disconnect(); fonts?.removeEventListener('loadingdone', onFonts); },
          };
        },
      })];
    },
  });
}
