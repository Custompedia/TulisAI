// A small XML reader for the ~20 OOXML tags this app maps. Cloudflare Workers have no DOMParser, and a
// general XML library is far more than a DOCX body needs.

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const decodeEntity = (entity: string): string => {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  if (entity in named) return named[entity]!;
  const numeric = /^#x([0-9a-f]+)$/i.exec(entity) ?? /^#(\d+)$/.exec(entity);
  if (!numeric) return `&${entity};`;
  const code = numeric[0]!.startsWith('#x') || numeric[0]!.startsWith('#X') ? parseInt(numeric[1]!, 16) : Number(numeric[1]);
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
};
export const decodeXml = (value: string) => value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => decodeEntity(entity));

const ATTRIBUTE = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1] ?? match[3]; const value = match[2] ?? match[4];
    if (name !== undefined && value !== undefined) attrs[name] = decodeXml(value);
  }
  return attrs;
}

// Tags, comments, CDATA and processing instructions; anything else is character data. An unterminated
// comment, CDATA or instruction runs to the end, so a file full of them cannot make the scan quadratic.
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<!\w[^>]*>?|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

export class XmlError extends Error {}
// A real DOCX part stays far below both; the node cap keeps a crafted part inside a Worker's memory.
export const XML_LIMITS = { maxNodes: 250_000, maxDepth: 256 };

// A single pass over the document; unbalanced closing tags are ignored rather than throwing, because a
// stray tag in one paragraph should not lose the whole file.
export function parseXml(source: string, limits = XML_LIMITS): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const open = new Map<string, number>();
  let cursor = 0; let nodes = 0;
  const addText = (value: string) => { if (value) stack[stack.length - 1]!.text += decodeXml(value); };

  for (const match of source.matchAll(TOKEN)) {
    const index = match.index!;
    addText(source.slice(cursor, index));
    cursor = index + match[0].length;
    if (match[1] !== undefined) { addText(match[1]); continue; }
    if (match[2] !== undefined) {
      // Close the nearest matching open tag; a mismatch closes nothing (and costs nothing).
      if (!open.get(match[2])) continue;
      while (stack.length > 1) { const closed = stack.pop()!; open.set(closed.name, open.get(closed.name)! - 1); if (closed.name === match[2]) break; }
      continue;
    }
    if (match[3] === undefined) continue;
    if (++nodes > limits.maxNodes) throw new XmlError('XML part has too many elements.');
    const node: XmlNode = { name: match[3], attrs: attributes(match[4] ?? ''), children: [], text: '' };
    stack[stack.length - 1]!.children.push(node);
    if (match[5] === '/') continue;
    if (stack.length > limits.maxDepth) throw new XmlError('XML part is nested too deeply.');
    stack.push(node); open.set(node.name, (open.get(node.name) ?? 0) + 1);
  }
  addText(source.slice(cursor));
  return root;
}

export const childrenNamed = (node: XmlNode, name: string): XmlNode[] => node.children.filter((child) => child.name === name);
export const firstNamed = (node: XmlNode, name: string): XmlNode | undefined => node.children.find((child) => child.name === name);
export const attr = (node: XmlNode | undefined, name: string): string | undefined => node?.attrs[name];

// Depth-first search, used for the handful of lookups that are not direct children (a run property inside a run, say).
export function findDeep(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (child.name === name) return child;
    const found = findDeep(child, name);
    if (found) return found;
  }
  return undefined;
}

// An OOXML on/off attribute: the element being present means true unless w:val says otherwise.
export const isOn = (node: XmlNode | undefined): boolean => {
  if (!node) return false;
  const value = node.attrs['w:val'] ?? node.attrs.val;
  return value === undefined || !['0', 'false', 'off', 'none'].includes(value);
};

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const element = (name: string, attrs: Record<string, string | number | undefined> = {}, body = ''): string => {
  const pairs = Object.entries(attrs).filter(([, value]) => value !== undefined).map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`).join('');
  return body ? `<${name}${pairs}>${body}</${name}>` : `<${name}${pairs}/>`;
};

// A part's text, decoded as it inflates, so it never has to exist as one string.
export async function* textChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) return; if (value) yield value; }
  } finally { reader.releaseLock(); }
}

// Where a tag that starts at `from` ends, with '>' inside a quoted attribute value skipped; -1 while it is incomplete.
function tagEnd(source: string, from: number): number {
  const close = source.indexOf('>', from);
  if (close < 0) return -1;
  const quote = source.slice(from, close).search(/["']/u);
  if (quote < 0) return close;
  let open = 0;
  for (let index = from + 1; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (open) { if (code === open) open = 0; } else if (code === 34 || code === 39) open = code; else if (code === 62) return index;
  }
  return -1;
}
const nameAt = (source: string, from: number) => { let end = from; while (end < source.length && !/[\s/>]/u.test(source[end]!)) end++; return source.slice(from, end); };

export type BodyStreamLimits = { maxChildren: number; maxElements: number; maxBlockChars: number };
export const BODY_STREAM_LIMITS: BodyStreamLimits = { maxChildren: 250_000, maxElements: 40_000_000, maxBlockChars: 16_000_000 };

// Streams the document body one top-level child at a time (a paragraph, a table, a bookmark), parsing each with
// parseXml and handing it to `visit` before reading on, so a 2,000-page body is never one string or one tree. Only
// element depth is tracked between children; everything inside a child is parseXml's job, with its own limits. A
// child left open when the part ends is still parsed, the way parseXml tolerates unbalanced tags.
export async function forEachBodyChild(chunks: AsyncIterable<string>, visit: (node: XmlNode) => void, limits = BODY_STREAM_LIMITS): Promise<void> {
  let buffer = ''; let position = 0; let depth = 0; let bodyDepth = -1; let blockStart = -1; let children = 0; let elements = 0; let done = false;
  const emit = (end: number) => {
    if (++children > limits.maxChildren) throw new XmlError('The document body has too many blocks.');
    const root = parseXml(buffer.slice(blockStart, end));
    for (const child of root.children) visit(child);
    blockStart = -1;
  };
  const scan = () => {
    while (!done) {
      const open = buffer.indexOf('<', position);
      if (open < 0) { position = buffer.length; return; }
      let end: number;
      if (buffer.startsWith('<!--', open)) { const close = buffer.indexOf('-->', open + 4); if (close < 0) { position = open; return; } position = close + 3; continue; }
      if (buffer.startsWith('<![CDATA[', open)) { const close = buffer.indexOf(']]>', open + 9); if (close < 0) { position = open; return; } position = close + 3; continue; }
      if (buffer.startsWith('<?', open) || buffer.startsWith('<!', open)) { const close = buffer.indexOf('>', open); if (close < 0) { position = open; return; } position = close + 1; continue; }
      if ((end = tagEnd(buffer, open)) < 0) { position = open; return; }
      position = end + 1;
      if (++elements > limits.maxElements) throw new XmlError('XML part has too many elements.');
      if (buffer.charCodeAt(open + 1) === 47) {
        depth--;
        if (bodyDepth >= 0 && depth === bodyDepth && blockStart >= 0) emit(end + 1);
        else if (bodyDepth >= 0 && depth < bodyDepth) done = true;
        continue;
      }
      const selfClosing = buffer.charCodeAt(end - 1) === 47;
      if (bodyDepth >= 0 && depth === bodyDepth && blockStart < 0) { blockStart = open; if (selfClosing) { emit(end + 1); continue; } }
      if (selfClosing) continue;
      depth++;
      if (bodyDepth < 0 && nameAt(buffer, open + 1) === 'w:body') bodyDepth = depth;
    }
  };
  for await (const chunk of chunks) {
    buffer += chunk;
    scan();
    if (done) break;
    const cut = blockStart >= 0 ? blockStart : position;
    if (blockStart >= 0 && buffer.length - blockStart > limits.maxBlockChars) throw new XmlError('A block of the document is too large.');
    if (cut > 0) { buffer = buffer.slice(cut); position -= cut; if (blockStart >= 0) blockStart -= cut; }
  }
  if (!done && blockStart >= 0) emit(buffer.length);
  if (bodyDepth < 0) throw new XmlError('The document has no body.');
}

// Every w:sectPr in a part (the ones inside paragraphs end their section, the last one sits in the body), read in a
// first light pass so the page geometry is known before the body is mapped.
export async function collectElements(chunks: AsyncIterable<string>, name: string, max = 10_000): Promise<XmlNode[]> {
  const found: XmlNode[] = []; let buffer = '';
  const open = `<${name}`; const close = `</${name}>`;
  for await (const chunk of chunks) {
    buffer += chunk;
    for (;;) {
      const start = buffer.indexOf(open);
      if (start < 0) { buffer = buffer.slice(Math.max(0, buffer.length - open.length)); break; }
      const head = tagEnd(buffer, start);
      if (head < 0) { buffer = buffer.slice(start); break; }
      const after = buffer[start + open.length];
      if (after !== ' ' && after !== '>' && after !== '/' && after !== '\t' && after !== '\n' && after !== '\r') { buffer = buffer.slice(start + open.length); continue; }
      let end = head + 1;
      if (buffer.charCodeAt(head - 1) !== 47) { const closing = buffer.indexOf(close, head); if (closing < 0) { buffer = buffer.slice(start); break; } end = closing + close.length; }
      const node = parseXml(buffer.slice(start, end)).children[0];
      if (node) { found.push(node); if (found.length > max) throw new XmlError('XML part has too many sections.'); }
      buffer = buffer.slice(end);
    }
  }
  return found;
}
