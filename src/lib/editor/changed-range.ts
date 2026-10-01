import type { Node as PMNode } from '@tiptap/pm/model';

// The top-level blocks a change touched, as a range of the new document: [from, to) covers whole blocks. Plugins use
// it to redo only that part of their work, which is what keeps typing in a 2,000-page notebook as fast as in a short
// one. Null when the two documents are the same.
export type ChangedRange = { from: number; to: number; fromIndex: number; toIndex: number; removed: number };

export function changedTopRange(before: PMNode, after: PMNode): ChangedRange | null {
  const start = before.content.findDiffStart(after.content);
  if (start === null || start === undefined) return null;
  const end = before.content.findDiffEnd(after.content) ?? { a: before.content.size, b: after.content.size };
  // A change that repeats text around it can report an end before the start; widen both ends by the overlap.
  const overlap = Math.max(0, start - Math.min(end.a, end.b));
  const endA = end.a + overlap; const endB = end.b + overlap;
  const first = blockAt(after, start); const last = blockAt(after, Math.max(start, endB - 1));
  const firstBefore = blockAt(before, start); const lastBefore = blockAt(before, Math.max(start, endA - 1));
  return { from: first.offset, to: last.offset + last.size, fromIndex: first.index, toIndex: last.index, removed: lastBefore.index - firstBefore.index + 1 };
}

// The top-level block at or around a position (the last one, past the end).
export function blockAt(doc: PMNode, position: number): { index: number; offset: number; size: number } {
  if (!doc.childCount) return { index: 0, offset: 0, size: 0 };
  const clamped = Math.max(0, Math.min(position, doc.content.size - 1));
  const { node, index, offset } = doc.childAfter(clamped);
  if (node) return { index, offset, size: node.nodeSize };
  const last = doc.childCount - 1; const lastNode = doc.child(last);
  return { index: last, offset: doc.content.size - lastNode.nodeSize, size: lastNode.nodeSize };
}
