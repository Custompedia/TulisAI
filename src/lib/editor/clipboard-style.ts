import {
  DEFAULT_FONT_POINTS, DEFAULT_FONT_STACK, HEADING_FONT_STACK, HEADINGS, LINE_HEIGHT,
  SPACE_AFTER_TWIPS, DEFAULT_TAB_TWIPS, twipsToPx,
} from '../docx/office-defaults';

// Pasting carried only the structure, so Word and Docs applied their own spacing and the result did not
// look like the canvas. These profiles restate the canvas rules as inline CSS, which both apps honour.
// Numbers come from the same constants the canvas and the DOCX writer use, so the three cannot drift.

export type ClipboardMode = 'paged' | 'plain';

export type ClipboardStyle = {
  root: string;
  paragraph: string;
  heading: (level: number) => string;
  list: string;
  listItemParagraph: string;
  blockquote: string;
  rule: string;
  table: string;
  cell: string;
  headerCell: string;
  link: string;
};

const px = (value: number) => `${Number(value.toFixed(2))}px`;
const join = (...declarations: Array<string | false | undefined>) => declarations.filter(Boolean).join('');

// Advanced mode: Word's Normal template, matching .editor-paged in globals.css.
const PAGED_SPACE_AFTER = twipsToPx(SPACE_AFTER_TWIPS);
const PAGED_INDENT = twipsToPx(DEFAULT_TAB_TWIPS);
const PAGED_FONT_PX = DEFAULT_FONT_POINTS * (96 / 72);
// Word's heading spacing is a space-before in twips; the canvas renders it as padding-top.
const headingSpaceBefore = (level: number) => twipsToPx(HEADINGS[level as 1]?.spaceBefore ?? 0);
const headingPoints = (level: number) => HEADINGS[level as 1]?.points ?? DEFAULT_FONT_POINTS;
const headingColor = (level: number) => `#${HEADINGS[level as 1]?.color ?? '2f5496'}`;

const PAGED: ClipboardStyle = {
  root: `font-family:${DEFAULT_FONT_STACK};font-size:${px(PAGED_FONT_PX)};line-height:${LINE_HEIGHT};color:#000;`,
  paragraph: `margin:0 0 ${px(PAGED_SPACE_AFTER)};line-height:${LINE_HEIGHT};`,
  heading: (level) => `font-family:${HEADING_FONT_STACK};font-weight:400;color:${headingColor(level)};font-size:${px(headingPoints(level) * (96 / 72))};line-height:${LINE_HEIGHT};margin:${px(headingSpaceBefore(level))} 0 0;`,
  list: `margin:0 0 ${px(PAGED_SPACE_AFTER)};padding-left:${px(PAGED_INDENT)};`,
  listItemParagraph: `margin:0;line-height:${LINE_HEIGHT};`,
  blockquote: `margin:${px(PAGED_SPACE_AFTER * 1.25)} ${px(PAGED_INDENT)};font-style:italic;color:#404040;border:0;padding:0;`,
  rule: `border:0;border-top:1px solid #000;margin:0 0 ${px(PAGED_SPACE_AFTER)};`,
  table: `border-collapse:collapse;margin:0 0 ${px(PAGED_SPACE_AFTER)};`,
  cell: 'border:0.5pt solid #000;padding:0 5.33px;vertical-align:top;text-align:left;',
  headerCell: 'border:0.5pt solid #000;padding:0 5.33px;vertical-align:top;text-align:left;font-weight:700;',
  link: 'color:#0563c1;text-decoration:underline;',
};

// Plain mode: matching .editor-plain in globals.css (16px, 1.75, 0.75em between blocks).
const PLAIN_FONT_PX = 16;
const PLAIN_LINE_HEIGHT = 1.75;
const PLAIN_GAP = PLAIN_FONT_PX * 0.75;

const PLAIN: ClipboardStyle = {
  root: `font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:${px(PLAIN_FONT_PX)};line-height:${PLAIN_LINE_HEIGHT};color:#1f201d;`,
  paragraph: `margin:0 0 ${px(PLAIN_GAP)};line-height:${PLAIN_LINE_HEIGHT};`,
  heading: (level) => `font-weight:600;font-size:${px(PLAIN_FONT_PX * (level === 1 ? 1.9 : level === 2 ? 1.45 : level === 3 ? 1.2 : 1.05))};line-height:1.3;margin:0 0 ${px(PLAIN_GAP)};`,
  list: `margin:0 0 ${px(PLAIN_GAP)};padding-left:${px(PLAIN_FONT_PX * 1.5)};`,
  listItemParagraph: `margin:${px(PLAIN_FONT_PX * 0.15)} 0;line-height:${PLAIN_LINE_HEIGHT};`,
  blockquote: `margin:0 0 ${px(PLAIN_GAP)};padding-left:${px(PLAIN_FONT_PX)};border-left:3px solid #d9dbd4;color:#5b5f55;`,
  rule: `border:0;border-top:1px solid #d9dbd4;margin:${px(PLAIN_GAP)} 0;`,
  table: `border-collapse:collapse;margin:0 0 ${px(PLAIN_GAP)};font-size:${px(PLAIN_FONT_PX * 0.95)};`,
  cell: 'border:1px solid #c7cabf;padding:0.45em 0.7em;vertical-align:top;text-align:left;',
  headerCell: 'border:1px solid #c7cabf;padding:0.45em 0.7em;vertical-align:top;text-align:left;font-weight:600;background:#f5f6f2;',
  link: 'color:#3f7a2e;text-decoration:underline;',
};

export const clipboardStyle = (mode: ClipboardMode): ClipboardStyle => (mode === 'paged' ? PAGED : PLAIN);

// Merges a block's own declarations with the alignment the writer chose, so neither overwrites the other.
export const withAlignment = (declarations: string, align: string | null) => join(declarations, align && align !== 'left' ? `text-align:${align};` : '');
