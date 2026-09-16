import type { WritingStyle } from './styles';

export const SUGGEST_MIN_WORDS = 40;
export const SUGGEST_CONTEXT_WORDS = 200;
export const SUGGEST_MIN_SCORE = 3;
const MIN_KEYWORD = 4;
// Frequent words carry no topic signal in either language.
const STOP = new Set([
  'yang', 'dan', 'untuk', 'dengan', 'pada', 'ini', 'itu', 'adalah', 'dalam', 'tidak', 'saya', 'kami', 'akan', 'dari', 'atau', 'juga', 'agar', 'oleh', 'sebagai', 'karena', 'tersebut', 'bisa', 'lebih', 'saat', 'kepada', 'tentang', 'skill', 'gaya',
  'the', 'and', 'for', 'with', 'this', 'that', 'are', 'was', 'from', 'into', 'about', 'your', 'you', 'our', 'their', 'have', 'has', 'will', 'when', 'what', 'which', 'style', 'text', 'write', 'writing',
]);

export type SuggestContext = { title: string; text: string };

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export const keywords = (text: string): Set<string> => new Set(words(text).filter((word) => word.length >= MIN_KEYWORD && !STOP.has(word)));

// The notebook is represented by its title plus the opening of its text, where the topic is usually stated.
export const contextKeywords = ({ title, text }: SuggestContext): Set<string> => keywords(`${title} ${words(text).slice(0, SUGGEST_CONTEXT_WORDS).join(' ')}`);

// Name matches weigh double: the name is what the author chose to call the situation.
export function scoreStyle(style: WritingStyle, context: Set<string>): number {
  let score = 0;
  for (const word of keywords(style.name)) if (context.has(word)) score += 2;
  for (const word of keywords(style.description ?? '')) if (context.has(word)) score += 1;
  return score;
}

// At most one suggestion, and only when the match is strong enough to be worth showing.
export function suggestStyle(styles: WritingStyle[], context: SuggestContext): WritingStyle | null {
  if (words(context.text).length < SUGGEST_MIN_WORDS) return null;
  const notebook = contextKeywords(context);
  let best: { style: WritingStyle; score: number } | null = null;
  for (const style of styles) {
    const score = scoreStyle(style, notebook);
    if (score >= SUGGEST_MIN_SCORE && (!best || score > best.score)) best = { style, score };
  }
  return best?.style ?? null;
}
