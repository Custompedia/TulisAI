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

// Tags, comments, CDATA and processing instructions; anything else is character data.
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!\w[\s\S]*?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

// A single pass over the document; unbalanced closing tags are ignored rather than throwing, because a
// stray tag in one paragraph should not lose the whole file.
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let cursor = 0;
  const addText = (value: string) => { if (value) stack[stack.length - 1]!.text += decodeXml(value); };

  for (const match of source.matchAll(TOKEN)) {
    const index = match.index!;
    addText(source.slice(cursor, index));
    cursor = index + match[0].length;
    if (match[1] !== undefined) { addText(match[1]); continue; }
    if (match[2] !== undefined) {
      // Close the nearest matching open tag; a mismatch closes nothing.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]!.name === match[2]) { stack.length = depth; break; }
      }
      continue;
    }
    if (match[3] === undefined) continue;
    const node: XmlNode = { name: match[3], attrs: attributes(match[4] ?? ''), children: [], text: '' };
    stack[stack.length - 1]!.children.push(node);
    if (match[5] !== '/') stack.push(node);
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
