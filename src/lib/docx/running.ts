// Header and footer text, shared by the page overlay on the canvas and the DOCX writer/reader.
// The text is plain: two tokens stand in for the numbers Word computes while it paginates.

export const PAGE_TOKEN = '{page}';
export const PAGES_TOKEN = '{pages}';
export const MAX_RUNNING_CHARS = 200;

export const RUNNING_ALIGNS = ['left', 'center', 'right'] as const;
export type RunningAlign = (typeof RUNNING_ALIGNS)[number];
export type RunningText = { text: string; align: RunningAlign };

export const asRunningAlign = (value: unknown): RunningAlign =>
  value === 'center' || value === 'right' ? value : 'left';

// Preferences hold primitives, so a blank text means "no header/footer" rather than an empty one.
export function asRunningText(text: unknown, align: unknown): RunningText | null {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, MAX_RUNNING_CHARS);
  return clean ? { text: clean, align: asRunningAlign(align) } : null;
}

export const hasPageToken = (text: string) => text.includes(PAGE_TOKEN) || text.includes(PAGES_TOKEN);

// What the canvas prints on sheet `page` of `pages`; Word fills the same places with PAGE and NUMPAGES fields.
export const renderRunning = (text: string, page: number, pages: number): string =>
  text.split(PAGE_TOKEN).join(String(page)).split(PAGES_TOKEN).join(String(pages));

// The text split around its tokens, so the writer can emit a field where a token stood.
export type RunningPart = { kind: 'text'; value: string } | { kind: 'field'; field: 'PAGE' | 'NUMPAGES' };
export function runningParts(text: string): RunningPart[] {
  const parts: RunningPart[] = [];
  const pattern = /\{page\}|\{pages\}/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > cursor) parts.push({ kind: 'text', value: text.slice(cursor, match.index) });
    parts.push({ kind: 'field', field: match[0] === PAGES_TOKEN ? 'NUMPAGES' : 'PAGE' });
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) });
  return parts;
}
