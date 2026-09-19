// One vocabulary for cell borders, shared by the editor attributes, the canvas CSS and the DOCX writer/reader.
// Widths are points, colours 6-digit hex with '#', and `null` means "no line" (Word's w:val="nil").

export const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];
export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];
export type BorderLine = { width: number; style: BorderStyle; color: string };

// The attribute a side is stored under on a table cell, e.g. "top" -> "borderTop".
export const borderAttr = (side: BorderSide) => `border${side[0]!.toUpperCase()}${side.slice(1)}` as const;

// Word's Table Grid, which is what an exported table uses when no side says otherwise.
export const DEFAULT_BORDER: BorderLine = { width: 0.5, style: 'solid', color: '#000000' };
export const BORDER_WIDTHS = [0.5, 1, 1.5, 2.25, 3] as const;

// OOXML names the styles differently and measures w:sz in eighths of a point, clamped to Word's own 2..96 range.
const OOXML_STYLE: Record<BorderStyle, string> = { solid: 'single', dashed: 'dashed', dotted: 'dotted', double: 'double' };
const CSS_STYLE: Record<string, BorderStyle> = {
  single: 'solid', thick: 'solid', wave: 'solid', doubleWave: 'double', double: 'double', triple: 'double',
  dashed: 'dashed', dashSmallGap: 'dashed', dotDash: 'dashed', dotDotDash: 'dashed', dashDotStroked: 'dashed',
  dotted: 'dotted', thinThickSmallGap: 'double', thickThinSmallGap: 'double', thinThickThinSmallGap: 'double',
  thinThickMediumGap: 'double', thickThinMediumGap: 'double', thinThickThinMediumGap: 'double',
  thinThickLargeGap: 'double', thickThinLargeGap: 'double', thinThickThinLargeGap: 'double', inset: 'solid', outset: 'solid',
};
export const borderEighths = (points: number) => Math.min(96, Math.max(2, Math.round(points * 8)));

// The CSS the canvas renders and the editor stores; `null` becomes "none", which is a real value, not an absent one.
export const cssBorder = (line: BorderLine | null): string =>
  line ? `${Number(line.width.toFixed(2))}pt ${line.style} ${line.color.toLowerCase()}` : 'none';

// Hex, short hex or rgb(); anything else is treated as black, which is what a table line is by default.
function readColor(value: string | undefined): string {
  const text = (value ?? '').trim().toLowerCase();
  const short = /^#([\da-f])([\da-f])([\da-f])$/u.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#([\da-f]{6})/u.exec(text);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/u.exec(text);
  if (rgb) return `#${rgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
}

const LENGTH = /^([\d.]+)(pt|px|in|cm|mm)?$/u;
const POINTS_PER_UNIT: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 7.2 / 2.54 };
// CSS keyword widths, as Chrome computes them.
const KEYWORD_WIDTH: Record<string, number> = { thin: 0.75, medium: 2.25, thick: 3.75 };
function readWidth(value: string | undefined): number | null {
  const text = (value ?? '').trim().toLowerCase();
  if (text in KEYWORD_WIDTH) return KEYWORD_WIDTH[text]!;
  const match = LENGTH.exec(text);
  if (!match) return null;
  const amount = Number(match[1]) * (POINTS_PER_UNIT[match[2] ?? 'px'] ?? 1);
  return Number.isFinite(amount) ? amount : null;
}

const STYLE_WORD = /\b(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)\b/u;

// `undefined` when the value is not a border at all, so an unset side keeps inheriting the table default.
export function parseCssBorder(value: unknown): BorderLine | null | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  const style = STYLE_WORD.exec(text)?.[1];
  if (text === 'none' || style === 'none' || style === 'hidden') return null;
  // rgb() carries its own spaces and commas, which must not split the value into separate words.
  const parts = text.replace(/rgba?\([^)]*\)/gu, (color) => color.replace(/[\s,]+/gu, ',')).split(/\s+/u);
  const width = parts.map(readWidth).find((part) => part !== null) ?? null;
  if (width === null && !style) return undefined;
  if (width !== null && width <= 0) return null;
  const color = parts.find((part) => part.startsWith('#') || part.startsWith('rgb'));
  const rounded = Math.min(12, Math.max(0.25, Math.round((width ?? DEFAULT_BORDER.width) * 4) / 4));
  const known = (BORDER_STYLES as readonly string[]).includes(style ?? '') ? (style as BorderStyle) : 'solid';
  return { width: rounded, style: known, color: readColor(color) };
}

// A w:tcBorders / w:tblBorders side as a border line; an absent element is `undefined`, w:val="nil"/"none" is `null`.
export function borderFromOoxml(val: string | undefined, sz: string | undefined, color: string | undefined): BorderLine | null | undefined {
  if (val === undefined) return undefined;
  if (val === 'nil' || val === 'none') return null;
  const style = CSS_STYLE[val] ?? 'solid';
  const eighths = Number(sz);
  const width = Number.isFinite(eighths) && eighths > 0 ? Math.min(12, Math.max(0.25, eighths / 8)) : DEFAULT_BORDER.width;
  const hex = color && /^[\da-f]{6}$/iu.test(color) ? `#${color.toLowerCase()}` : '#000000';
  return { width, style, color: hex };
}

export const ooxmlBorderAttrs = (line: BorderLine | null) => line
  ? { 'w:val': OOXML_STYLE[line.style], 'w:sz': borderEighths(line.width), 'w:space': 0, 'w:color': line.color.slice(1).toUpperCase() }
  : { 'w:val': 'nil' };
