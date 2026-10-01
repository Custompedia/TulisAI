import { isReferenceHeading } from '@/lib/editor/document';
import type { Version } from './types';
import { WORKING } from './types';

// Pure rules the editor layout leans on, kept here so they can be tested without a browser.

// Skeleton and blank notebooks start with an Original that is either empty or just the outline, so comparing
// against it says nothing ("100% changed"). Those notebooks hide "Berubah dari Original" and "Sebelum & sesudah".
export function meaningfulOriginal(original: string | null, source: string | null | undefined): boolean {
  if (original === null || !original.trim()) return false;
  return source !== 'skeleton' && source !== 'blank';
}

// What Bandingkan opens by default: the Original when it means something, otherwise the latest saved version
// against the current text. Null when there is nothing to compare yet, so the button is disabled with a tooltip.
export function compareDefault(versions: Version[], originalId: string | null, meaningful: boolean): { a: string; b: string } | null {
  const original = originalId ?? versions.find((version) => version.kind === 'original')?.id ?? null;
  if (meaningful && original) return { a: original, b: WORKING };
  const latest = [...versions].filter((version) => version.kind !== 'original' && version.id !== original)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  return latest ? { a: latest.id, b: WORKING } : null;
}

// Leaving a skeleton or blank notebook that was never touched deletes it, so empty notebooks do not pile up
// while delete is permanent. "Never touched" is strict: still at revision 0 (no autosave, no AI apply, no version)
// with nothing pending on screen, and the text still what the notebook was created with.
export function shouldDiscard(input: { source: string | null | undefined; revision: number | null; dirty: boolean; text: string; original: string | null }): boolean {
  if (input.source !== 'skeleton' && input.source !== 'blank') return false;
  if (input.revision !== 0 || input.dirty) return false;
  if (input.source === 'blank') return !input.text.trim();
  return input.original !== null && input.text === input.original;
}

// Applying to the whole document keeps headings, lists and tables only when the result keeps one line per block
// (UX 3), so the panel says so
// before a run on a structured notebook.
const STRUCTURE = new Set(['heading', 'table', 'footnote', 'tableOfContents']);
type Walkable = { descendants: (visit: (node: { type: { name: string } }) => boolean | void) => void };
export function hasStructure(doc: Walkable | null | undefined): boolean {
  let found = false;
  doc?.descendants((node) => { if (found) return false; if (STRUCTURE.has(node.type.name)) { found = true; return false; } return true; });
  return found;
}

// One outline entry per heading, with the words that belong to it: everything up to the next heading of the same
// or a higher level. Positions are ProseMirror offsets of the top-level blocks, so a section can be selected.
export type OutlineSection = { level: number; text: string; pos: number; end: number; words: number };
export function outlineSections(blocks: Array<{ type: string; level?: number; text: string; pos: number; size: number }>): OutlineSection[] {
  const sections: OutlineSection[] = [];
  const words = (text: string) => { const value = text.trim(); return value ? value.split(/\s+/u).length : 0; };
  blocks.forEach((block, index) => {
    if (block.type !== 'heading' || !block.text.trim()) return;
    const level = block.level ?? 1;
    let end = block.pos + block.size; let count = 0;
    for (const next of blocks.slice(index + 1)) {
      if (next.type === 'heading' && (next.level ?? 1) <= level) break;
      if (next.type !== 'heading') count += words(next.text);
      end = next.pos + next.size;
    }
    sections.push({ level, text: block.text.trim(), pos: block.pos, end, words: count });
  });
  return sections;
}

// UX 3, "Tulis bagian ini": where Draf dari brief may write, mirroring draftTarget on the server. The caret's block
// must be a heading whose section is still empty, or an empty paragraph under a heading. `pos` is a position inside
// that block (turned into a plain-text offset when the request is sent), `heading` the section it belongs to.
export type DraftSpot = { pos: number; heading: string; headingPos: number };
export function draftSpotAt(blocks: Block[], position: number): DraftSpot | null {
  const index = blocks.findIndex((block) => position >= block.pos && position <= block.pos + block.size);
  if (index < 0) return null;
  const block = blocks[index]!;
  if (block.type === 'heading') {
    if (!block.text.trim() || isReferenceHeading(block.text)) return null;
    for (let next = index + 1; next < blocks.length && blocks[next]!.type !== 'heading'; next++) if (blocks[next]!.text.trim()) return null;
    return { pos: block.pos + 1, heading: block.text.trim(), headingPos: block.pos };
  }
  if (block.type !== 'paragraph' || block.text || block.size !== 2) return null;
  for (let previous = index - 1; previous >= 0; previous--) {
    const heading = blocks[previous]!;
    if (heading.type === 'heading') return heading.text.trim() && !isReferenceHeading(heading.text) ? { pos: block.pos + 1, heading: heading.text.trim(), headingPos: heading.pos } : null;
  }
  return null;
}
// The first outline section nobody has written yet, for "Tulis bagian pertama".
export function firstDraftSpot(blocks: Block[]): DraftSpot | null {
  for (const block of blocks) if (block.type === 'heading') { const spot = draftSpotAt(blocks, block.pos + 1); if (spot) return spot; }
  return null;
}

// "Bagian ini": the run of blocks between two headings that holds the caret (or follows the heading it sits on).
// Headings are never part of it, so applying a multi-paragraph result keeps every heading in place; the run stops
// at the next heading of any level so a subheading is never flattened either. Positions are ProseMirror offsets
// just inside the first and last block. `next` is where the text of the next section that has any starts, for
// "Pilih bagian berikutnya" (an outline's still-empty sections are skipped). Null when the caret's heading has no
// block under it.
export type SectionBody = { from: number; to: number; heading: string | null; next: number | null };
type Block = { type: string; text: string; pos: number; size: number };
export function sectionBodyAt(blocks: Block[], position: number): SectionBody | null {
  if (!blocks.length) return null;
  let index = blocks.findIndex((block) => position >= block.pos && position <= block.pos + block.size);
  if (index < 0) index = position < blocks[0]!.pos ? 0 : blocks.length - 1;
  let start = index;
  if (blocks[index]!.type === 'heading') start = index + 1;
  else while (start > 0 && blocks[start - 1]!.type !== 'heading') start--;
  let end = start;
  while (end < blocks.length && blocks[end]!.type !== 'heading') end++;
  if (end <= start) return null;
  const heading = start > 0 ? blocks[start - 1]!.text.trim() || null : null;
  let next: number | null = null;
  for (let cursor = end; cursor < blocks.length && next === null;) {
    while (cursor < blocks.length && blocks[cursor]!.type === 'heading') cursor++;
    const runStart = cursor;
    while (cursor < blocks.length && blocks[cursor]!.type !== 'heading') cursor++;
    if (blocks.slice(runStart, cursor).some((block) => block.text.trim())) next = blocks[runStart]!.pos + 1;
  }
  const first = blocks[start]!; const last = blocks[end - 1]!;
  return { from: first.pos + 1, to: last.pos + last.size - 1, heading, next };
}
