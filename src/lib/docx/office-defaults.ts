// One source for the Word defaults, used by the DOCX writer and by the on-screen page preview, so the
// preview cannot drift from the exported file. Values are the Word 2013+ Normal template.

export type PageSize = 'a4' | 'letter';

// OOXML measures length in twips: 1 inch = 1440 twips = 72 pt = 96 CSS px.
export const TWIPS_PER_INCH = 1440;
export const TWIPS_PER_PX = TWIPS_PER_INCH / 96;
export const TWIPS_PER_POINT = TWIPS_PER_INCH / 72;

export const twipsToPx = (twips: number) => twips / TWIPS_PER_PX;
export const twipsToMm = (twips: number) => (twips / TWIPS_PER_INCH) * 25.4;
export const pointsToHalfPoints = (points: number) => Math.round(points * 2);

export type PageGeometry = { width: number; height: number; margin: { top: number; right: number; bottom: number; left: number } };

// A4 is 210×297 mm; Letter is 8.5×11 in. Word 2007+ "Normal" margins are 1 inch on all four sides
// (the 1.25 inch left/right belongs to Word 2003 and earlier).
export const PAGES: Record<PageSize, PageGeometry> = {
  a4: { width: 11906, height: 16838, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
  letter: { width: 12240, height: 15840, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
};

// Word picks the page size from the editing locale; Letter is the US default, A4 is the default elsewhere.
export const defaultPageSize = (language: string): PageSize => (language === 'en' ? 'letter' : 'a4');

export type Orientation = 'portrait' | 'landscape';
export const asOrientation = (value: unknown): Orientation => (value === 'landscape' ? 'landscape' : 'portrait');
// Landscape is the same sheet turned: Word writes the swapped w:pgSz and keeps the margins as given.
export const pageGeometry = (size: PageSize, orientation: Orientation = 'portrait'): PageGeometry => {
  const page = PAGES[size];
  return orientation === 'landscape' ? { width: page.height, height: page.width, margin: page.margin } : page;
};

// Word's Normal template puts the header 0.5 inch from the top of the sheet and the footer 0.5 inch from the bottom.
export const HEADER_DISTANCE_TWIPS = 720;
export const FOOTER_DISTANCE_TWIPS = 720;
// Newspaper columns: Word's default gap between columns is 0.5 inch.
export const COLUMN_GAP_TWIPS = 720;
export const MAX_COLUMNS = 3;
export const asColumns = (value: unknown): number => {
  const count = Math.trunc(Number(value));
  return Number.isFinite(count) && count >= 1 && count <= MAX_COLUMNS ? count : 1;
};

export type PageMargins = PageGeometry['margin'];
const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'] as const;
// Stored in notebook preferences as "top,right,bottom,left" twips, since preferences only hold primitives.
export const formatMargins = (margins: PageMargins): string => MARGIN_SIDES.map((side) => Math.round(margins[side])).join(',');
export function parseMargins(value: unknown, size: PageSize = 'a4', orientation: Orientation = 'portrait'): PageMargins | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 7200)) return null;
  const [top, right, bottom, left] = parts as [number, number, number, number];
  const page = pageGeometry(size, orientation);
  // A margin set that leaves under an inch of text area is a corrupt value, not a layout.
  return page.width - left - right >= TWIPS_PER_INCH && page.height - top - bottom >= TWIPS_PER_INCH ? { top, right, bottom, left } : null;
}

export const contentWidth = (size: PageSize, margins: PageMargins = PAGES[size].margin, orientation: Orientation = 'portrait') => {
  const page = pageGeometry(size, orientation);
  return page.width - margins.left - margins.right;
};
// The width one column of text occupies, which is what a table's percentage width and the canvas both measure against.
export const columnWidth = (size: PageSize, margins: PageMargins, orientation: Orientation, columns: number) => {
  const total = contentWidth(size, margins, orientation);
  const count = asColumns(columns);
  return Math.max(720, Math.round((total - COLUMN_GAP_TWIPS * (count - 1)) / count));
};

export const DEFAULT_FONT = 'Calibri';
// Calibri cannot be redistributed as a webfont; Carlito has the same metrics, so line breaks land identically.
export const DEFAULT_FONT_STACK = "'Carlito','Calibri',Arial,sans-serif";
export const HEADING_FONT = 'Calibri Light';
export const HEADING_FONT_STACK = "'Carlito','Calibri Light','Calibri',Arial,sans-serif";
export const DEFAULT_FONT_POINTS = 11;

// Word's "multiple 1.08" multiplies the FONT's single-line height, not the font size. Carlito's hhea table
// (and Calibri's, which it matches) gives ascent 1950, descent -550 and lineGap 0 over 2048 units per em,
// so one line is (1950 + 550 + 0) / 2048 = 1.2207 em, and 1.08 of that is the CSS line-height below.
// Verified against public/fonts/Carlito-Regular.ttf, which the paged preview actually loads.
export const LINE_SPACING_MULTIPLE = 1.08;
export const FONT_LINE_HEIGHT = 2500 / 2048;
export const LINE_HEIGHT = Number((LINE_SPACING_MULTIPLE * FONT_LINE_HEIGHT).toFixed(4));
// OOXML stores "multiple" spacing in 240ths of a line.
export const LINE_RULE_AUTO = Math.round(LINE_SPACING_MULTIPLE * 240);

// Normal style paragraph spacing: 8 pt after, nothing before.
export const SPACE_AFTER_TWIPS = 160;
export const SPACE_BEFORE_TWIPS = 0;
export const DEFAULT_TAB_TWIPS = 720;

export type HeadingStyle = { points: number; color: string; spaceBefore: number; light: boolean };
// Word's built-in heading sizes and the accent colour from the Office theme.
export const HEADINGS: Record<1 | 2 | 3 | 4 | 5 | 6, HeadingStyle> = {
  1: { points: 16, color: '2F5496', spaceBefore: 240, light: true },
  2: { points: 13, color: '2F5496', spaceBefore: 40, light: true },
  3: { points: 12, color: '1F3763', spaceBefore: 40, light: false },
  4: { points: 11, color: '2F5496', spaceBefore: 40, light: false },
  5: { points: 11, color: '2F5496', spaceBefore: 40, light: false },
  6: { points: 11, color: '1F3763', spaceBefore: 40, light: false },
};

export type Alignment = 'left' | 'center' | 'right' | 'justify';
// OOXML calls justify "both"; everything else keeps its name.
export const JUSTIFICATION: Record<Alignment, string> = { left: 'left', center: 'center', right: 'right', justify: 'both' };
export const alignmentFrom = (value: unknown): Alignment | null =>
  value === 'center' || value === 'right' || value === 'justify' || value === 'left' ? value : null;
export const alignmentOf = (justification: string | null | undefined): Alignment | null =>
  justification === 'both' ? 'justify' : justification === 'center' || justification === 'right' || justification === 'left' ? justification : null;

// CSS custom properties for the paged canvas, derived from exactly the numbers above.
export type PageLayout = { size: PageSize; margins?: PageMargins | null; orientation?: Orientation; columns?: number };

// CSS custom properties for the paged canvas, derived from exactly the numbers above.
export function pageStyle(layout: PageLayout): Record<string, string> {
  const orientation = asOrientation(layout.orientation);
  const columns = asColumns(layout.columns);
  const page = pageGeometry(layout.size, orientation);
  const margin = layout.margins ?? page.margin;
  const px = (twips: number) => `${twipsToPx(twips).toFixed(2)}px`;
  return {
    '--page-width': px(page.width),
    '--page-height': px(page.height),
    '--page-margin-top': px(margin.top),
    '--page-margin-right': px(margin.right),
    '--page-margin-bottom': px(margin.bottom),
    '--page-margin-left': px(margin.left),
    '--page-content-width': px(contentWidth(layout.size, margin, orientation)),
    '--page-column-count': String(columns),
    '--page-column-gap': px(COLUMN_GAP_TWIPS),
    '--page-header-top': px(HEADER_DISTANCE_TWIPS),
    '--page-footer-bottom': px(FOOTER_DISTANCE_TWIPS),
    '--page-font': DEFAULT_FONT_STACK,
    '--page-heading-font': HEADING_FONT_STACK,
    '--page-font-size': `${(DEFAULT_FONT_POINTS * (96 / 72)).toFixed(4)}px`,
    '--page-line-height': String(LINE_HEIGHT),
    '--page-space-after': px(SPACE_AFTER_TWIPS),
    '--page-tab': px(DEFAULT_TAB_TWIPS),
  };
}

// Word's "multiple" line spacing scales the font's own line height ((ascent + descent + gap) / em), so a CSS
// ratio needs that factor too; unknown fonts get a typical 1.15.
const FONT_LINE_FACTORS: Record<string, number> = {
  calibri: FONT_LINE_HEIGHT, 'calibri light': FONT_LINE_HEIGHT, carlito: FONT_LINE_HEIGHT, cambria: 1.1719, caladea: 1.1719,
  'times new roman': 1.1499, tinos: 1.1499, 'liberation serif': 1.1499, arial: 1.1499, arimo: 1.1499, 'liberation sans': 1.1499,
  'courier new': 1.1328, cousine: 1.1328, georgia: 1.1362, verdana: 1.2153, tahoma: 1.2075, 'segoe ui': 1.3301,
  garamond: 1.1245, 'book antiqua': 1.1704, 'bookman old style': 1.1699, 'century gothic': 1.2266, 'trebuchet ms': 1.1611,
};
export const fontLineFactor = (font: string | null | undefined) => FONT_LINE_FACTORS[(font ?? DEFAULT_FONT).toLowerCase()] ?? 1.15;

// Metric-compatible open fonts, so a document set in an Office font keeps its line breaks where the Office font is missing.
const FONT_SUBSTITUTES: Record<string, string> = {
  calibri: 'Carlito', 'calibri light': 'Carlito', cambria: 'Caladea', 'times new roman': 'Tinos', arial: 'Arimo', 'courier new': 'Cousine',
};
const GENERIC = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)$/u;
const quoteFamily = (name: string) => /^[a-z][\w-]*$/iu.test(name) ? name : `'${name}'`;
// A Word font name as a CSS font-family stack; the Word name leads so an installed Office font wins.
export function fontStack(name: string): string {
  const clean = name.replace(/['";{}<>\\]/gu, '').trim().slice(0, 80);
  const substitute = FONT_SUBSTITUTES[clean.toLowerCase()];
  return [clean, substitute].filter(Boolean).map((family) => quoteFamily(family!)).join(', ');
}
const SUBSTITUTE_OF: Record<string, string> = { carlito: 'Calibri', caladea: 'Cambria', tinos: 'Times New Roman', 'liberation serif': 'Times New Roman', arimo: 'Arial', 'liberation sans': 'Arial', cousine: 'Courier New', 'liberation mono': 'Courier New' };
// The Word font name back out of a CSS stack: the first real family, with open substitutes mapped to their Office original.
export function fontFromStack(stack: string): string | null {
  const first = stack.split(',').map((family) => family.trim().replace(/^['"]|['"]$/gu, '').trim()).find((family) => family && !GENERIC.test(family));
  return first ? SUBSTITUTE_OF[first.toLowerCase()] ?? first : null;
}

// The sixteen colours w:highlight can name; anything else travels as run shading.
export const HIGHLIGHT_COLORS: Record<string, string> = {
  black: '000000', blue: '0000FF', cyan: '00FFFF', green: '00FF00', magenta: 'FF00FF', red: 'FF0000', yellow: 'FFFF00', white: 'FFFFFF',
  darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0',
};
