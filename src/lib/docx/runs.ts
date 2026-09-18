import type { EditorNode } from '../editor/document';
import { fontStack } from './office-defaults';
import { formatNumber, normalizeGlyphs } from './numbering';
import { applyRun, characterStyleProps, type RunProps, type Styles } from './styles';
import { attr, firstNamed, type XmlNode } from './xml';

type Mark = NonNullable<EditorNode['marks']>[number];
// What the canvas already renders for a block, so only real differences become marks.
export type Baseline = { font: string; size: number; color: string; bold: boolean; italic: boolean };
type Field = { phase: 'instr' | 'result'; instr: string; link?: string };
export type NoteKind = 'footnote' | 'endnote';
export type RunContext = {
  styles: Styles; relationships: Map<string, string>; fields: Field[];
  notes: Array<{ kind: NoteKind; id: string; number: number }>; noteCounts: Record<NoteKind, number>;
  currentNote?: { kind: NoteKind; number: number }; textBoxes: XmlNode[];
};
export const PAGE_BREAK: EditorNode = { type: 'pageBreak' };
export type Inlines = { nodes: EditorNode[]; firstFont?: string };

const LINK_COLOR = '0563C1';
const HTTP_LINK = /^https?:\/\/[^\s"<>]+$/iu;
const noteLabel = (kind: NoteKind, number: number) => kind === 'endnote' ? formatNumber(number, 'lowerRoman') : String(number);

export function marksFor(props: RunProps, baseline: Baseline, link?: string, force: Partial<RunProps> = {}): Mark[] {
  const run = { ...props, ...force };
  const marks: Mark[] = [];
  if (link) marks.push({ type: 'link', attrs: { href: link } });
  if (run.bold && !baseline.bold) marks.push({ type: 'bold' });
  if (run.italic && !baseline.italic) marks.push({ type: 'italic' });
  // The canvas already draws links blue and underlined, which is all Word's Hyperlink style adds.
  if (run.underline && !link) marks.push({ type: 'underline' });
  if (run.strike) marks.push({ type: 'strike' });
  if (run.vert === 'sup') marks.push({ type: 'superscript' });
  if (run.vert === 'sub') marks.push({ type: 'subscript' });
  if (run.highlight) marks.push({ type: 'highlight', attrs: { color: `#${run.highlight}` } });
  const style: Record<string, string> = {};
  if (run.font && run.font.toLowerCase() !== baseline.font.toLowerCase()) style.fontFamily = fontStack(run.font);
  if (run.size && Math.abs(run.size - baseline.size) > 0.01) style.fontSize = `${run.size}pt`;
  if ((run.color ?? '000000') !== baseline.color && !(link && run.color === LINK_COLOR)) style.color = `#${run.color ?? '000000'}`;
  if (Object.keys(style).length) marks.push({ type: 'textStyle', attrs: style });
  return marks;
}

// Adjacent runs with the same formatting become one text node; Word splits runs freely (spell check, revisions).
export function pushText(nodes: EditorNode[], text: string, marks: Mark[]) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  const key = JSON.stringify(marks);
  if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === key) { last.text = `${last.text ?? ''}${text}`; return; }
  nodes.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
}

const SYMBOL_LETTERS = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const SYMBOL_SMALL = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
const SYMBOL_EXTRA: Record<number, string> = { 0xa3: '≤', 0xb3: '≥', 0xb1: '±', 0xb4: '×', 0xb8: '÷', 0xb0: '°', 0xb9: '≠', 0xbb: '≈', 0xae: '→', 0xac: '←', 0xad: '↑', 0xaf: '↓', 0xd6: '√', 0xa5: '∞', 0xb6: '∂', 0xe5: '∑', 0xd5: '∏', 0xf2: '∫', 0xb7: '•', 0xa2: '′', 0xb2: '″', 0xce: '∈', 0xc7: '∩', 0xc8: '∪', 0xde: '⇒', 0xdb: '⇔', 0x22: '∀', 0x24: '∃', 0xd1: '∇', 0xbc: '…' };
const WINGDINGS: Record<number, string> = { 0xa8: '☐', 0xfe: '☒', 0xfd: '☒', 0xfc: '✓', 0xfb: '✗', 0x9f: '•', 0xa7: '▪', 0x6e: '■', 0xd8: '➢', 0xe0: '➔', 0x76: '❖', 0x4a: '☺' };
// w:sym points into a symbol font; the common Symbol and Wingdings glyphs map to real Unicode.
export function symbolChar(font: string | undefined, code: number): string {
  const byte = code >= 0xf000 ? code - 0xf000 : code;
  const name = (font ?? '').toLowerCase();
  if (name === 'symbol') {
    if (byte >= 0x41 && byte <= 0x5a) return SYMBOL_LETTERS[byte - 0x41] ?? '';
    if (byte >= 0x61 && byte <= 0x7a) return SYMBOL_SMALL[byte - 0x61] ?? '';
    return SYMBOL_EXTRA[byte] ?? (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '');
  }
  if (name.startsWith('wingdings')) return WINGDINGS[byte] ?? '';
  return code >= 0xf000 ? normalizeGlyphs(String.fromCharCode(code)) : String.fromCodePoint(code);
}

// Office Math as linear text, so an equation keeps its content instead of vanishing.
export function mathText(node: XmlNode): string {
  const part = (name: string) => { const child = firstNamed(node, name); return child ? mathText(child) : ''; };
  const group = (value: string) => value.length > 1 ? `(${value})` : value;
  switch (node.name) {
    case 'm:t': return node.text;
    case 'm:f': return `${group(part('m:num'))}/${group(part('m:den'))}`;
    case 'm:sSup': return `${part('m:e')}^${group(part('m:sup'))}`;
    case 'm:sSub': return `${part('m:e')}_${group(part('m:sub'))}`;
    case 'm:sSubSup': return `${part('m:e')}_${group(part('m:sub'))}^${group(part('m:sup'))}`;
    case 'm:rad': return `${part('m:deg')}√${group(part('m:e'))}`;
    case 'm:d': {
      const props = firstNamed(node, 'm:dPr');
      const chr = (name: string, fallback: string) => { const value = props && attr(firstNamed(props, name), 'm:val'); return value ?? fallback; };
      return `${chr('m:begChr', '(')}${node.children.filter((child) => child.name === 'm:e').map(mathText).join(chr('m:sepChr', '|'))}${chr('m:endChr', ')')}`;
    }
    case 'm:nary': {
      const props = firstNamed(node, 'm:naryPr'); const sub = part('m:sub'); const sup = part('m:sup');
      return `${(props && attr(firstNamed(props, 'm:chr'), 'm:val')) ?? '∫'}${sub ? `_${group(sub)}` : ''}${sup ? `^${group(sup)}` : ''} ${part('m:e')}`;
    }
    default: return node.name.endsWith('Pr') ? '' : node.children.map(mathText).join('');
  }
}

// Text boxes live inside drawings; mc:AlternateContent carries the same box twice, so only one branch is read.
export function collectTextBoxes(node: XmlNode, out: XmlNode[]) {
  if (node.name === 'w:txbxContent') { out.push(node); return; }
  if (node.name === 'mc:AlternateContent') { const branch = firstNamed(node, 'mc:Choice') ?? firstNamed(node, 'mc:Fallback'); if (branch) collectTextBoxes(branch, out); return; }
  for (const child of node.children) collectTextBoxes(child, out);
}

const fieldLink = (instr: string) => { const match = /^\s*HYPERLINK\s+"([^"]+)"/iu.exec(instr); return match && HTTP_LINK.test(match[1]!) ? match[1] : undefined; };

export function inlinesFrom(paragraph: XmlNode, paraRun: RunProps, baseline: Baseline, context: RunContext): Inlines {
  const result: Inlines = { nodes: [] };
  const inInstructions = () => context.fields.some((field) => field.phase === 'instr');
  const activeLink = () => { for (let index = context.fields.length - 1; index >= 0; index--) if (context.fields[index]!.link) return context.fields[index]!.link; return undefined; };

  const text = (value: string, props: RunProps, link: string | undefined, force: Partial<RunProps> = {}) => {
    if (!value || props.vanish) return;
    if (result.firstFont === undefined) result.firstFont = props.font;
    pushText(result.nodes, props.caps ? value.toUpperCase() : value, marksFor(props, baseline, link ?? activeLink(), force));
  };

  const run = (node: XmlNode, link: string | undefined) => {
    const direct = firstNamed(node, 'w:rPr');
    const props = applyRun(characterStyleProps(context.styles, attr(firstNamed(direct ?? node, 'w:rStyle'), 'w:val') ?? context.styles.defaultCharacter, paraRun), direct, context.styles.theme);
    for (const piece of node.children) {
      if (piece.name === 'w:fldChar') {
        const type = attr(piece, 'w:fldCharType');
        if (type === 'begin') context.fields.push({ phase: 'instr', instr: '' });
        else if (type === 'separate') { const field = context.fields[context.fields.length - 1]; if (field) { field.phase = 'result'; field.link = fieldLink(field.instr); } }
        else if (type === 'end') context.fields.pop();
        continue;
      }
      if (piece.name === 'w:instrText') { const field = context.fields[context.fields.length - 1]; if (field && field.instr.length < 2000) field.instr += piece.text; continue; }
      if (inInstructions()) continue;
      switch (piece.name) {
        case 'w:t': text(piece.text, props, link); break;
        case 'w:tab': case 'w:ptab': text('\t', props, link); break;
        case 'w:br': {
          const type = attr(piece, 'w:type');
          if (type === 'page') result.nodes.push(PAGE_BREAK); else if (!props.vanish) result.nodes.push({ type: 'hardBreak' });
          break;
        }
        case 'w:cr': if (!props.vanish) result.nodes.push({ type: 'hardBreak' }); break;
        case 'w:sym': { const code = parseInt(attr(piece, 'w:char') ?? '', 16); if (Number.isFinite(code)) text(symbolChar(attr(piece, 'w:font'), code), props, link); break; }
        case 'w:softHyphen': text('­', props, link); break;
        case 'w:noBreakHyphen': text('‑', props, link); break;
        case 'w:footnoteReference': case 'w:endnoteReference': {
          const kind: NoteKind = piece.name === 'w:footnoteReference' ? 'footnote' : 'endnote';
          const id = attr(piece, 'w:id');
          if (!id) break;
          const existing = context.notes.find((note) => note.kind === kind && note.id === id);
          const number = existing?.number ?? ++context.noteCounts[kind];
          if (!existing) context.notes.push({ kind, id, number });
          if (attr(piece, 'w:customMarkFollows') !== '1' && attr(piece, 'w:customMarkFollows') !== 'true') text(noteLabel(kind, number), props, link, { vert: 'sup' });
          break;
        }
        case 'w:footnoteRef': case 'w:endnoteRef': if (context.currentNote) text(noteLabel(context.currentNote.kind, context.currentNote.number), props, link, { vert: 'sup' }); break;
        case 'w:drawing': case 'w:pict': case 'w:object': case 'mc:AlternateContent': collectTextBoxes(piece, context.textBoxes); break;
        default: break;
      }
    }
  };

  const walk = (node: XmlNode, link: string | undefined) => {
    for (const child of node.children) {
      switch (child.name) {
        case 'w:r': run(child, link); break;
        case 'w:hyperlink': {
          const id = attr(child, 'r:id'); const target = id ? context.relationships.get(id) : undefined;
          walk(child, target && HTTP_LINK.test(target) ? target : link);
          break;
        }
        case 'w:fldSimple': { const target = fieldLink(attr(child, 'w:instr') ?? ''); walk(child, target ?? link); break; }
        case 'w:sdt': { const content = firstNamed(child, 'w:sdtContent'); if (content) walk(content, link); break; }
        case 'w:ins': case 'w:moveTo': case 'w:smartTag': case 'w:customXml': case 'w:dir': case 'w:bdo': case 'w:sdtContent': walk(child, link); break;
        case 'mc:AlternateContent': collectTextBoxes(child, context.textBoxes); break;
        case 'm:oMath': case 'm:oMathPara': if (!inInstructions()) text(mathText(child), paraRun, link); break;
        default: break;
      }
    }
  };
  walk(paragraph, undefined);
  return result;
}
