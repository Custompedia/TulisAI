import { HIGHLIGHT_COLORS } from './office-defaults';
import { attr, childrenNamed, findDeep, firstNamed, isOn, type XmlNode } from './xml';

// Resolved character formatting; sizes in points, colours as 6-digit hex without '#'.
export type RunProps = {
  font?: string; size?: number; color?: string; highlight?: string;
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; caps?: boolean; vanish?: boolean;
  vert?: 'sup' | 'sub' | null;
};
// Resolved paragraph formatting; lengths in twips, firstLine negative for a hanging indent.
export type ParaProps = {
  align?: string; before?: number; after?: number; line?: number; lineRule?: string;
  left?: number; right?: number; firstLine?: number; contextual?: boolean; pageBreakBefore?: boolean;
  numId?: string; ilvl?: number; outline?: number; tabs?: Array<{ pos: number; val: string }>;
};

type Style = { id: string; type: string; name: string; basedOn?: string; link?: string; pPr?: XmlNode; rPr?: XmlNode; node: XmlNode };
export type Theme = { major: string; minor: string };
export type Styles = { byId: Map<string, Style>; defaultParagraph?: string; defaultCharacter?: string; runDefaults?: XmlNode; paraDefaults?: XmlNode; theme: Theme };

// Office 2013+ theme fonts, used when the package carries no theme part.
const DEFAULT_THEME: Theme = { major: 'Calibri Light', minor: 'Calibri' };

export function parseTheme(root: XmlNode | null): Theme {
  if (!root) return DEFAULT_THEME;
  const typeface = (name: string) => { const font = findDeep(root, name); const latin = font && firstNamed(font, 'a:latin'); return attr(latin, 'typeface') || undefined; };
  return { major: typeface('a:majorFont') ?? DEFAULT_THEME.major, minor: typeface('a:minorFont') ?? DEFAULT_THEME.minor };
}

export function parseStyles(root: XmlNode | null, theme: Theme): Styles {
  const styles: Styles = { byId: new Map(), theme };
  if (!root) return styles;
  const container = firstNamed(root, 'w:styles') ?? root;
  const defaults = firstNamed(container, 'w:docDefaults');
  if (defaults) {
    styles.runDefaults = firstNamed(firstNamed(defaults, 'w:rPrDefault') ?? defaults, 'w:rPr');
    styles.paraDefaults = firstNamed(firstNamed(defaults, 'w:pPrDefault') ?? defaults, 'w:pPr');
  }
  for (const node of childrenNamed(container, 'w:style')) {
    const id = attr(node, 'w:styleId'); const type = attr(node, 'w:type') ?? 'paragraph';
    if (!id) continue;
    styles.byId.set(id, { id, type, node, name: (attr(firstNamed(node, 'w:name'), 'w:val') ?? id).trim(), basedOn: attr(firstNamed(node, 'w:basedOn'), 'w:val'), link: attr(firstNamed(node, 'w:link'), 'w:val'), pPr: firstNamed(node, 'w:pPr'), rPr: firstNamed(node, 'w:rPr') });
    if (ON.has(attr(node, 'w:default') ?? '')) {
      if (type === 'paragraph' && !styles.defaultParagraph) styles.defaultParagraph = id;
      if (type === 'character' && !styles.defaultCharacter) styles.defaultCharacter = id;
    }
  }
  return styles;
}

// Base-first chain of a style; the depth cap stops a basedOn cycle.
export function styleChain(styles: Styles, id: string | undefined): Style[] {
  const chain: Style[] = [];
  for (let current = id ? styles.byId.get(id) : undefined; current && chain.length < 20 && !chain.includes(current); current = current.basedOn ? styles.byId.get(current.basedOn) : undefined) chain.unshift(current);
  return chain;
}

// A run may name a paragraph style; Word then uses that style's linked character style.
export function characterChain(styles: Styles, id: string | undefined): Style[] {
  const style = id ? styles.byId.get(id) : undefined;
  if (style?.type === 'paragraph') return style.link ? styleChain(styles, style.link) : [];
  return styleChain(styles, id);
}

const numberAttr = (node: XmlNode | undefined, name: string): number | undefined => {
  const value = attr(node, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const ON = new Set(['1', 'true', 'on']);
const hex = (value: string | undefined): string | undefined => value && /^[\da-f]{6}$/iu.test(value) ? value.toUpperCase() : undefined;

export function applyRun(base: RunProps, rPr: XmlNode | undefined, theme: Theme): RunProps {
  if (!rPr) return base;
  const next: RunProps = { ...base };
  for (const child of rPr.children) {
    switch (child.name) {
      case 'w:rFonts': {
        const themed = attr(child, 'w:asciiTheme') ?? attr(child, 'w:hAnsiTheme');
        const font = themed ? (themed.startsWith('major') ? theme.major : theme.minor) : attr(child, 'w:ascii') ?? attr(child, 'w:hAnsi');
        if (font) next.font = font;
        break;
      }
      case 'w:sz': { const size = numberAttr(child, 'w:val'); if (size && size > 0) next.size = size / 2; break; }
      case 'w:color': { const value = attr(child, 'w:val'); if (value === 'auto') delete next.color; else if (hex(value)) next.color = hex(value); break; }
      case 'w:highlight': { const value = attr(child, 'w:val'); if (value && HIGHLIGHT_COLORS[value]) next.highlight = HIGHLIGHT_COLORS[value]; else if (value === 'none') delete next.highlight; break; }
      case 'w:shd': { const fill = hex(attr(child, 'w:fill')); if (fill && fill !== 'FFFFFF' && !next.highlight) next.highlight = fill; break; }
      case 'w:b': next.bold = isOn(child); break;
      case 'w:i': next.italic = isOn(child); break;
      case 'w:u': next.underline = isOn(child); break;
      case 'w:strike': case 'w:dstrike': next.strike = isOn(child); break;
      case 'w:caps': case 'w:smallCaps': next.caps = isOn(child); break;
      case 'w:vanish': next.vanish = isOn(child); break;
      case 'w:vertAlign': { const value = attr(child, 'w:val'); next.vert = value === 'superscript' ? 'sup' : value === 'subscript' ? 'sub' : null; break; }
      default: break;
    }
  }
  return next;
}

export function applyParagraph(base: ParaProps, pPr: XmlNode | undefined): ParaProps {
  if (!pPr) return base;
  const next: ParaProps = { ...base };
  for (const child of pPr.children) {
    switch (child.name) {
      case 'w:jc': { const value = attr(child, 'w:val'); if (value) next.align = value; break; }
      case 'w:spacing': {
        // HTML-style automatic spacing is 14 pt in Word.
        next.before = ON.has(attr(child, 'w:beforeAutospacing') ?? '') ? 280 : numberAttr(child, 'w:before') ?? next.before;
        next.after = ON.has(attr(child, 'w:afterAutospacing') ?? '') ? 280 : numberAttr(child, 'w:after') ?? next.after;
        const line = numberAttr(child, 'w:line');
        if (line !== undefined && line > 0) { next.line = line; next.lineRule = attr(child, 'w:lineRule') ?? 'auto'; }
        break;
      }
      case 'w:ind': {
        next.left = numberAttr(child, 'w:start') ?? numberAttr(child, 'w:left') ?? next.left;
        next.right = numberAttr(child, 'w:end') ?? numberAttr(child, 'w:right') ?? next.right;
        const hanging = numberAttr(child, 'w:hanging'); const first = numberAttr(child, 'w:firstLine');
        if (hanging !== undefined) next.firstLine = -hanging; else if (first !== undefined) next.firstLine = first;
        break;
      }
      case 'w:tabs': {
        const stops = childrenNamed(child, 'w:tab').map((tab) => ({ pos: numberAttr(tab, 'w:pos') ?? 0, val: attr(tab, 'w:val') ?? 'left' }));
        const kept = stops.filter((stop) => stop.pos > 0 && ['left', 'center', 'right', 'decimal'].includes(stop.val));
        // A "clear" stop wipes what the style set, which is how Word removes an inherited stop.
        next.tabs = stops.some((stop) => stop.val === 'clear') ? kept : [...(next.tabs ?? []), ...kept];
        break;
      }
      case 'w:contextualSpacing': next.contextual = isOn(child); break;
      case 'w:pageBreakBefore': next.pageBreakBefore = isOn(child); break;
      case 'w:outlineLvl': next.outline = numberAttr(child, 'w:val'); break;
      case 'w:numPr': {
        const numId = attr(firstNamed(child, 'w:numId'), 'w:val'); const ilvl = numberAttr(firstNamed(child, 'w:ilvl'), 'w:val');
        if (numId !== undefined) next.numId = numId;
        if (ilvl !== undefined) next.ilvl = ilvl;
        break;
      }
      default: break;
    }
  }
  return next;
}

// Word's defaults when docDefaults says nothing: Times New Roman 10 pt, single spacing, no space after.
const ROOT_RUN: RunProps = { font: 'Times New Roman', size: 10 };
const ROOT_PARA: ParaProps = { before: 0, after: 0, line: 240, lineRule: 'auto', left: 0, right: 0, firstLine: 0 };

export const defaultRun = (styles: Styles) => applyRun(ROOT_RUN, styles.runDefaults, styles.theme);
export const defaultParagraph = (styles: Styles) => applyParagraph(ROOT_PARA, styles.paraDefaults);

export const paragraphStyleProps = (styles: Styles, id: string | undefined, run: RunProps, para: ParaProps) => {
  for (const style of styleChain(styles, id)) { run = applyRun(run, style.rPr, styles.theme); para = applyParagraph(para, style.pPr); }
  return { run, para };
};

export function characterStyleProps(styles: Styles, id: string | undefined, run: RunProps): RunProps {
  for (const style of characterChain(styles, id)) run = applyRun(run, style.rPr, styles.theme);
  return run;
}

// Built-in names are stored in English whatever the UI language, so "heading 1" identifies Judul 1 too.
const HEADING_NAME = /^heading\s*([1-6])$/iu;
export function headingLevel(styles: Styles, id: string | undefined, para: ParaProps): number | null {
  for (const style of styleChain(styles, id).reverse()) {
    const named = HEADING_NAME.exec(style.name) ?? HEADING_NAME.exec(style.id);
    if (named) return Number(named[1]);
    if (/^title$/iu.test(style.name)) return 1;
    if (/^subtitle$/iu.test(style.name)) return 2;
  }
  return para.outline !== undefined && para.outline >= 0 && para.outline <= 5 ? para.outline + 1 : null;
}
