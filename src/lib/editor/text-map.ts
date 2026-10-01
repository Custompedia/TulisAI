import type { Node as PMNode } from '@tiptap/pm/model';
import { codePoints, wordsIn } from './metrics';

// The editor's plain text and its position map, built block by block and cached on the ProseMirror nodes
// themselves. ProseMirror shares every unchanged node between two versions of a document, so after a keystroke only
// the edited top-level block is walked again; a 2,000-page notebook no longer turns into JSON, gets validated and is
// rebuilt as nodes on every keystroke and every selection change.
//
// The flattening is exactly documentText()'s (src/lib/editor/document.ts mapping()): block children on their own
// lines, table cells joined by " | ", hard breaks as newlines, atoms as nothing. tests/ai/text-map.test.ts holds the
// two to the same answers.

// pmFrom/pmTo are relative to the start of the top-level block; from/to are relative to the block's own text.
type Span = { from: number; to: number; pmFrom: number; pmTo: number };
type BlockMap = { text: string; spans: Span[]; words: number; characters: number };
type DocMap = { starts: number[]; positions: number[]; length: number };

const blocks = new WeakMap<PMNode, BlockMap>();
const docs = new WeakMap<PMNode, DocMap>();
const texts = new WeakMap<PMNode, string>();

function blockMap(block: PMNode): BlockMap {
  const cached = blocks.get(block);
  if (cached) return cached;
  let text = ''; const spans: Span[] = [];
  const walk = (node: PMNode, position: number) => {
    if (node.isText || node.type.name === 'hardBreak') {
      const value = node.isText ? node.text! : '\n';
      spans.push({ from: text.length, to: text.length + value.length, pmFrom: position, pmTo: position + node.nodeSize }); text += value; return;
    }
    if (node.isLeaf) { spans.push({ from: text.length, to: text.length, pmFrom: position, pmTo: position + node.nodeSize }); return; }
    const contentStart = position + 1;
    if (!node.childCount) spans.push({ from: text.length, to: text.length, pmFrom: contentStart, pmTo: contentStart });
    node.forEach((child, offset, index) => {
      if (index > 0 && !node.inlineContent) text += node.type.name === 'tableRow' ? ' | ' : '\n';
      walk(child, contentStart + offset);
    });
  };
  walk(block, 0);
  const map = { text, spans, words: wordsIn(text), characters: codePoints(text) };
  blocks.set(block, map);
  return map;
}

function docMap(doc: PMNode): DocMap {
  const cached = docs.get(doc);
  if (cached) return cached;
  const starts: number[] = []; const positions: number[] = []; let length = 0;
  doc.forEach((block, offset, index) => {
    if (index > 0) length += 1;
    starts.push(length); positions.push(offset);
    length += blockMap(block).text.length;
  });
  const map = { starts, positions, length };
  docs.set(doc, map);
  return map;
}

// documentText() of the editor's document, without leaving ProseMirror.
export function docText(doc: PMNode): string {
  const cached = texts.get(doc);
  if (cached !== undefined) return cached;
  const parts: string[] = [];
  doc.forEach((block) => { parts.push(blockMap(block).text); });
  const text = parts.join('\n');
  texts.set(doc, text);
  return text;
}

// Words and characters (code points) of docText(doc), summed from the per-block counts. Words never run across two
// blocks because blocks are separated by a newline, and each separator is one character.
export function docCounts(doc: PMNode): { words: number; characters: number } {
  let words = 0; let characters = 0;
  doc.forEach((block, _offset, index) => { const map = blockMap(block); words += map.words; characters += map.characters + (index > 0 ? 1 : 0); });
  return { words, characters };
}

// The length of docText(doc), cheap after the first call on a document.
export const docTextLength = (doc: PMNode) => (doc.childCount ? docMap(doc).length : 0);

// The block holding `position` (the last block whose start is at or before it), by binary search.
function blockIndexAt(map: DocMap, position: number): number {
  let low = 0; let high = map.positions.length - 1;
  while (low < high) { const middle = (low + high + 1) >> 1; if (map.positions[middle]! <= position) low = middle; else high = middle - 1; }
  return low;
}

// The first span in a block that contains `relative`, or null. Spans are in document order with non-decreasing
// ends, so the first one ending at or after the position is the only candidate.
function containing(spans: Span[], relative: number): Span | null {
  let low = 0; let high = spans.length;
  while (low < high) { const middle = (low + high) >> 1; if (spans[middle]!.pmTo < relative) low = middle + 1; else high = middle; }
  const span = spans[low];
  return span && span.pmFrom <= relative ? span : null;
}

// The plain-text offset of a document position, as selectionOffsets() computes it: inside the first span that
// contains the position, else at the start of the next span, else at the end of the text.
export function plainOffset(doc: PMNode, position: number): number {
  if (!doc.childCount) return 0;
  const map = docMap(doc);
  const index = blockIndexAt(map, position);
  // A position on a block boundary may still be the end of the block before (a page break or rule ends exactly there).
  for (const candidate of position === map.positions[index] && index > 0 ? [index - 1, index] : [index]) {
    const spans = blockMap(doc.child(candidate)).spans; const relative = position - map.positions[candidate]!;
    const span = containing(spans, relative);
    if (span) return map.starts[candidate]! + span.from + Math.min(relative - span.pmFrom, span.to - span.from);
  }
  const spans = blockMap(doc.child(index)).spans; const relative = position - map.positions[index]!;
  const next = spans.find((span) => span.pmFrom > relative);
  if (next) return map.starts[index]! + next.from;
  return index + 1 < map.starts.length ? map.starts[index + 1]! : map.length;
}

export function selectionOffsetsIn(doc: PMNode, from: number, to: number): { from: number; to: number } {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > doc.content.size) throw new Error('Invalid editor selection.');
  return { from: plainOffset(doc, from), to: plainOffset(doc, to) };
}

// Top-level blocks with their text, for the outline, sections and draft rules; cached per document and per block.
export type TopBlock = { type: string; text: string; pos: number; size: number; level?: number };
const tops = new WeakMap<PMNode, TopBlock[]>();
const topText = new WeakMap<PMNode, string>();
export function topBlocks(doc: PMNode): TopBlock[] {
  const cached = tops.get(doc);
  if (cached) return cached;
  const list: TopBlock[] = [];
  doc.forEach((node, offset) => {
    let text = topText.get(node);
    if (text === undefined) { text = node.textContent; topText.set(node, text); }
    list.push({ type: node.type.name, text, pos: offset, size: node.nodeSize, ...(node.type.name === 'heading' ? { level: Number(node.attrs.level) || 1 } : {}) });
  });
  tops.set(doc, list);
  return list;
}
