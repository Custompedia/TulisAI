import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

// Measured top-level block, in unzoomed CSS px. `gap` is the natural space above it (for the first block: its offset).
export type PageBlock = { height: number; gap: number; marginTop: number; marginBottom: number; breakBefore: boolean; pageBreak: boolean };
export type SheetGeometry = { height: number; top: number; bottom: number; gutter: number };
// A spacer before block `index`: `height` px tall, with the grey gutter band starting `band` px from its top.
export type PageGap = { index: number; height: number; band: number };
export type PagePlan = { gaps: PageGap[]; filler: number; pages: number };

const EPSILON = 0.5;

// Pure layout: which blocks start a new sheet and how tall each spacer must be so the block lands on the next page's top margin.
export function planPages(blocks: PageBlock[], sheet: SheetGeometry): PagePlan {
  const body = sheet.height - sheet.top - sheet.bottom;
  const stride = sheet.height + sheet.gutter;
  const gaps: PageGap[] = [];
  let page = 0; let pageStart = 0; let bottom = 0; let marginBottom = 0; let placed = false;
  // A block taller than a page runs on over the next sheets; layout resumes on the sheet where it ends.
  const settle = (at: number, start: number) => { while (start + body < bottom - EPSILON) { at++; start += stride; } return { page: at, pageStart: start }; };
  blocks.forEach((block, index) => {
    if (!placed) { bottom = block.gap + block.height; marginBottom = block.marginBottom; placed = true; ({ page, pageStart } = settle(page, pageStart)); return; }
    const top = bottom + block.gap;
    const overflows = !block.pageBreak && top + block.height - pageStart > body + EPSILON;
    if (block.breakBefore || overflows) {
      const spacerTop = bottom + marginBottom;
      let next = page + 1;
      while (next * stride - sheet.top - sheet.gutter < spacerTop - EPSILON) next++;
      const target = next * stride;
      gaps.push({ index, height: Math.max(0, target - block.marginTop - spacerTop), band: target - sheet.top - sheet.gutter - spacerTop });
      page = next; pageStart = target; bottom = target + block.height;
    } else bottom = top + block.height;
    marginBottom = block.marginBottom;
    ({ page, pageStart } = settle(page, pageStart));
  });
  return { gaps, filler: Math.max(0, pageStart + body - (bottom + (placed ? marginBottom : 0))), pages: page + 1 };
}

export const paginationKey = new PluginKey<DecorationSet>('pagination');
const NARROW = '(max-width: 860px)';
const GUTTER = 16;

const px = (value: string) => { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : 0; };
// Two adjacent vertical margins collapse into one, per CSS 2.1 §8.3.1.
const collapse = (a: number, b: number) => (a >= 0 && b >= 0 ? Math.max(a, b) : a < 0 && b < 0 ? Math.min(a, b) : a + b);

function measure(view: EditorView): { blocks: PageBlock[]; sheet: SheetGeometry; positions: number[] } | null {
  const root = view.dom;
  const style = getComputedStyle(root);
  const contentWidth = px(style.getPropertyValue('--page-content-width'));
  const sheet = { height: px(style.getPropertyValue('--page-height')), top: px(style.getPropertyValue('--page-margin-top')), bottom: px(style.getPropertyValue('--page-margin-bottom')), gutter: GUTTER };
  const rootBox = root.getBoundingClientRect();
  if (!contentWidth || !sheet.height || rootBox.width === 0) return null;
  // Zoom scales every rect equally; dividing by it measures in the page's own CSS px.
  const scale = rootBox.width / contentWidth;
  const blocks: PageBlock[] = []; const positions: number[] = [];
  let previous: { box: DOMRect; marginBottom: number } | null = null; let afterBreak = false;
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const box = dom.getBoundingClientRect(); const css = getComputedStyle(dom);
    const marginTop = px(css.marginTop); const marginBottom = px(css.marginBottom);
    const spaced = dom.previousElementSibling?.classList.contains('ww-page-gap');
    const gap = !previous ? (box.top - rootBox.top) / scale : spaced ? collapse(previous.marginBottom, marginTop) : (box.top - previous.box.bottom) / scale;
    const pageBreak = node.type.name === 'pageBreak';
    blocks.push({ height: box.height / scale, gap, marginTop, marginBottom, breakBefore: afterBreak, pageBreak });
    positions.push(offset);
    previous = { box, marginBottom }; afterBreak = pageBreak;
  });
  return { blocks, sheet, positions };
}

function spacer(gap: PageGap | null, height: number) {
  const element = document.createElement('div');
  element.className = gap ? 'ww-page-gap' : 'ww-page-gap ww-page-filler';
  element.contentEditable = 'false';
  element.setAttribute('aria-hidden', 'true');
  element.style.height = `${height}px`;
  if (gap) {
    const band = document.createElement('div');
    band.className = 'ww-page-gap-band';
    band.style.top = `${gap.band}px`;
    band.style.height = `${GUTTER}px`;
    element.appendChild(band);
  }
  return element;
}

function build(view: EditorView, measured: NonNullable<ReturnType<typeof measure>>): DecorationSet {
  const plan = planPages(measured.blocks, measured.sheet);
  const round = (value: number) => Math.round(value * 100) / 100;
  const decorations = plan.gaps.map((gap) => {
    const shaped = { ...gap, height: round(gap.height), band: round(gap.band) };
    return Decoration.widget(measured.positions[gap.index]!, () => spacer(shaped, shaped.height), { side: -1, ignoreSelection: true, key: `page-gap-${shaped.height}-${shaped.band}` });
  });
  const filler = round(plan.filler);
  if (filler > 0) decorations.push(Decoration.widget(view.state.doc.content.size, () => spacer(null, filler), { side: 1, ignoreSelection: true, key: `page-filler-${filler}` }));
  return DecorationSet.create(view.state.doc, decorations);
}

const same = (a: DecorationSet, b: DecorationSet, size: number) => {
  const left = a.find(0, size); const right = b.find(0, size);
  return left.length === right.length && left.every((item, at) => item.from === right[at]!.from && (item.spec as { key?: string }).key === (right[at]!.spec as { key?: string }).key);
};

// Splits the paged canvas into separate sheets with widget spacers only; the document and its offsets never change.
export function paginationExtension({ enabled }: { enabled: () => boolean }) {
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
          let timer: ReturnType<typeof setTimeout> | undefined; let frame = 0; let width = -1; let wasEnabled = enabled();
          // Page size and margins arrive as custom properties on the canvas; a change there must re-flow the sheets.
          let host: Element | null = null;
          const vars = new MutationObserver(() => schedule(0));
          const watch = () => {
            const next = view.dom.closest('.editor-paged');
            if (next === host) return;
            vars.disconnect(); host = next;
            if (host) vars.observe(host, { attributes: true, attributeFilter: ['style'] });
          };
          const run = () => {
            frame = 0;
            if (view.isDestroyed) return;
            watch();
            if (view.composing) { schedule(); return; }
            const active = enabled() && !window.matchMedia(NARROW).matches;
            const measured = active ? measure(view) : null;
            if (active && !measured) return;
            const next = measured ? build(view, measured) : DecorationSet.empty;
            const current = paginationKey.getState(view.state) ?? DecorationSet.empty;
            if (same(current, next, view.state.doc.content.size)) return;
            view.dispatch(view.state.tr.setMeta(paginationKey, next).setMeta('addToHistory', false));
          };
          const schedule = (delay = 120) => {
            clearTimeout(timer);
            timer = setTimeout(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(run); }, delay);
          };
          // Only width changes reflow text; height changes are our own spacers and must not retrigger.
          const resize = new ResizeObserver((entries) => {
            const next = Math.round(entries[0]?.contentRect.width ?? 0);
            if (next !== width) { width = next; schedule(40); }
          });
          resize.observe(view.dom);
          const media = window.matchMedia(NARROW);
          const onMedia = () => schedule(0);
          media.addEventListener('change', onMedia);
          const fonts = document.fonts;
          const onFonts = () => schedule(0);
          fonts?.addEventListener('loadingdone', onFonts);
          void fonts?.ready.then(onFonts);
          schedule(0);
          return {
            update(updated, previous) {
              const now = enabled();
              watch();
              if (updated.state.doc !== previous.doc || now !== wasEnabled) { wasEnabled = now; schedule(); }
            },
            destroy() {
              clearTimeout(timer); cancelAnimationFrame(frame); resize.disconnect(); vars.disconnect();
              media.removeEventListener('change', onMedia); fonts?.removeEventListener('loadingdone', onFonts);
            },
          };
        },
      })];
    },
  });
}
