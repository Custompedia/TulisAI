import { diffWords } from "diff";

const MAX_EXACT_WORDS = 4_000;
const MAX_EDIT_LENGTH = 10_000;

export function countWords(text: string): number { const value = text.trim(); return value ? value.split(/\s+/u).length : 0; }
export function countCharacters(text: string): number { return Array.from(text).length; }
export function readingMinutes(text: string): number { const words = countWords(text); return words ? Math.max(1, Math.ceil(words / 200)) : 0; }
// Approximate large-input change percentage from word frequency deltas to keep work bounded.
function fallbackPercentage(before: string[], after: string[]): number {
  const counts = (items: string[]) => items.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map<string, number>());
  const left = counts(before); const right = counts(after); const keys = new Set([...left.keys(), ...right.keys()]); let delta = 0;
  for (const key of keys) delta += Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0));
  let positional = Math.abs(before.length-after.length);for(let index=0;index<Math.min(before.length,after.length);index++)if(before[index]!==after[index])positional++;
  return Math.min(100, Math.round(Math.max(delta,positional) / Math.max(before.length, after.length, 1) * 100));
}

export function changePercentage(original: string, current: string): number {
  const before = original.trim().split(/\s+/u).filter(Boolean); const after = current.trim().split(/\s+/u).filter(Boolean);
  if (!before.length) return after.length ? 100 : 0;
  if (before.length > MAX_EXACT_WORDS || after.length > MAX_EXACT_WORDS || before.length * after.length > 2_000_000) return fallbackPercentage(before, after);
  const changes = diffWords(original, current, { maxEditLength: MAX_EDIT_LENGTH }) ?? []; if (!changes.length) return fallbackPercentage(before, after);
  let changed = 0; for (const part of changes) if (part.added || part.removed) changed += part.value.trim() ? part.value.trim().split(/\s+/u).length : 0;
  return Math.min(100, Math.round(changed / Math.max(before.length, after.length, 1) * 100));
}

export function countSentences(text: string): number {
  const value = text.trim(); if (!value) return 0;
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'sentence' }) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) { let count = 0; for (const part of new Segmenter('id', { granularity: 'sentence' }).segment(value)) if (part.segment.trim()) count++; return count; }
  return value.split(/[.!?]+(?:\s|$)/u).filter((part) => part.trim()).length;
}

const STOPWORDS = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'ini', 'itu', 'adalah', 'dalam', 'tidak', 'akan', 'juga', 'atau', 'sebagai', 'karena', 'bahwa', 'oleh', 'the', 'and', 'of', 'to', 'in', 'a', 'an', 'is', 'are', 'for', 'on', 'with', 'that', 'this', 'it', 'as', 'be', 'by']);

// Local frequency heuristic; bounded to the first 20k words.
export function repeatedWords(text: string, limit = 5): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const word of (text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).slice(0, 20_000)) if (!STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word, count]) => ({ word, count }));
}

export function wordDelta(before: string, after: string): { added: number; removed: number } {
  const words = (value: string) => (value.trim() ? value.trim().split(/\s+/u).length : 0);
  if (before.length + after.length > 100_000) return { added: Math.max(0, words(after) - words(before)), removed: Math.max(0, words(before) - words(after)) };
  const parts = diffWords(before, after, { maxEditLength: MAX_EDIT_LENGTH }) ?? [];
  let added = 0; let removed = 0;
  for (const part of parts) { if (part.added) added += words(part.value); if (part.removed) removed += words(part.value); }
  return { added, removed };
}
