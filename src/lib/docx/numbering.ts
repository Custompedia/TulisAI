import { attr, childrenNamed, firstNamed, isOn, type XmlNode } from './xml';
import { styleChain, applyParagraph, type Styles } from './styles';

export type Level = { start: number; format: string; text: string; suffix: string; isLgl: boolean; restart: boolean; pPr?: XmlNode; rPr?: XmlNode };
type Num = { abstractId: string; overrides: Map<number, { start?: number; level?: Level }> };
export type Numbering = { abstracts: Map<string, Map<number, Level>>; nums: Map<string, Num>; counters: Map<string, Array<number | null>>; used: Set<string> };
export type ListShape = { kind: 'bullet'; listStyle: 'disc' | 'circle' | 'square' } | { kind: 'ordered'; type: '1' | 'a' | 'A' | 'i' | 'I' } | { kind: 'literal' };

const ORDERED: Record<string, '1' | 'a' | 'A' | 'i' | 'I'> = { decimal: '1', lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' };
// Symbol and Wingdings bullets sit in the private-use range; these are their Unicode look-alikes.
const GLYPHS: Record<string, string> = { '': '•', '': '▪', '': '■', '': '➢', '': '❖', '': '✓', '': '☐', '': '➔', '': '-', '': '—' };
export const normalizeGlyphs = (text: string) => text.replace(/[-]/gu, (char) => GLYPHS[char] ?? '•');

const levelFrom = (node: XmlNode): Level => {
  const value = (name: string) => attr(firstNamed(node, name), 'w:val');
  return {
    start: Number(value('w:start') ?? '1') || 0, format: value('w:numFmt') ?? 'decimal', text: value('w:lvlText') ?? '', suffix: value('w:suff') ?? 'tab',
    isLgl: isOn(firstNamed(node, 'w:isLgl')), restart: value('w:lvlRestart') !== '0', pPr: firstNamed(node, 'w:pPr'), rPr: firstNamed(node, 'w:rPr'),
  };
};

export function parseNumbering(root: XmlNode | null, styles: Styles): Numbering {
  const numbering: Numbering = { abstracts: new Map(), nums: new Map(), counters: new Map(), used: new Set() };
  if (!root) return numbering;
  const container = firstNamed(root, 'w:numbering') ?? root;
  const links = new Map<string, string>();
  const styleOwners = new Map<string, string>();
  for (const abstract of childrenNamed(container, 'w:abstractNum')) {
    const id = attr(abstract, 'w:abstractNumId');
    if (!id) continue;
    const levels = new Map<number, Level>();
    for (const lvl of childrenNamed(abstract, 'w:lvl')) levels.set(Number(attr(lvl, 'w:ilvl') ?? '0'), levelFrom(lvl));
    numbering.abstracts.set(id, levels);
    const link = attr(firstNamed(abstract, 'w:numStyleLink'), 'w:val'); const owner = attr(firstNamed(abstract, 'w:styleLink'), 'w:val');
    if (link) links.set(id, link);
    if (owner) styleOwners.set(owner, id);
  }
  for (const num of childrenNamed(container, 'w:num')) {
    const id = attr(num, 'w:numId'); const abstractId = attr(firstNamed(num, 'w:abstractNumId'), 'w:val');
    if (!id || !abstractId) continue;
    const overrides = new Map<number, { start?: number; level?: Level }>();
    for (const override of childrenNamed(num, 'w:lvlOverride')) {
      const start = attr(firstNamed(override, 'w:startOverride'), 'w:val'); const lvl = firstNamed(override, 'w:lvl');
      overrides.set(Number(attr(override, 'w:ilvl') ?? '0'), { ...(start !== undefined ? { start: Number(start) || 0 } : {}), ...(lvl ? { level: levelFrom(lvl) } : {}) });
    }
    numbering.nums.set(id, { abstractId, overrides });
  }
  // A numStyleLink abstract is a pointer: its levels live in the abstract that owns the numbering style.
  for (const [id, styleId] of links) {
    let target = styleOwners.get(styleId);
    if (!target) {
      let props = {};
      for (const style of styleChain(styles, styleId)) props = applyParagraph(props, style.pPr);
      const numId = (props as { numId?: string }).numId;
      target = numId ? numbering.nums.get(numId)?.abstractId : undefined;
    }
    const levels = target && target !== id ? numbering.abstracts.get(target) : undefined;
    if (levels) numbering.abstracts.set(id, levels);
  }
  return numbering;
}

export function levelOf(numbering: Numbering, numId: string, ilvl: number): Level | null {
  const num = numbering.nums.get(numId);
  if (!num) return null;
  return num.overrides.get(ilvl)?.level ?? numbering.abstracts.get(num.abstractId)?.get(ilvl) ?? null;
}

export function listShape(level: Level, ilvl: number): ListShape {
  if (level.format === 'bullet') {
    const glyph = normalizeGlyphs(level.text).trim();
    return { kind: 'bullet', listStyle: /^[o◦○]$/u.test(glyph) ? 'circle' : /^[▪■□§]$/u.test(glyph) ? 'square' : 'disc' };
  }
  const type = ORDERED[level.format];
  return type && new RegExp(`^%${ilvl + 1}[.)]?$`, 'u').test(level.text.trim()) ? { kind: 'ordered', type } : { kind: 'literal' };
}

const ROMAN: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (value: number) => { let rest = Math.min(value, 3999); let out = ''; for (const [size, glyph] of ROMAN) while (rest >= size) { out += glyph; rest -= size; } return out; };
// Word repeats the letter past Z: 27 is AA, 28 is BB.
const letter = (value: number) => value < 1 ? '' : String.fromCharCode(65 + ((value - 1) % 26)).repeat(Math.floor((value - 1) / 26) + 1);

export function formatNumber(value: number, format: string): string {
  switch (format) {
    case 'upperRoman': return roman(value);
    case 'lowerRoman': return roman(value).toLowerCase();
    case 'upperLetter': return letter(value);
    case 'lowerLetter': return letter(value).toLowerCase();
    case 'decimalZero': return value < 10 ? `0${value}` : String(value);
    case 'none': return '';
    default: return String(value);
  }
}

const startOf = (numbering: Numbering, numId: string, ilvl: number) => numbering.nums.get(numId)?.overrides.get(ilvl)?.start ?? levelOf(numbering, numId, ilvl)?.start ?? 1;

// Advances the counters for one numbered paragraph; lists sharing an abstract definition continue each other, as in Word.
export function advance(numbering: Numbering, numId: string, ilvl: number): { level: Level; value: number; label: string } | null {
  const num = numbering.nums.get(numId); const level = levelOf(numbering, numId, ilvl);
  if (!num || !level) return null;
  const counters = numbering.counters.get(num.abstractId) ?? Array<number | null>(9).fill(null);
  numbering.counters.set(num.abstractId, counters);
  if (!numbering.used.has(numId)) {
    numbering.used.add(numId);
    for (const [index, override] of num.overrides) if (override.start !== undefined && index < 9) counters[index] = null;
  }
  const value = (counters[ilvl] ?? startOf(numbering, numId, ilvl) - 1) + 1;
  counters[ilvl] = value;
  for (let deeper = ilvl + 1; deeper < 9; deeper++) if (levelOf(numbering, numId, deeper)?.restart !== false) counters[deeper] = null;
  const label = level.format === 'bullet' ? normalizeGlyphs(level.text) : level.text.replace(/%([1-9])/gu, (_, digit: string) => {
    const index = Number(digit) - 1;
    const other = levelOf(numbering, numId, index);
    return formatNumber(counters[index] ?? startOf(numbering, numId, index), level.isLgl ? 'decimal' : other?.format ?? 'decimal');
  });
  return { level, value, label };
}
