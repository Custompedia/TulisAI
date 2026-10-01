import { Node, mergeAttributes } from '@tiptap/core';

// Where a Word picture was: the picture itself is not imported, but the notebook keeps an empty box of exactly its
// size in exactly its place, so every line of text around it stays where it was in the .docx. Sizes are points
// (DrawingML EMU / 12700). `wrap` follows Word's text wrapping:
//   inline  an inline picture (wp:inline): a box on the text line, like a very large character;
//   block   "top and bottom": the box takes the full line and the text continues under it;
//   left / right  "square" and "tight": a floated box the text flows around, on that side.
// A picture behind or in front of the text never moved the text in Word, so it leaves no box at all.
export const IMAGE_SPACE_LABEL = 'Gambar tidak diimpor';
export const IMAGE_WRAPS = ['inline', 'block', 'left', 'right'] as const;
export type ImageWrap = (typeof IMAGE_WRAPS)[number];
// Anything above about 70 cm is not a page object, so a corrupt extent cannot make a box taller than many pages.
export const MAX_IMAGE_POINTS = 2000;

export const imagePoints = (value: unknown): number | null => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? Math.min(MAX_IMAGE_POINTS, Math.round(number * 100) / 100) : null;
};
const gapPoints = (value: unknown): number | null => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? Math.min(200, Math.round(number * 100) / 100) : null;
};
export const imageWrap = (value: unknown): ImageWrap => (IMAGE_WRAPS as readonly unknown[]).includes(value) ? value as ImageWrap : 'inline';
const MARGINS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;

// The inline CSS that gives the box its size; shared with the clipboard and HTML export.
export function imageSpaceStyle(attrs: Record<string, unknown>): string {
  const width = imagePoints(attrs.width) ?? 0; const height = imagePoints(attrs.height) ?? 0;
  const margins = MARGINS.map((side) => gapPoints(attrs[side]) ?? 0);
  return `width:${width}pt;height:${height}pt${margins.some(Boolean) ? `;margin:${margins.map((gap) => `${gap}pt`).join(' ')}` : ''}`;
}

export const ImageSpace = Node.create({
  name: 'imageSpace',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    const number = (name: string, read: (value: unknown) => number | null) => ({ default: null, parseHTML: (element: HTMLElement) => read(element.getAttribute(`data-${name}`)), renderHTML: () => ({}) });
    return {
      width: number('width', imagePoints), height: number('height', imagePoints),
      wrap: { default: 'inline', parseHTML: (element: HTMLElement) => imageWrap(element.getAttribute('data-wrap')), renderHTML: () => ({}) },
      ...Object.fromEntries(MARGINS.map((side) => [side, number(side.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`), gapPoints)])),
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-image-space]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as Record<string, unknown>;
    const wrap = imageWrap(attrs.wrap);
    const data = Object.fromEntries(MARGINS.flatMap((side) => { const gap = gapPoints(attrs[side]); return gap ? [[`data-${side.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`, String(gap)]] : []; }));
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-image-space': '', 'data-wrap': wrap, 'data-width': String(imagePoints(attrs.width) ?? 0), 'data-height': String(imagePoints(attrs.height) ?? 0), ...data,
      class: `ww-image-space ww-image-space-${wrap}`, contenteditable: 'false', role: 'img', 'aria-label': IMAGE_SPACE_LABEL, title: IMAGE_SPACE_LABEL,
      style: imageSpaceStyle(attrs),
    })];
  },
});
