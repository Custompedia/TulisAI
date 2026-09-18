// Numeric protection compares VALUES, not digit strings.
// The old rule was an exact multiset match on raw digits, so a paraphrase was refused for rewriting
// 1.000 as 1,000, for restating a figure one extra time, or for numbering a list. None of those change a number.
// A value is only reported when it is genuinely missing from the output, or genuinely absent from the source.

// value = digits / 10^exp, so scaling is exponent arithmetic and never a float.
type Decimal = { digits: string; exp: number };

const SCALES: Record<string, number> = {
  ribu: 3, rb: 3, thousand: 3, thousands: 3, k: 3,
  juta: 6, jt: 6, million: 6, millions: 6, m: 6,
  miliar: 9, milyar: 9, billion: 9, billions: 9, b: 9,
  triliun: 12, trilyun: 12, trillion: 12, trillions: 12,
};

// "kosong" and a bare "se" are left out: they read as words far more often than as numbers.
const ID_UNITS: Record<string, number> = {
  nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
  sepuluh: 10, sebelas: 11, seratus: 100, seribu: 1000,
};
const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // "first" and "second" are left out on purpose: both read as ordinary words ("first, we…", "a few seconds").
  third: 3, fifth: 5, eighth: 8, ninth: 9, twelfth: 12,
};
// Ordinal suffix forms ("fourth", "sixteenth") derive from the cardinal, so only irregulars are listed above.
const EN_ORDINAL = /^(\w+?)(?:th)$/;

const normalize = (value: Decimal): string => {
  let digits = value.digits.replace(/^0+(?=\d)/, '');
  if (value.exp <= 0) return digits === '0' ? '0' : digits + '0'.repeat(-value.exp);
  while (digits.length <= value.exp) digits = `0${digits}`;
  const whole = digits.slice(0, digits.length - value.exp).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(digits.length - value.exp).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};
const fromInteger = (value: number): string => normalize({ digits: String(value), exp: 0 });

// A number written with one separator and exactly one group of three digits is ambiguous across locales:
// Indonesian "1.000" is a thousand, English "1.000" is one. Both readings are kept, and a match on either is a match.
function candidates(raw: string): string[] {
  const separators = [...raw.matchAll(/[.,   ]/gu)].map((match) => match.index!);
  const digitsOnly = raw.replace(/[.,   ]/gu, '');
  if (!separators.length) return [fromInteger(Number(digitsOnly))].filter(Boolean).length ? [normalize({ digits: digitsOnly, exp: 0 })] : [];

  const last = separators[separators.length - 1]!;
  const tail = raw.slice(last + 1);
  const head = raw.slice(0, last).replace(/[.,   ]/gu, '');
  const grouped = normalize({ digits: digitsOnly, exp: 0 });
  const decimal = normalize({ digits: digitsOnly, exp: tail.length });

  // Whitespace never separates a decimal fraction, so a spaced group is always thousands.
  if (/[   ]/u.test(raw[last]!)) return [grouped];
  // More than one separator of the same kind is grouping; a mix means the last one is the decimal point.
  if (separators.length > 1) {
    const chars = new Set(separators.map((index) => raw[index]!));
    return chars.size > 1 ? [decimal] : [grouped];
  }
  if (tail.length !== 3) return [decimal];
  // Exactly one group of three: ambiguous only while the integer part could plausibly be a thousands group.
  return head.length >= 1 && head.length <= 3 ? [grouped, decimal] : [grouped];
}

const scaled = (values: string[], power: number): string[] =>
  values.map((value) => {
    const dot = value.indexOf('.');
    const digits = dot < 0 ? value : value.slice(0, dot) + value.slice(dot + 1);
    const exp = dot < 0 ? 0 : value.length - dot - 1;
    return normalize({ digits, exp: exp - power });
  });

// Indonesian and English number words, enough for the amounts that appear in real prose.
function wordValue(words: string[]): number | null {
  let total = 0; let current = 0; let seen = false;
  for (const word of words) {
    const bare = word.replace(/^ke-?/, '');
    const scale = SCALES[bare];
    const unit = ID_UNITS[bare] ?? EN_UNITS[bare] ?? (EN_ORDINAL.test(bare) ? EN_UNITS[bare.replace(EN_ORDINAL, '$1')] ?? EN_UNITS[bare.replace(EN_ORDINAL, '$1') + 'e'] : undefined);
    if (bare === 'puluh') { current = (current || 1) * 10; seen = true; continue; }
    if (bare === 'ratus' || bare === 'hundred') { current = (current || 1) * 100; seen = true; continue; }
    if (bare === 'belas') { current = (current || 0) + 10; seen = true; continue; }
    if (scale !== undefined && bare.length > 1) { total += (current || 1) * 10 ** scale; current = 0; seen = true; continue; }
    if (unit !== undefined) { current = current && current % 10 === 0 ? current + unit : current * 10 + unit || unit; seen = true; continue; }
    return null;
  }
  return seen ? total + current : null;
}

const WORD = /[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ-]*/gu;
const MAX_WORD_RUN = 4;
const DIGITS = /\d+(?:[.,   ]\d{3})*(?:[.,]\d+)?/gu;
const TRAILING = /^\s*(%|persen|percent|ribu|rb|juta|jt|miliar|milyar|triliun|trilyun|thousand|million|billion|trillion)\b/iu;

// 'digits' tokens are claims that must hold on both sides. 'words' tokens only ever help a value match:
// a spelled-out number in the output proves the figure survived, but prose words are never treated as
// a dropped or a fabricated figure — "one of the reasons" is not a quantity.
export type NumericToken = { raw: string; values: string[]; kind: 'digits' | 'words' };

// Layout, not content: a leading "1." or "2)" marker, and an inline enumeration that really is one
// (at least two markers on the line, counting up from the first). Stripping runs on both sides of the
// comparison, so a number that is a marker in both is simply never compared.
export function stripListMarkers(text: string): string {
  return text.split('\n').map((line) => {
    const withoutLeading = line.replace(/^[ \t]*(?:[-*•]\s*)?\d{1,3}[.)][ \t]+/u, '');
    const markers = [...withoutLeading.matchAll(/(^|\s)(\d{1,2})[.)]([ \t]+)/gu)];
    if (markers.length < 2) return withoutLeading;
    const numbers = markers.map((match) => Number(match[2]));
    const ascending = numbers.every((value, index) => index === 0 || value === numbers[index - 1]! + 1);
    if (!ascending) return withoutLeading;
    return withoutLeading.replace(/(^|\s)\d{1,2}[.)]([ \t]+)/gu, '$1');
  }).join('\n');
}

// Every number in the text, each with the canonical values it could mean.
export function numericValues(text: string): NumericToken[] {
  const clean = stripListMarkers(text);
  const tokens: NumericToken[] = [];

  for (const match of clean.matchAll(DIGITS)) {
    const raw = match[0];
    let values = candidates(raw);
    const after = clean.slice(match.index! + raw.length);
    const suffix = TRAILING.exec(after);
    if (suffix) {
      const word = suffix[1]!.toLowerCase();
      if (word === '%' || word === 'persen' || word === 'percent') values = [...values, ...scaled(values, -2)];
      else values = [...values, ...scaled(values, SCALES[word] ?? 0)];
    }
    if (values.length) tokens.push({ raw, values: [...new Set(values)], kind: 'digits' });
  }

  // Scans from every word, taking the longest run that parses as one number, so a leading
  // non-number word never hides the number behind it.
  const words = [...clean.matchAll(WORD)].map((match) => match[0].toLowerCase());
  for (let index = 0; index < words.length; index++) {
    for (let size = Math.min(MAX_WORD_RUN, words.length - index); size >= 1; size--) {
      const run = words.slice(index, index + size);
      const value = wordValue(run);
      if (value !== null && Number.isFinite(value)) {
        tokens.push({ raw: run.join(' '), values: [fromInteger(value)], kind: 'words' });
        index += size - 1; break;
      }
    }
  }
  return tokens;
}

export type NumericDiff = { dropped: NumericToken[]; invented: NumericToken[] };

// Distinct values only: restating a figure more or fewer times is style, not a changed number.
export function compareNumericValues(original: string, output: string): NumericDiff {
  const before = numericValues(original); const after = numericValues(output);
  const beforeValues = new Set(before.flatMap((token) => token.values));
  const afterValues = new Set(after.flatMap((token) => token.values));
  const unmatched = (tokens: NumericToken[], known: Set<string>) => {
    const seen = new Set<string>();
    return tokens.filter((token) => {
      if (token.kind !== 'digits') return false;
      if (token.values.some((value) => known.has(value))) return false;
      const key = token.values.join('|');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  };
  return { dropped: unmatched(before, afterValues), invented: unmatched(after, beforeValues) };
}
