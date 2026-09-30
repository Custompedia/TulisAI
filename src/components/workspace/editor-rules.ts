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

// Applying to the whole document flattens headings, tables and footnotes into paragraphs, so the panel warns
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

// "Bagian ini": the run of blocks between two headings that holds the caret (or follows the heading it sits on).
// Headings are never part of it, so applying a multi-paragraph result keeps every heading in place; the run stops
// at the next heading of any level so a subheading is never flattened either. Positions are ProseMirror offsets
// just inside the first and last block. `next` is where the following section's text starts, for
// "Pilih bagian berikutnya". Null when the caret's heading has no text under it.
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
  let following = end;
  while (following < blocks.length && blocks[following]!.type === 'heading') following++;
  const first = blocks[start]!; const last = blocks[end - 1]!;
  return { from: first.pos + 1, to: last.pos + last.size - 1, heading, next: following < blocks.length ? blocks[following]!.pos + 1 : null };
}
