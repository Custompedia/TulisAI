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

export const contentWidth = (size: PageSize) => { const page = PAGES[size]; return page.width - page.margin.left - page.margin.right; };

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
export function pageStyle(size: PageSize): Record<string, string> {
  const page = PAGES[size];
  const px = (twips: number) => `${twipsToPx(twips).toFixed(2)}px`;
  return {
    '--page-width': px(page.width),
    '--page-height': px(page.height),
    '--page-margin-top': px(page.margin.top),
    '--page-margin-right': px(page.margin.right),
    '--page-margin-bottom': px(page.margin.bottom),
    '--page-margin-left': px(page.margin.left),
    '--page-content-width': px(contentWidth(size)),
    '--page-font': DEFAULT_FONT_STACK,
    '--page-heading-font': HEADING_FONT_STACK,
    '--page-font-size': `${(DEFAULT_FONT_POINTS * (96 / 72)).toFixed(4)}px`,
    '--page-line-height': String(LINE_HEIGHT),
    '--page-space-after': px(SPACE_AFTER_TWIPS),
    '--page-tab': px(DEFAULT_TAB_TWIPS),
  };
}
