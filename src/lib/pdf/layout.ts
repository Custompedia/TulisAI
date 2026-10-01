import type { EditorNode } from '../editor/document';

// Rebuilds editor blocks from positioned PDF text. A PDF only says "draw these glyphs here", so paragraphs, headings
// and lists are inferred from geometry: line gaps, indents, font sizes and leading markers. Everything stays plain text.

/** One text run as the PDF reader reports it, in PDF space (origin bottom-left, y grows upwards). */
export type TextRun = { str: string; x: number; y: number; width: number; size: number; eol: boolean };
export type Line = { text: string; x: number; right: number; y: number; size: number; page: number };

// Ligatures and the private-use bullet that Word's Symbol font writes; NUL and other controls never belong in text.
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', '': '•', '': '▪', '': '•', '': '•' };
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�]/gu;
const clean = (text: string) => text.replace(/[ﬀ-ﬆ]/gu, (char) => LIGATURES[char] ?? char).replace(CONTROL, '').replace(/[\t  -  　]/gu, ' ');

const round = (value: number, step: number) => Math.round(value / step) * step;
const median = (values: number[]) => { if (!values.length) return NaN; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]!; };
// The value covering the most characters, so a long body outweighs many short labels.
function weightedMode(entries: Array<[number, number]>): number {
  const weights = new Map<number, number>();
  for (const [value, weight] of entries) weights.set(value, (weights.get(value) ?? 0) + weight);
  let best = NaN; let bestWeight = -1;
  for (const [value, weight] of weights) if (weight > bestWeight || (weight === bestWeight && value < best)) { best = value; bestWeight = weight; }
  return best;
}

/** Groups a page's runs into visual lines: same baseline, read in the order the file draws them. */
export function linesFromRuns(runs: TextRun[], page: number): Line[] {
  const lines: Line[] = [];
  let current: (Line & { weights: Array<[number, number]> }) | null = null;
  const close = () => {
    if (current) {
      const text = current.text.replace(/ {2,}/gu, ' ').trim();
      if (text) lines.push({ text, x: current.x, right: current.right, y: current.y, size: weightedMode(current.weights), page });
    }
    current = null;
  };
  for (const run of runs) {
    const str = clean(run.str);
    const size = Math.abs(run.size) || 1;
    if (str.trim()) {
      if (current && Math.abs(run.y - current.y) > Math.max(current.size, size) * 0.5) close();
      if (!current) current = { text: '', x: run.x, right: run.x, y: run.y, size, page, weights: [] };
      else {
        // A visible gap between two runs is a word space the file drew as positioning rather than as a character.
        const gap = run.x - current.right;
        if (gap > size * 0.15 && !current.text.endsWith(' ') && !str.startsWith(' ')) current.text += ' ';
      }
      current.text += str;
      current.x = Math.min(current.x, run.x);
      current.right = Math.max(current.right, run.x + Math.max(0, run.width));
      current.weights.push([round(size, 0.5), str.trim().length]);
    }
    if (run.eol) close();
  }
  close();
  return lines;
}

// A running header or footer is the same text in the same band of nearly every page; digits are ignored so
// "Halaman 3 dari 12" on page 3 matches its twin on page 4.
const runningKey = (text: string) => text.toLowerCase().replace(/\d+/gu, '#').replace(/\b[ivxlcdm]+\b/gu, (word) => (/^m{0,3}(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/u.test(word) ? '#' : word)).replace(/\s+/gu, ' ').trim();
const PAGE_NUMBER = /^(?:(?:page|halaman|hal\.?|p\.)\s*)?[-–—]?\s*#\s*[-–—]?(?:\s*(?:of|dari|\/)\s*#)?$/u;
const EDGE_LINES = 2;
// Running lines sit in the page margins: the outer eighth of the sheet at the top or the bottom.
const EDGE_BAND = 0.125;

/**
 * Removes lines that repeat at the top or bottom of most pages (running heads, footers, page numbers).
 * `heights` is each page's height in points, so only lines in the outer bands count.
 */
export function dropRunningLines(pages: Line[][], heights: number[]): { pages: Line[][]; dropped: number } {
  const withText = pages.filter((lines) => lines.length);
  if (withText.length < 2) return { pages, dropped: 0 };
  const edges = (lines: Line[]) => {
    const height = heights[pages.indexOf(lines)] ?? 0;
    const sorted = [...lines].sort((a, b) => b.y - a.y);
    return [
      ...sorted.slice(0, EDGE_LINES).filter((line) => height > 0 && line.y >= height * (1 - EDGE_BAND)).map((line) => ({ line, zone: 'top' })),
      ...sorted.slice(-EDGE_LINES).filter((line) => height > 0 && line.y <= height * EDGE_BAND).map((line) => ({ line, zone: 'bottom' })),
    ];
  };
  const seen = new Map<string, number>();
  for (const lines of withText) {
    const keys = new Set(edges(lines).map(({ line, zone }) => `${zone}:${runningKey(line.text)}`));
    for (const key of keys) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const needed = (key: string) => Math.max(2, Math.ceil(withText.length * (PAGE_NUMBER.test(key.slice(key.indexOf(':') + 1)) ? 0.5 : 0.75)));
  let dropped = 0;
  const kept = pages.map((lines) => {
    const running = new Set(edges(lines).filter(({ line, zone }) => { const key = `${zone}:${runningKey(line.text)}`; return (seen.get(key) ?? 0) >= needed(key); }).map(({ line }) => line));
    dropped += running.size;
    return lines.filter((line) => !running.has(line));
  });
  return { pages: kept, dropped };
}

const BULLET = /^(?:[•●▪◦·○■□➢►▸‣⁃]\s*|[-–*]\s+)(?=\S)/u;
const ORDERED = /^(\d{1,3})[.)]\s+(?=\S)/u;
const TERMINAL = /[.!?:;]["'”’)\]]*$/u;
const LOWER_START = /^[\p{Ll}]/u;

type Kind = 'paragraph' | 'heading' | 'bullet' | 'ordered';
type Block = { kind: Kind; text: string; size: number; x: number; number?: number };

// Line breaks inside a paragraph become spaces. A soft hyphen at a break is the typesetter's and goes; a hard
// hyphen stays, because Indonesian reduplication ("anak-anak") and English compounds break there as often as words do.
function joinLine(text: string, next: string): string {
  if (text.endsWith('­')) return text.slice(0, -1) + next;
  if (/\p{L}-$/u.test(text) && /^\p{L}/u.test(next)) return text + next;
  return text.endsWith(' ') ? text + next : `${text} ${next}`;
}

/** Turns the lines of the whole document, in reading order, into editor blocks. */
export function blocksFromLines(lines: Line[]): EditorNode[] {
  if (!lines.length) return [];
  const body = weightedMode(lines.map((line) => [round(line.size, 0.5), line.text.length]));
  const isHeading = (line: Line) => line.size >= body * 1.15 && line.size - body >= 1 && line.text.length <= 200 && /\p{L}/u.test(line.text);

  // The usual distance between two lines of one paragraph, measured on body text only.
  const gaps: number[] = [];
  for (let index = 1; index < lines.length; index++) {
    const previous = lines[index - 1]!; const line = lines[index]!;
    const gap = previous.y - line.y;
    if (line.page === previous.page && Math.abs(line.size - body) < 0.6 && Math.abs(previous.size - body) < 0.6 && gap > 0 && gap < body * 3) gaps.push(gap);
  }
  const lineGap = median(gaps.length ? gaps : [body * 1.2]);
  // The left margin and the right edge of the text block, per page because odd and even pages may differ.
  const margins = new Map<number, { left: number; right: number }>();
  for (const page of new Set(lines.map((line) => line.page))) {
    const own = lines.filter((line) => line.page === page && Math.abs(line.size - body) < 0.6);
    const pool = own.length ? own : lines.filter((line) => line.page === page);
    margins.set(page, { left: weightedMode(pool.map((line) => [round(line.x, 1), line.text.length])), right: Math.max(...pool.map((line) => line.right)) });
  }

  const blocks: Block[] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    const heading = isHeading(line);
    const bullet = !heading ? BULLET.exec(line.text) : null;
    const ordered = !heading && !bullet ? ORDERED.exec(line.text) : null;
    const block = blocks[blocks.length - 1];
    const margin = margins.get(line.page)!;

    let continues = false;
    if (block && previous && !bullet && !ordered) {
      const samePage = previous.page === line.page;
      const gap = previous.y - line.y;
      const flows = samePage && gap > 0;
      // A paragraph runs on over a page or column break only mid-sentence.
      const runsOn = !TERMINAL.test(previous.text) && LOWER_START.test(line.text);
      if (block.kind === 'heading') continues = heading && Math.abs(line.size - block.size) < 0.6 && flows && gap <= line.size * 1.6;
      else if (heading) continues = false;
      else if (!flows) continues = runsOn;
      else if (gap > lineGap * 1.35 + 1) continues = false;
      else if (block.kind === 'bullet' || block.kind === 'ordered') continues = line.x > block.x + line.size * 0.3 || runsOn;
      else {
        const indented = line.x > margin.left + line.size * 0.8 && line.x < margin.left + line.size * 8 && previous.x <= margin.left + 2;
        const endedShort = TERMINAL.test(previous.text) && margin.right - previous.right > line.size * 5;
        continues = !indented && !endedShort;
      }
    }

    if (continues && block) block.text = joinLine(block.text, line.text);
    else if (bullet) blocks.push({ kind: 'bullet', text: line.text.slice(bullet[0].length), size: line.size, x: line.x });
    else if (ordered) blocks.push({ kind: 'ordered', text: line.text.slice(ordered[0].length), size: line.size, x: line.x, number: Number(ordered[1]) });
    else blocks.push({ kind: heading ? 'heading' : 'paragraph', text: line.text, size: line.size, x: line.x });
    previous = line;
  }

  // The largest heading size is level 1, the next level 2, anything smaller level 3.
  const headingSizes = [...new Set(blocks.filter((block) => block.kind === 'heading').map((block) => round(block.size, 0.5)))].sort((a, b) => b - a);
  const levelOf = (size: number) => Math.min(3, headingSizes.indexOf(round(size, 0.5)) + 1);

  const output: EditorNode[] = [];
  let list: EditorNode | null = null;
  const MAX_LIST_ITEMS = 4000;
  for (const block of blocks) {
    const text = block.text.replace(/\s+/gu, ' ').trim();
    if (!text) continue;
    const content: EditorNode[] = [{ type: 'text', text }];
    if (block.kind === 'bullet' || block.kind === 'ordered') {
      const type = block.kind === 'bullet' ? 'bulletList' : 'orderedList';
      if (!list || list.type !== type || list.content!.length >= MAX_LIST_ITEMS) {
        list = { type, ...(type === 'orderedList' && block.number !== undefined && block.number !== 1 ? { attrs: { start: block.number } } : {}), content: [] };
        output.push(list);
      }
      list.content!.push({ type: 'listItem', content: [{ type: 'paragraph', content }] });
      continue;
    }
    list = null;
    output.push(block.kind === 'heading' ? { type: 'heading', attrs: { level: levelOf(block.size) }, content } : { type: 'paragraph', content });
  }
  return output;
}
