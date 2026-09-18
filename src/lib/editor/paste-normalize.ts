import { Fragment, Slice, type ResolvedPos } from '@tiptap/pm/model';
import { safeLength } from './extensions/paragraph-format';

// Google Docs, Word and web pages each encode formatting differently (styled spans, mso-list paragraphs, class
// stylesheets). This rewrites any pasted HTML into the plain tags and inline styles the schema's parse rules read,
// so a paste keeps its fonts, spacing, lists and tables instead of whatever ProseMirror happens to recognise.

type Decls = Map<string, string>;

export const OWN_CLIPBOARD_ATTRIBUTE = 'data-ww-clipboard';
export const OWN_STYLE_ATTRIBUTE = 'data-ww-style';
export const TASK_GLYPH_ATTRIBUTE = 'data-ww-task';

const ELEMENT = 1, TEXT = 3, COMMENT = 8;
const REMOVED = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'IMG', 'PICTURE', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'HEAD', 'FRAME', 'FRAMESET', 'APPLET', 'BASE', 'MATH', 'SOURCE', 'TRACK', 'MAP', 'AREA', 'XML', 'O:P']);
const ALLOWED_ATTRIBUTES = new Set(['href', 'style', 'colspan', 'rowspan', 'colwidth', 'start', 'type', 'data-type', 'data-checked', 'data-color', 'data-page-break']);
const TEXT_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const INLINE = new Set(['SPAN', 'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'INS', 'SUP', 'SUB', 'MARK', 'SMALL', 'BIG', 'FONT', 'CITE', 'Q', 'ABBR', 'CODE']);
const INHERITED = ['font-family', 'font-size', 'color', 'font-weight', 'font-style'];
const PAGE_BREAK = /page-break-(?:before|after):\s*always|break-(?:before|after):\s*page/iu;
const BULLETS = new Set(['disc', 'circle', 'square']);
const OL_TYPES: Record<string, string> = { 'lower-alpha': 'a', 'lower-latin': 'a', 'upper-alpha': 'A', 'upper-latin': 'A', 'lower-roman': 'i', 'upper-roman': 'I' };
const NOT_COLORS = new Set(['windowtext', 'window', 'auto', 'inherit', 'initial', 'unset', 'revert', 'transparent', 'currentcolor', 'none', 'buttonface', 'buttontext', 'normal']);

// Splits a style attribute on semicolons outside quotes and parentheses; shorthands the schema reads are expanded.
export function parseStyle(text: string | null | undefined): Decls {
  const decls: Decls = new Map();
  if (!text) return decls;
  const add = (part: string) => {
    const colon = part.indexOf(':');
    if (colon < 1) return;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim().replace(/\s*!important$/iu, '');
    if (!name || !value) return;
    if (name === 'margin') {
      const [top = value, right = top, bottom = top, left = right] = value.split(/\s+/u);
      decls.set('margin-top', top); decls.set('margin-right', right); decls.set('margin-bottom', bottom); decls.set('margin-left', left);
    } else if (name === 'background') {
      const color = value.split(/\s+(?![^(]*\))/u).map(cleanColor).find(Boolean);
      if (color) decls.set('background-color', color);
    } else decls.set(name, value);
  };
  let quote = '', depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === '\'') quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ';' && depth <= 0) { add(text.slice(start, index)); start = index + 1; }
  }
  add(text.slice(start));
  return decls;
}

const writeStyle = (decls: Decls) => [...decls].map(([name, value]) => `${name}:${value}`).join(';');
const setStyle = (element: HTMLElement, decls: Decls) => { if (decls.size) element.setAttribute('style', writeStyle(decls)); else element.removeAttribute('style'); };
const styleOf = (element: HTMLElement) => parseStyle(element.getAttribute('style'));

export function cleanColor(value: string | undefined): string | null {
  const color = value?.trim();
  if (!color) return null;
  if (/^#[\da-f]{3,8}$/iu.test(color)) return color;
  if (/^rgba?\([\d\s.,%]+\)$/iu.test(color)) return /^rgba\(.*,\s*0(?:\.0*)?\s*\)$/iu.test(color) ? null : color.replace(/\s+/gu, '');
  if (/^[a-z]+$/iu.test(color) && !NOT_COLORS.has(color.toLowerCase())) return color.toLowerCase();
  return null;
}

// Keeps the first family only, unquoted, as the font picker stores it.
export function cleanFontFamily(value: string | undefined): string | null {
  const first = value?.split(',')[0]?.trim().replace(/^["']|["']$/gu, '').trim();
  return first && /^[\p{L}\p{N} _.-]+$/u.test(first) ? first : null;
}

const cleanNumber = (value: string | undefined, units: RegExp) => {
  const match = value?.trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/iu);
  return match && units.test(match[2]!) ? `${Number(match[1])}${match[2]!.toLowerCase()}` : null;
};
export const cleanFontSize = (value: string | undefined) => cleanNumber(value, /^(?:pt|px|em|rem|%)$/iu);

function toPx(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^(\d*\.?\d+)(px|pt|in|cm|mm)?$/iu);
  if (!match) return null;
  const factor = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 }[(match[2] ?? 'px').toLowerCase() as 'px'];
  const px = Math.round(Number(match[1]) * factor);
  return px > 0 ? px : null;
}

const children = (node: Node) => Array.from(node.childNodes);
const elements = (root: Document | HTMLElement, selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
// DOM mutations go through Node methods: the worker typings shadow Element.before/after/append/replaceWith.
const remove = (node: Node | null | undefined) => { node?.parentNode?.removeChild(node); };
const insertBefore = (node: Node, reference: Node) => { reference.parentNode?.insertBefore(node, reference); };
const insertAfter = (node: Node, reference: Node) => { reference.parentNode?.insertBefore(node, reference.nextSibling); };
const appendAll = (parent: Node, nodes: Node[]) => { for (const node of nodes) parent.appendChild(node); };
const replaceWith = (node: Node, nodes: Node[]) => { for (const next of nodes) insertBefore(next, node); remove(node); };
const childElements = (element: HTMLElement) => Array.from(element.children) as HTMLElement[];
function unwrap(element: HTMLElement) { replaceWith(element, children(element)); }
function rename(element: HTMLElement, tag: string): HTMLElement {
  const next = element.ownerDocument.createElement(tag);
  for (const attribute of Array.from(element.attributes)) next.setAttribute(attribute.name, attribute.value);
  appendAll(next, children(element)); replaceWith(element, [next]); return next;
}
function comments(root: Node): Node[] {
  const found: Node[] = [];
  const walk = (node: Node) => { for (const child of children(node)) { if (child.nodeType === COMMENT) found.push(child); else if (child.nodeType === ELEMENT) walk(child); } };
  walk(root); return found;
}

// Word describes Normal, List Paragraph and heading spacing in a <style> block; only simple tag/class rules apply.
function applyClassStyles(document: Document) {
  const css = elements(document, 'style').map((style) => style.textContent ?? '').join('\n').replace(/<!--|-->/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/@[^{]+\{[^{}]*\}/gu, '');
  const rules: Array<{ tag: string; cls: string; decls: string }> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    for (const selector of match[1]!.split(',')) {
      const parts = selector.trim().match(/^([a-z][a-z\d]*)?(?:\.([\w-]+))?$/iu);
      if (parts && (parts[1] || parts[2])) rules.push({ tag: (parts[1] ?? '').toUpperCase(), cls: parts[2] ?? '', decls: match[2]! });
    }
  }
  if (!rules.length) return;
  const ordered = [...rules.filter((rule) => !rule.cls), ...rules.filter((rule) => rule.cls)];
  for (const element of elements(document.body, '*')) {
    const matched = ordered.filter((rule) => (!rule.tag || rule.tag === element.tagName) && (!rule.cls || element.classList.contains(rule.cls)));
    if (matched.length) element.setAttribute('style', [...matched.map((rule) => rule.decls), element.getAttribute('style') ?? ''].join(';'));
  }
}

type ListKind = { ordered: boolean; type: string | null; start: number | null; bullet: string | null };
type ListItem = ListKind & { li: HTMLElement; level: number };

const romanValue = (value: string) => {
  const digits: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  return [...value.toLowerCase()].reduce((total, char, index, all) => { const current = digits[char]!; const next = digits[all[index + 1] ?? ''] ?? 0; return total + (current < next ? -current : current); }, 0);
};

// Word writes the list marker as literal text ("1.", "a)", "·", "o", "§"); its shape decides the list type.
export function markerKind(marker: string): ListKind {
  const numbered = /[.)]$/u.test(marker) || /^\(/u.test(marker);
  const core = marker.replace(/^\(/u, '').replace(/[.)]+$/u, '');
  if (/^\d+(?:\.\d+)*$/u.test(core)) return { ordered: true, type: '1', start: Number(core.split('.').at(-1)), bullet: null };
  if (numbered && /^(?:[ivxlcdm]{2,}|i)$/u.test(core)) return { ordered: true, type: 'i', start: romanValue(core), bullet: null };
  if (numbered && /^(?:[IVXLCDM]{2,}|I)$/u.test(core)) return { ordered: true, type: 'I', start: romanValue(core), bullet: null };
  if (numbered && /^[a-z]$/u.test(core)) return { ordered: true, type: 'a', start: core.charCodeAt(0) - 96, bullet: null };
  if (numbered && /^[A-Z]$/u.test(core)) return { ordered: true, type: 'A', start: core.charCodeAt(0) - 64, bullet: null };
  if (marker === 'o' || marker === '◦' || marker === '○') return { ordered: false, type: null, start: null, bullet: 'circle' };
  if (/^[§▪■]$/u.test(marker)) return { ordered: false, type: null, start: null, bullet: 'square' };
  return { ordered: false, type: null, start: null, bullet: 'disc' };
}

// Rebuilds nesting from flat (level, item) pairs, as Word paragraphs and flattened Docs lists arrive.
function buildLists(document: Document, items: ListItem[]): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const stack: Array<{ level: number; ordered: boolean; list: HTMLElement }> = [];
  for (const item of items) {
    while (stack.length && (stack.at(-1)!.level > item.level || (stack.at(-1)!.level === item.level && stack.at(-1)!.ordered !== item.ordered))) stack.pop();
    let top = stack.at(-1);
    if (!top || top.level < item.level) {
      const list = document.createElement(item.ordered ? 'ol' : 'ul');
      if (item.ordered && item.type && item.type !== '1') list.setAttribute('type', item.type);
      if (item.ordered && item.start && item.start !== 1) list.setAttribute('start', String(item.start));
      if (!item.ordered && item.bullet) list.setAttribute('style', `list-style-type:${item.bullet}`);
      if (top) (top.list.lastElementChild ?? top.list.appendChild(document.createElement('li'))).appendChild(list);
      else roots.push(list);
      top = { level: item.level, ordered: item.ordered, list }; stack.push(top);
    }
    top.list.appendChild(item.li);
  }
  return roots;
}

function takeWordMarker(paragraph: HTMLElement): string {
  let marker = '';
  for (const comment of comments(paragraph)) {
    if (!comment.isConnected || !/\[if !supportLists\]/iu.test(comment.nodeValue ?? '')) continue;
    let node = comment.nextSibling;
    while (node && !(node.nodeType === COMMENT && /\[endif\]/iu.test(node.nodeValue ?? ''))) { const next = node.nextSibling; marker += node.textContent ?? ''; remove(node); node = next; }
    remove(node); remove(comment);
  }
  if (!marker) {
    const ignored = elements(paragraph, '[style]').find((element) => /^ignore$/iu.test(styleOf(element).get('mso-list') ?? ''));
    if (ignored) {
      marker = ignored.textContent ?? '';
      let parent = ignored.parentElement; remove(ignored);
      while (parent && parent !== paragraph && !parent.textContent?.trim()) { const next = parent.parentElement; remove(parent); parent = next; }
    }
  }
  return marker.replace(/[\s ]+/gu, ' ').trim();
}

const wordLevel = (element: HTMLElement) => {
  if (element.tagName !== 'P') return 0;
  const match = styleOf(element).get('mso-list')?.match(/level(\d+)/iu);
  return match ? Number(match[1]) : 0;
};

// Word pastes lists as indented paragraphs with a typed marker; turn each run of them into real nested lists.
function convertWordLists(document: Document) {
  const paragraphs = elements(document.body, 'p').filter(wordLevel);
  for (let index = 0; index < paragraphs.length;) {
    const group = [paragraphs[index]!];
    while (index + 1 < paragraphs.length && group.at(-1)!.nextElementSibling === paragraphs[index + 1]) group.push(paragraphs[++index]!);
    index++;
    const items = group.map((paragraph): ListItem => {
      const level = wordLevel(paragraph);
      const kind = markerKind(takeWordMarker(paragraph));
      const decls = styleOf(paragraph);
      for (const name of ['mso-list', 'margin-left', 'text-indent']) decls.delete(name);
      const li = document.createElement('li');
      const inner = li.appendChild(document.createElement('p'));
      setStyle(inner, decls); appendAll(inner, children(paragraph));
      return { ...kind, li, level };
    });
    for (const list of buildLists(document, items)) insertBefore(list, group[0]!);
    for (const paragraph of group) remove(paragraph);
  }
}

// Docs puts a nested <ul> beside its <li>, flattens levels into aria-level, and styles the marker on the <li>.
function normalizeLists(document: Document) {
  for (const list of elements(document.body, 'ul,ol').reverse()) {
    for (const child of childElements(list)) {
      if (child.tagName !== 'UL' && child.tagName !== 'OL') continue;
      let previous = child.previousElementSibling;
      if (previous?.tagName !== 'LI') { previous = document.createElement('li'); insertBefore(previous, child); }
      previous.appendChild(child);
    }
    const items = childElements(list).filter((child) => child.tagName === 'LI');
    const levels = items.map((li) => Number(li.getAttribute('aria-level')) || 1);
    const first = items[0];
    const markerType = (li: HTMLElement | undefined) => (li ? styleOf(li).get('list-style-type') : undefined) ?? styleOf(list).get('list-style-type');
    if (list.tagName === 'UL' && items.length && items.every((li) => li.getAttribute('role') === 'checkbox' || li.hasAttribute('aria-checked'))) {
      list.setAttribute('data-type', 'taskList');
      for (const li of items) { li.setAttribute('data-type', 'taskItem'); li.setAttribute('data-checked', String(li.getAttribute('aria-checked') === 'true')); }
      continue;
    }
    if (new Set(levels).size > 1) {
      const ordered = list.tagName === 'OL';
      const rebuilt = buildLists(document, items.map((li, index) => {
        const type = markerType(li) ?? '';
        return { li, level: levels[index]!, ordered, type: OL_TYPES[type] ?? null, start: index ? null : Number(list.getAttribute('start')) || null, bullet: BULLETS.has(type) ? type : null };
      }));
      replaceWith(list, rebuilt);
      continue;
    }
    const type = markerType(first) ?? '';
    if (list.tagName === 'UL' && BULLETS.has(type)) list.setAttribute('style', `list-style-type:${type}`);
    if (list.tagName === 'OL' && OL_TYPES[type] && !list.hasAttribute('type')) list.setAttribute('type', OL_TYPES[type]!);
  }
}

function textBefore(block: HTMLElement, target: Node): boolean {
  let found = false, text = false;
  const walk = (node: Node) => { for (const child of children(node)) { if (found) return; if (child === target) { found = true; return; } if (child.nodeType === TEXT && /\S/u.test(child.nodeValue ?? '')) text = true; walk(child); } };
  walk(block); return text;
}

// Every source spells a page break differently; all become the block-level marker the PageBreak node parses.
function normalizePageBreaks(document: Document) {
  // A div, because StarterKit's horizontal rule claims every <hr> before the page-break rule sees it.
  const marker = () => { const div = document.createElement('div'); div.setAttribute('data-page-break', ''); return div; };
  for (const element of elements(document.body, 'br,hr')) {
    if (!element.hasAttribute('data-page-break') && !PAGE_BREAK.test(element.getAttribute('style') ?? '')) continue;
    const block = element.closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6');
    if (block) { if (textBefore(block, element)) insertAfter(marker(), block); else insertBefore(marker(), block); remove(element); } else replaceWith(element, [marker()]);
  }
  for (const element of elements(document.body, 'p,h1,h2,h3,h4,h5,h6,div:not([data-page-break]),table,ul,ol')) {
    const decls = styleOf(element);
    if (/always|page/iu.test(decls.get('page-break-before') ?? decls.get('break-before') ?? '')) insertBefore(marker(), element);
    if (/always|page/iu.test(decls.get('page-break-after') ?? decls.get('break-after') ?? '')) insertAfter(marker(), element);
  }
}

// Column widths live on <col> (Docs) or on each cell (Word); the table node reads them from a colwidth attribute.
function normalizeTables(document: Document) {
  for (const table of elements(document.body, 'table')) {
    const columns = elements(table, 'col').filter((col) => col.closest('table') === table).flatMap((col) => {
      const width = toPx(col.getAttribute('width')) ?? toPx(styleOf(col).get('width'));
      return Array.from({ length: Math.max(1, Number(col.getAttribute('span')) || 1) }, () => width);
    });
    for (const row of elements(table, 'tr').filter((tr) => tr.closest('table') === table)) {
      let column = 0;
      for (const cell of childElements(row).filter((child) => child.tagName === 'TD' || child.tagName === 'TH')) {
        const span = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
        const decls = styleOf(cell);
        const own = toPx(cell.getAttribute('width')) ?? toPx(decls.get('width'));
        const widths = columns.length ? columns.slice(column, column + span) : own ? Array.from({ length: span }, () => Math.round(own / span)) : [];
        if (!cell.hasAttribute('colwidth') && widths.length === span && widths.every(Boolean)) cell.setAttribute('colwidth', widths.join(','));
        const valign = cell.getAttribute('valign');
        if (valign && !decls.has('vertical-align')) decls.set('vertical-align', valign.toLowerCase());
        const bgcolor = cell.getAttribute('bgcolor');
        if (bgcolor && !decls.has('background-color')) decls.set('background-color', bgcolor);
        setStyle(cell, decls);
        column += span;
      }
    }
  }
}

// Pushes block-level font declarations down to the text, where the textStyle mark can hold them.
function cascade(element: HTMLElement, inherited: Decls) {
  const own = styleOf(element);
  const merged = new Map(inherited);
  for (const name of INHERITED) { const value = own.get(name); if (value) merged.set(name, value); }
  if (element.tagName === 'SPAN') setStyle(element, new Map([...merged, ...own]));
  for (const child of children(element)) {
    if (child.nodeType === TEXT) {
      if (element.tagName === 'SPAN' || !merged.size || !/\S/u.test(child.nodeValue ?? '')) continue;
      const span = element.ownerDocument.createElement('span');
      span.setAttribute('style', writeStyle(merged)); replaceWith(child, [span]); span.appendChild(child);
    } else if (child.nodeType === ELEMENT) cascade(child as HTMLElement, merged);
  }
}

// Style-only formatting becomes the tags the mark rules match; what remains on the span is textStyle.
function convertInline(element: HTMLElement) {
  const decls = styleOf(element);
  const tags: Array<[string, string?]> = [];
  const weight = decls.get('font-weight')?.toLowerCase() ?? '';
  const bold = /^bold/u.test(weight) || Number(weight) >= 600;
  if ((element.tagName === 'B' || element.tagName === 'STRONG') && /^(?:normal|[1-5]00|lighter)$/u.test(weight)) { unwrap(element); return; }
  if (bold) tags.push(['strong']);
  if (/italic|oblique/iu.test(decls.get('font-style') ?? '')) tags.push(['em']);
  const decoration = `${decls.get('text-decoration') ?? ''} ${decls.get('text-decoration-line') ?? ''}`;
  if (/underline/iu.test(decoration)) tags.push(['u']);
  if (/line-through/iu.test(decoration)) tags.push(['s']);
  const vertical = decls.get('vertical-align')?.toLowerCase();
  if (vertical === 'super') tags.push(['sup']); else if (vertical === 'sub') tags.push(['sub']);
  const highlight = element.tagName === 'MARK' ? null : cleanColor(decls.get('mso-highlight')) ?? cleanColor(decls.get('background-color'));
  if (highlight) tags.push(['mark', highlight]);
  const kept: Decls = new Map();
  const family = cleanFontFamily(decls.get('font-family')); if (family) kept.set('font-family', family);
  const size = cleanFontSize(decls.get('font-size')); if (size) kept.set('font-size', size);
  const color = cleanColor(decls.get('color')); if (color) kept.set('color', color);
  const space = decls.get('white-space'); if (space && /^pre/u.test(space)) kept.set('white-space', space);
  if (element.tagName === 'MARK') {
    const own = element.getAttribute('data-color') ?? cleanColor(decls.get('background-color'));
    element.removeAttribute('style');
    if (own) { element.setAttribute('data-color', own); element.setAttribute('style', `background-color:${own}`); }
  } else element.removeAttribute('style');
  const document = element.ownerDocument;
  let inner: HTMLElement = element;
  if (kept.size) {
    if (element.tagName === 'SPAN') setStyle(element, kept);
    else { const span = document.createElement('span'); setStyle(span, kept); appendAll(span, children(element)); element.appendChild(span); inner = span; }
  }
  for (const [tag, value] of tags) {
    const wrapper = document.createElement(tag);
    if (value) { wrapper.setAttribute('data-color', value); wrapper.setAttribute('style', `background-color:${value}`); }
    appendAll(wrapper, children(inner)); inner.appendChild(wrapper); inner = wrapper;
  }
  if (element.tagName === 'SPAN' && !element.attributes.length) unwrap(element);
}

// Block elements keep only the declarations the schema stores as node attributes.
function blockStyle(element: HTMLElement) {
  const decls = styleOf(element);
  const kept: Decls = new Map();
  if (TEXT_BLOCKS.has(element.tagName)) {
    const align = (decls.get('text-align') ?? element.getAttribute('align') ?? '').toLowerCase();
    const mapped = align === 'end' ? 'right' : align;
    if (['left', 'right', 'center', 'justify'].includes(mapped)) kept.set('text-align', mapped);
    for (const name of ['line-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent']) {
      const value = safeLength(cleanNumber(decls.get(name), /^(?:pt|px|em|rem|in|cm|mm|%|)$/iu) ?? undefined);
      if (value) kept.set(name, value);
    }
  } else if (element.tagName === 'TD' || element.tagName === 'TH') {
    const background = cleanColor(decls.get('background-color'));
    if (background && background !== 'white' && !/^#fff(?:fff)?$/iu.test(background)) kept.set('background-color', background);
    const vertical = decls.get('vertical-align')?.toLowerCase();
    if (vertical && ['top', 'middle', 'bottom'].includes(vertical)) kept.set('vertical-align', vertical);
  } else if (element.tagName === 'UL') {
    const bullet = decls.get('list-style-type');
    if (bullet && BULLETS.has(bullet)) kept.set('list-style-type', bullet);
  }
  setStyle(element, kept);
}

function sanitize(document: Document) {
  for (const comment of comments(document.body)) remove(comment);
  for (const element of elements(document.body, '*')) {
    if (!element.isConnected) continue;
    const tag = element.tagName.toUpperCase();
    if (REMOVED.has(tag) || tag.startsWith('V:')) remove(element);
    else if (tag.includes(':')) unwrap(element);
  }
}

function finalizeAttributes(document: Document) {
  for (const element of elements(document.body, '*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (!ALLOWED_ATTRIBUTES.has(attribute.name) || (attribute.name === 'type' && element.tagName !== 'OL')) element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href')?.trim() ?? '';
      if (/^https?:\/\//iu.test(href)) element.setAttribute('href', href); else unwrap(element);
    }
  }
}

function parse(html: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  return new DOMParser().parseFromString(html, 'text/html');
}

// Our own copy already speaks the schema: swap the destination-facing styles for the exact attribute styles.
function normalizeOwn(document: Document) {
  for (const glyph of elements(document.body, `[${TASK_GLYPH_ATTRIBUTE}]`)) remove(glyph);
  // The serializer writes &nbsp; so blank lines survive in Docs and Word; here they are empty paragraphs again.
  for (const block of elements(document.body, 'p')) if (block.childNodes.length === 1 && block.firstChild?.nodeType === TEXT && block.textContent === '\u00a0') block.textContent = '';
  normalizePageBreaks(document);
  for (const element of elements(document.body, '*')) {
    if (element.tagName === 'SPAN') continue;
    if (element.tagName === 'MARK') { if (!element.hasAttribute('data-color')) element.removeAttribute('style'); continue; }
    const exact = element.getAttribute(OWN_STYLE_ATTRIBUTE);
    if (exact) element.setAttribute('style', exact); else element.removeAttribute('style');
    element.removeAttribute(OWN_STYLE_ATTRIBUTE);
  }
}

export function normalizePastedHtml(html: string): string {
  const document = parse(html);
  if (!document) return html;
  const own = !!document.querySelector(`[${OWN_CLIPBOARD_ATTRIBUTE}]`);
  if (!own) { applyClassStyles(document); convertWordLists(document); }
  sanitize(document);
  if (own) normalizeOwn(document);
  else {
    for (const wrapper of elements(document.body, 'b[id^="docs-internal-guid"]')) unwrap(wrapper);
    for (const font of elements(document.body, 'font')) {
      const decls = styleOf(font);
      const color = font.getAttribute('color'); if (color && !decls.has('color')) decls.set('color', color);
      const face = font.getAttribute('face'); if (face && !decls.has('font-family')) decls.set('font-family', face);
      setStyle(rename(font, 'span'), decls);
    }
    for (const tab of elements(document.body, '[style*="mso-tab-count"]')) {
      const count = Math.max(1, Number(styleOf(tab).get('mso-tab-count')) || 1);
      tab.textContent = '\t'.repeat(count); tab.setAttribute('style', 'white-space:pre');
    }
    normalizeLists(document);
    normalizePageBreaks(document);
    normalizeTables(document);
    cascade(document.body, new Map());
    for (const element of elements(document.body, '*').reverse()) if (INLINE.has(element.tagName) && element.isConnected) convertInline(element);
    for (const element of elements(document.body, '*')) if (!INLINE.has(element.tagName)) blockStyle(element);
  }
  finalizeAttributes(document);
  return document.body.innerHTML;
}

// ProseMirror's default text paste merges blank lines away; keep one paragraph per line, tabs included.
export function plainTextSlice(text: string, $context: ResolvedPos): Slice {
  const schema = $context.doc.type.schema;
  const marks = $context.marks();
  const lines = text.replace(/\r\n?/gu, '\n').replace(/\n$/u, '').split('\n');
  return Slice.maxOpen(Fragment.from(lines.map((line) => schema.nodes.paragraph!.create(null, line ? schema.text(line, marks) : undefined))));
}
