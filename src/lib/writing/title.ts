import { EN_FUNCTION_WORDS, ID_FUNCTION_WORDS } from './language';

// A notebook title is a label, not a sentence: at most three words and forty characters.
export const TITLE_WORDS = 3;
export const TITLE_CHARS = 40;
const SCAN_CHARS = 400;

const STOPWORDS = new Set([...ID_FUNCTION_WORDS, ...EN_FUNCTION_WORDS]);
// Everything that is not a letter, digit, apostrophe or inner hyphen is separator noise: markup, quotes, punctuation, emoji.
const SEPARATORS = /[^\p{L}\p{N}'’-]+/gu;
const EDGE_PUNCTUATION = /^[-'’]+|[-'’]+$/gu;
const hasLetter = (value: string) => /\p{L}/u.test(value);
// Only fully lowercase words are capitalised, so acronyms and camelCase names keep their own shape.
const capitalise = (word: string) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word);

// Drops words until the label fits; a single over-long word is cut instead.
function fit(words: string[]): string {
  const kept = [...words];
  while (kept.length > 1 && kept.join(' ').length > TITLE_CHARS) kept.pop();
  return kept.join(' ').slice(0, TITLE_CHARS).trim();
}

function pick(source: string): string[] {
  const words = source.slice(0, SCAN_CHARS).replace(SEPARATORS, ' ').split(' ').map((word) => word.replace(EDGE_PUNCTUATION, '')).filter((word) => word && hasLetter(word));
  const meaningful = words.filter((word) => !STOPWORDS.has(word.toLowerCase()));
  return (meaningful.length ? meaningful : words).slice(0, TITLE_WORDS);
}

// Local fallback title: the first meaningful words of the text, used whenever no AI title is available.
export function deriveTitle(text: string, fallback: string): string {
  const line = typeof text === 'string' ? text.split('\n').map((part) => part.trim()).find(Boolean) ?? '' : '';
  const picked = pick(line);
  const title = fit(picked.map(capitalise));
  return title || fallback;
}

// Server-side check on the model's suggested_title; anything sentence-shaped or empty is rejected so the local title stays.
export function sanitizeSuggestedTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const flat = value.replace(/<[^>]*>/g, ' ').replace(/[`*_#|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat || flat.length > 120) return null;
  // Sentence markers: internal stops, clause commas, a label prefix, or simply too many words.
  if (/[.!?;:,]\s/.test(flat) || /[;:,]$/.test(flat)) return null;
  const picked = pick(flat);
  if (!picked.length) return null;
  if (flat.replace(SEPARATORS, ' ').split(' ').filter(Boolean).length > 6) return null;
  const title = fit(picked.map(capitalise));
  return title.length >= 2 && hasLetter(title) ? title : null;
}
