type Segment = { segment: string; isWordLike?: boolean };
type SegmenterCtor = new (locale: string, options: { granularity: 'word' | 'sentence' }) => { segment: (input: string) => Iterable<Segment> };
const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;

export const wordCount = (text: string): number => {
  if (!Segmenter) return (text.match(/[\p{L}\p{N}]+(?:[-'’.,][\p{L}\p{N}]+)*/gu) ?? []).length;
  let count = 0; for (const part of new Segmenter('id', { granularity: 'word' }).segment(text)) if (part.isWordLike) count++;
  return count;
};

// Sentences without trailing separator whitespace, so alignment compares content only.
export const sentences = (text: string): string[] => {
  const parts = Segmenter ? [...new Segmenter('id', { granularity: 'sentence' }).segment(text)].map((part) => part.segment) : text.match(/[^.!?\n]+(?:[.!?]+|$)|\n/gu) ?? [];
  return parts.flatMap((part) => part.split(/\n+/u)).map((part) => part.trim()).filter(Boolean);
};

// One paragraph per non-empty line, matching documentText and plainTextDocument.
export const paragraphCount = (text: string): number => text.split('\n').filter((line) => line.trim()).length;

export const LIST_FORMATS = new Set(['poin', 'bernomor', 'tabel', 'ringkasan']);
export const paragraphsPreserved = (source: string, output: string, format?: string) => (format && LIST_FORMATS.has(format)) || paragraphCount(source) === paragraphCount(output);

export const SIMPLIFY_MIN_RATIO = 0.85;
export const simplifyLengthKept = (source: string, output: string) => wordCount(output) >= SIMPLIFY_MIN_RATIO * wordCount(source);

export type Band = { min: number; max: number };
export const LENGTH_BANDS: Record<string, Band> = { "lebih singkat": { min: 0.5, max: 0.8 }, sama: { min: 0.85, max: 1.15 }, "lebih detail": { min: 1.2, max: 1.6 }, ringkasan: { min: 0.25, max: 0.55 }, default: { min: 0.85, max: 1.15 } };
export const LENGTH_MIN_WORDS = 10;
export function lengthBand(promptId: string, request: { format?: string; length?: string } | undefined): Band | null {
  if (request?.format === 'ringkasan') return LENGTH_BANDS.ringkasan!;
  if (request?.length && LENGTH_BANDS[request.length]) return LENGTH_BANDS[request.length]!;
  return promptId === 'P01_STANDARD_REWRITE' || promptId === 'P08_CUSTOM_TRANSFORM' ? LENGTH_BANDS.default! : null;
}
export const withinBand = (source: string, output: string, band: Band) => { const before = wordCount(source); if (before < LENGTH_MIN_WORDS) return true; const ratio = wordCount(output) / before; return ratio >= band.min && ratio <= band.max; };

export function sentenceLengthDeviation(text: string): number {
  const lengths = sentences(text).map(wordCount); if (lengths.length < 2) return 0;
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  return Math.sqrt(lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length);
}
// Holds when output variance is not lower than input beyond a small tolerance; needs three input sentences.
export const varianceHolds = (source: string, output: string) => { if (sentences(source).length < 3) return true; const before = sentenceLengthDeviation(source); return sentenceLengthDeviation(output) + Math.max(0.5, before * 0.1) >= before; };

const occurrences = (haystack: string, needle: string) => needle ? haystack.split(needle).length - 1 : 0;
// P10 anti-drift: every changed sentence must restore a required string or drop a disallowed one.
export function repairDrift(failed: string, corrected: string, violations: Array<{ required: string; found: string }>): string[] {
  const before = sentences(failed); const after = sentences(corrected);
  if (before.length !== after.length) return [`sentence count changed from ${before.length} to ${after.length}`];
  if (paragraphCount(failed) !== paragraphCount(corrected)) return ['paragraph count changed'];
  const required = violations.map((item) => item.required).filter((value) => value && !value.startsWith('('));
  const found = violations.map((item) => item.found).filter((value) => value && !value.startsWith('('));
  return before.flatMap((sentence, index) => {
    const next = after[index]!; if (sentence === next) return [];
    const involved = required.some((value) => occurrences(next, value) > occurrences(sentence, value)) || found.some((value) => occurrences(sentence, value) > occurrences(next, value));
    return involved ? [] : [`sentence ${index + 1} changed without a violation`];
  });
}

export const SAMPLE_ECHO_WORDS = 8;
const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const grams = (list: string[], size: number) => { const set = new Set<string>(); for (let index = 0; index + size <= list.length; index++) set.add(list.slice(index, index + size).join(' ')); return set; };
// Style samples are references, not content: a run of SAMPLE_ECHO_WORDS words taken from the sample and absent from the author's own input is a copy.
export function sampleEcho(sample: string, source: string, output: string, span = SAMPLE_ECHO_WORDS): string | null {
  const sampleWords = words(sample); const outputWords = words(output);
  if (sampleWords.length < span || outputWords.length < span) return null;
  const fromSample = grams(sampleWords, span); const fromSource = grams(words(source), span);
  for (let index = 0; index + span <= outputWords.length; index++) {
    const phrase = outputWords.slice(index, index + span).join(' ');
    if (fromSample.has(phrase) && !fromSource.has(phrase)) return phrase;
  }
  return null;
}

// Every maximal run of output words that also appears in the sample (as SAMPLE_ECHO_WORDS-grams) and not in the author's input.
export function sampleEchoRuns(sample: string, source: string, output: string, span = SAMPLE_ECHO_WORDS): string[] {
  const sampleWords = words(sample); const outputWords = words(output);
  if (sampleWords.length < span || outputWords.length < span) return [];
  const fromSample = grams(sampleWords, span); const fromSource = grams(words(source), span);
  const runs: string[] = []; let start = -1; let end = -1;
  for (let index = 0; index + span <= outputWords.length; index++) {
    const phrase = outputWords.slice(index, index + span).join(' ');
    const hit = fromSample.has(phrase) && !fromSource.has(phrase);
    if (hit && start === -1) start = index;
    if (hit) end = index + span;
    if (!hit && start !== -1 && index >= end) { runs.push(outputWords.slice(start, end).join(' ')); start = -1; end = -1; }
  }
  if (start !== -1) runs.push(outputWords.slice(start, end).join(' '));
  return runs;
}
export const SAMPLE_ECHO_REJECT_WORDS = 12;
// One short echo is a warning; two runs, or one run of SAMPLE_ECHO_REJECT_WORDS words, is a copy and rejects the output.
export const sampleEchoSeverity = (runs: string[]): 'none' | 'warn' | 'reject' => runs.length === 0 ? 'none' : runs.length >= 2 || runs.some((run) => words(run).length >= SAMPLE_ECHO_REJECT_WORDS) ? 'reject' : 'warn';

export const emDashCount = (text: string): number => (text.match(/\u2014/g) ?? []).length;
type Language = 'id' | 'en';
const say = (language: Language, id: string, en: string) => (language === 'en' ? en : id);
// Soft checks never reject; they return short user-facing warnings.
export function softWarnings(promptId: string, source: string, output: string, runtime: { language?: unknown; strength?: unknown; request?: { format?: string; length?: string } }): string[] {
  const language: Language = runtime.language === 'en' ? 'en' : 'id'; const warnings: string[] = [];
  if (promptId === 'P01_STANDARD_REWRITE' && runtime.strength === 'light' && sentences(source).length !== sentences(output).length) warnings.push(say(language, 'Jumlah kalimat berubah padahal kekuatan Ringan.', 'The sentence count changed at Light strength.'));
  const band = lengthBand(promptId, runtime.request);
  if (band && !withinBand(source, output, band)) warnings.push(say(language, 'Panjang hasil di luar rentang yang diminta.', 'The result length is outside the requested range.'));
  if (promptId === 'P03_HUMANIZER' && !varianceHolds(source, output)) warnings.push(say(language, 'Panjang kalimat jadi lebih seragam dari teks asli.', 'Sentence lengths became more uniform than the original.'));
  if (promptId === 'P03_HUMANIZER' && emDashCount(output) > emDashCount(source)) warnings.push(say(language, 'Hasil menambah tanda pisah (—) yang tidak ada di teks asli.', 'The result added em dashes (—) absent from the original.'));
  return warnings;
}

export const mergeWarnings = (model: unknown, extra: string[], cap = 3): string[] => { const own = Array.isArray(model) ? model.filter((item): item is string => typeof item === 'string') : []; return [...own.slice(0, Math.max(0, cap - extra.length)), ...extra].slice(0, cap); };
