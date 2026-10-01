import { diffWords } from "diff";

const MAX_EXACT_WORDS = 4_000;
const MAX_EDIT_LENGTH = 10_000;

// The panels and the status bar ask for the same counts of the same (possibly 2,000-page) text on every render;
// the last few answers are kept, keyed by the arguments themselves.
function remember<A extends unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  const recent: Array<{ args: A; result: R }> = [];
  return (...args: A) => {
    const hit = recent.find((entry) => entry.args.length === args.length && entry.args.every((value, index) => value === args[index]));
    if (hit) return hit.result;
    const result = compute(...args);
    recent.unshift({ args, result }); if (recent.length > 4) recent.length = 4;
    return result;
  };
}
// JavaScript's \s, spelled out so counting does not run a regular expression per character.
export const isSpaceCode = (code: number) => code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
  || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
// Maximal runs of non-space characters: the same count as splitting the trimmed text on /\s+/u, without the copies.
export function wordsIn(text: string): number {
  let count = 0; let inWord = false;
  for (let index = 0; index < text.length; index++) { const space = isSpaceCode(text.charCodeAt(index)); if (!space && !inWord) count++; inWord = !space; }
  return count;
}
// Code points, as Array.from(text).length counts them: a surrogate pair is one character, a lone surrogate is one too.
export function codePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) index++;
    count++;
  }
  return count;
}
// Counted without splitting or copying the text, so the status bar stays cheap on a 2,000-page notebook.
export const countWords = remember((text: string): number => wordsIn(text));
export const countCharacters = remember((text: string): number => codePoints(text));
export function readingMinutes(text: string): number { const words = countWords(text); return words ? Math.max(1, Math.ceil(words / 200)) : 0; }
// Approximate large-input change percentage from word frequency deltas to keep work bounded.
function fallbackPercentage(before: string[], after: string[]): number {
  const counts = (items: string[]) => items.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map<string, number>());
  const left = counts(before); const right = counts(after); const keys = new Set([...left.keys(), ...right.keys()]); let delta = 0;
  for (const key of keys) delta += Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0));
  let positional = Math.abs(before.length-after.length);for(let index=0;index<Math.min(before.length,after.length);index++)if(before[index]!==after[index])positional++;
  return Math.min(100, Math.round(Math.max(delta,positional) / Math.max(before.length, after.length, 1) * 100));
}

export const changePercentage = remember(function changePercentage(original: string, current: string): number {
  const before = original.trim().split(/\s+/u).filter(Boolean); const after = current.trim().split(/\s+/u).filter(Boolean);
  if (!before.length) return after.length ? 100 : 0;
  if (before.length > MAX_EXACT_WORDS || after.length > MAX_EXACT_WORDS || before.length * after.length > 2_000_000) return fallbackPercentage(before, after);
  const changes = diffWords(original, current, { maxEditLength: MAX_EDIT_LENGTH }) ?? []; if (!changes.length) return fallbackPercentage(before, after);
  let changed = 0; for (const part of changes) if (part.added || part.removed) changed += part.value.trim() ? part.value.trim().split(/\s+/u).length : 0;
  return Math.min(100, Math.round(changed / Math.max(before.length, after.length, 1) * 100));
});

export const countSentences = remember(function countSentences(text: string): number {
  const value = text.trim(); if (!value) return 0;
  // The segmenter is exact but slow; past ~70 pages the punctuation count is close enough and stays instant.
  if (value.length > 200_000) { let count = 0; for (const part of value.split(/[.!?]+(?:\s|$)/u)) if (part.trim()) count++; return count; }
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'sentence' }) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) { let count = 0; for (const part of new Segmenter('id', { granularity: 'sentence' }).segment(value)) if (part.segment.trim()) count++; return count; }
  return value.split(/[.!?]+(?:\s|$)/u).filter((part) => part.trim()).length;
});

const STOPWORDS = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'ini', 'itu', 'adalah', 'dalam', 'tidak', 'akan', 'juga', 'atau', 'sebagai', 'karena', 'bahwa', 'oleh', 'the', 'and', 'of', 'to', 'in', 'a', 'an', 'is', 'are', 'for', 'on', 'with', 'that', 'this', 'it', 'as', 'be', 'by']);

// Local frequency heuristic; bounded to the first 20k words.
export const repeatedWords = remember(function repeatedWords(text: string, limit: number = 5): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  // 20,000 words fit well inside the first 400,000 characters, so a long notebook is never lower-cased whole.
  for (const word of (text.slice(0, 400_000).toLowerCase().match(/\p{L}{4,}/gu) ?? []).slice(0, 20_000)) if (!STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word, count]) => ({ word, count }));
});

export function wordDelta(before: string, after: string): { added: number; removed: number } {
  const words = (value: string) => (value.trim() ? value.trim().split(/\s+/u).length : 0);
  if (before.length + after.length > 100_000) return { added: Math.max(0, words(after) - words(before)), removed: Math.max(0, words(before) - words(after)) };
  const parts = diffWords(before, after, { maxEditLength: MAX_EDIT_LENGTH }) ?? [];
  let added = 0; let removed = 0;
  for (const part of parts) { if (part.added) added += words(part.value); if (part.removed) removed += words(part.value); }
  return { added, removed };
}

// Spoken aloud (a script or caption read on camera) at about 130 words a minute, a comfortable pace for
// Indonesian and English voice-over; reading stays at 200 words a minute (readingMinutes).
export const SPEAKING_WPM = 130;
export function speakingSeconds(text: string): number { const words = countWords(text); return words ? Math.max(1, Math.round((words / SPEAKING_WPM) * 60)) : 0; }
// "45 dtk", "1 mnt 20 dtk", "3 mnt": short enough for the status bar.
export function formatDuration(seconds: number, t: (id: string, en: string) => string): string {
  if (seconds < 60) return `${seconds} ${t('dtk', 's')}`;
  const minutes = Math.floor(seconds / 60); const rest = seconds % 60;
  return rest ? `${minutes} ${t('mnt', 'min')} ${rest} ${t('dtk', 's')}` : `${minutes} ${t('mnt', 'min')}`;
}
