import type { EditorDocument, EditorMark, EditorNode } from '../contracts';

// The stored form of a notebook: JSON with a fixed key order (type, text, attrs, marks, content) and no null
// attributes. One canonical spelling means the DOCX import receipt, the version hash and the R2 body all agree on
// what "the same document" is, whatever order a client sent the keys in.
//
// It is produced as one string per top-level block, so a 2,000-page document never needs a single giant rope or a
// second full copy while it is being written: the chunks go straight into one UTF-8 buffer.

function attrsJson(attrs: Record<string, unknown> | undefined): string {
  if (!attrs) return '';
  let out = '';
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === null || value === undefined) continue;
    out += `${out ? ',' : '{'}${JSON.stringify(key)}:${JSON.stringify(value)}`;
  }
  return out ? `${out}}` : '';
}

function markJson(mark: EditorMark): string {
  const attrs = attrsJson(mark.attrs);
  return `{"type":${JSON.stringify(mark.type)}${attrs ? `,"attrs":${attrs}` : ''}}`;
}

function nodeJson(node: EditorNode): string {
  let out = `{"type":${JSON.stringify(node.type)}`;
  if (node.text !== undefined) out += `,"text":${JSON.stringify(node.text)}`;
  const attrs = attrsJson(node.attrs);
  if (attrs) out += `,"attrs":${attrs}`;
  if (node.marks?.length) out += `,"marks":[${node.marks.map(markJson).join(',')}]`;
  if (node.content) out += `,"content":[${node.content.map(nodeJson).join(',')}]`;
  return `${out}}`;
}

export function serializeDocumentChunks(document: EditorDocument): string[] {
  const chunks = ['{"type":"doc","content":['];
  document.content.forEach((node, index) => chunks.push(`${index ? ',' : ''}${nodeJson(node)}`));
  chunks.push(']}');
  return chunks;
}

export const serializeDocument = (document: EditorDocument): string => serializeDocumentChunks(document).join('');

// What TextEncoder will write: a surrogate pair is 4 bytes, a lone surrogate becomes U+FFFD (3 bytes).
export function utf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && (value.charCodeAt(index + 1) & 0xfc00) === 0xdc00) { bytes += 4; index++; }
    else bytes += 3;
  }
  return bytes;
}

// The chunks as one UTF-8 buffer, sized up front so the bytes are written once.
export function encodeChunks(chunks: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const sizes = chunks.map(utf8Length);
  const output = new Uint8Array(sizes.reduce((sum, size) => sum + size, 0));
  let offset = 0;
  chunks.forEach((chunk, index) => { encoder.encodeInto(chunk, output.subarray(offset)); offset += sizes[index]!; });
  return output;
}

export const encodeDocument = (document: EditorDocument): Uint8Array => encodeChunks(serializeDocumentChunks(document));
