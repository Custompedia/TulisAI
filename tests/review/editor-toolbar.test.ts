import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { documentSchema } from '../../src/lib/editor/extensions';
import { findMatches, replaceAll, replaceCurrent, searchPlugin, searchState, setSearch, stepSearch } from '../../src/lib/editor/extensions/search';
import { planPages, type PageBlock } from '../../src/lib/editor/extensions/pagination';
import { clampFontSize, lengthToPoints, lineHeightFor, lineMultiple, normalizeColor, normalizeLink, paragraphSpacing, primaryFamily } from '../../src/components/workspace/toolbar/formatting';
import { parseZoom } from '../../src/components/workspace/toolbar/zoom';

const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string) => ({ type: 'text', text: value });
const doc = (...content: unknown[]) => documentSchema.nodeFromJSON({ type: 'doc', content });

// Just enough of an EditorView for the search helpers: state, dispatch and a DOM with no current match.
function view(document: ReturnType<typeof doc>) {
  const fake = { state: EditorState.create({ doc: document, plugins: [searchPlugin()] }), dom: { querySelector: () => null }, dispatch(tr: Transaction) { fake.state = fake.state.apply(tr); } };
  return fake as unknown as EditorView & { state: EditorState };
}

describe('review: find and replace', () => {
  it('finds every match with positions that point at the matched text', () => {
    const document = doc(paragraph(text('Kucing dan kucing')), paragraph(text('KUCING')));
    const matches = findMatches(document, 'kucing', false);
    expect(matches).toHaveLength(3);
    for (const match of matches) expect(document.textBetween(match.from, match.to).toLowerCase()).toBe('kucing');
    expect(findMatches(document, 'kucing', true)).toHaveLength(1);
  });

  it('keeps offsets aligned across inline atoms and never matches across blocks', () => {
    const document = doc(paragraph(text('ab'), { type: 'hardBreak' }, text('ab')), paragraph(text('a')), paragraph(text('b')));
    const matches = findMatches(document, 'ab', false);
    expect(matches.map((match) => document.textBetween(match.from, match.to))).toEqual(['ab', 'ab']);
    expect(findMatches(document, 'a b', false)).toHaveLength(0);
  });

  it('steps through matches and wraps around', () => {
    const editor = view(doc(paragraph(text('satu satu satu'))));
    setSearch(editor, 'satu', false);
    expect(searchState(editor.state).index).toBe(0);
    stepSearch(editor, -1);
    expect(searchState(editor.state).index).toBe(2);
    stepSearch(editor, 1);
    expect(searchState(editor.state).index).toBe(0);
  });

  it('replaces the current match and moves past the inserted text', () => {
    const editor = view(doc(paragraph(text('a a a'))));
    setSearch(editor, 'a', false);
    replaceCurrent(editor, 'aa');
    expect(editor.state.doc.textContent).toBe('aa a a');
    // The inserted "aa" is skipped: the next match is the second original "a".
    expect(searchState(editor.state).index).toBe(2);
  });

  it('replaces all matches in one transaction, keeping their marks', () => {
    const bold = { type: 'text', text: 'lama', marks: [{ type: 'bold' }] };
    const editor = view(doc(paragraph(text('lama '), bold, text(' lama'))));
    setSearch(editor, 'LAMA', false);
    let transactions = 0; const dispatch = editor.dispatch.bind(editor);
    editor.dispatch = (tr) => { transactions++; dispatch(tr); };
    expect(replaceAll(editor, 'baru')).toBe(3);
    expect(transactions).toBe(1);
    expect(editor.state.doc.textContent).toBe('baru baru baru');
    expect(editor.state.doc.firstChild?.child(1).marks.map((mark) => mark.type.name)).toEqual(['bold']);
    expect(searchState(editor.state).matches).toHaveLength(0);
  });

  it('deletes matches when the replacement is empty', () => {
    const editor = view(doc(paragraph(text('x-y-z'))));
    setSearch(editor, '-', false);
    replaceAll(editor, '');
    expect(editor.state.doc.textContent).toBe('xyz');
  });
});

const sheet = { height: 1000, top: 100, bottom: 100, gutter: 20 };
const block = (height: number, extra: Partial<PageBlock> = {}): PageBlock => ({ height, gap: 0, marginTop: 0, marginBottom: 0, breakBefore: false, pageBreak: false, ...extra });

describe('review: page layout', () => {
  it('keeps content that fits on one page and fills the rest of the sheet', () => {
    const plan = planPages([block(300), block(300)], sheet);
    expect(plan.gaps).toEqual([]);
    expect(plan.pages).toBe(1);
    expect(plan.filler).toBe(200);
  });

  it('moves the block that overflows to the next page top margin', () => {
    const plan = planPages([block(500), block(200), block(200)], sheet);
    expect(plan.pages).toBe(2);
    expect(plan.gaps).toHaveLength(1);
    const [gap] = plan.gaps;
    expect(gap!.index).toBe(2);
    // Content ends at 700; the next page's content starts at one stride (1020) down.
    expect(700 + gap!.height).toBe(1020);
    // The grey band starts where the first sheet ends: its bottom margin below the content area.
    expect(700 + gap!.band).toBe(900);
  });

  it('accounts for margins: the spacer sits after the previous margin and before the next', () => {
    const plan = planPages([block(700, { marginBottom: 10 }), block(150, { gap: 10, marginTop: 5 })], sheet);
    const [gap] = plan.gaps;
    expect(710 + gap!.height + 5).toBe(1020);
  });

  it('starts a new page after a page break, even with room left', () => {
    const plan = planPages([block(100), block(0, { pageBreak: true }), block(100, { breakBefore: true })], sheet);
    expect(plan.gaps.map((gap) => gap.index)).toEqual([2]);
    expect(plan.pages).toBe(2);
  });

  it('lets a block taller than a page run on and resumes on the sheet where it ends', () => {
    const plan = planPages([block(100), block(1300), block(50), block(700)], sheet);
    // The tall block starts page 2 and ends on page 3, where the short block still fits; the last one moves to page 4.
    expect(plan.gaps.map((gap) => gap.index)).toEqual([1, 3]);
    expect(plan.pages).toBe(4);
    for (const gap of plan.gaps) { expect(gap.height).toBeGreaterThanOrEqual(0); expect(gap.band).toBeGreaterThanOrEqual(0); }
  });
});

describe('review: toolbar values', () => {
  it('converts any CSS length to points', () => {
    expect(lengthToPoints('12pt')).toBe(12);
    expect(lengthToPoints('16px')).toBe(12);
    expect(lengthToPoints('0.5in')).toBe(36);
    expect(lengthToPoints('wide')).toBeNull();
    expect(clampFontSize(0)).toBe(1);
    expect(clampFontSize(11.3)).toBe(11.5);
  });

  it('reads the first family of a pasted font stack', () => {
    expect(primaryFamily("'Times New Roman', Times, serif")).toBe('Times New Roman');
    expect(primaryFamily('Arial,sans-serif')).toBe('Arial');
  });

  it('round-trips line spacing multiples through CSS line-height', () => {
    for (const multiple of [1, 1.15, 1.5, 2]) expect(lineMultiple(lineHeightFor(multiple))).toBeCloseTo(multiple, 2);
    expect(lineMultiple(null)).toBeNull();
  });

  it('accepts only http and https links', () => {
    expect(normalizeLink('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeLink('example.com')).toBe('https://example.com/');
    expect(normalizeLink('javascript:alert(1)')).toBeNull();
    expect(normalizeLink('mailto:a@b.c')).toBeNull();
    expect(normalizeLink('not a link')).toBeNull();
  });

  it('falls back to 100% for unknown stored zoom', () => {
    expect(parseZoom('150')).toBe(150);
    expect(parseZoom('fit')).toBe('fit');
    expect(parseZoom('37')).toBe(100);
    expect(parseZoom(null)).toBe(100);
  });
});

describe('review: toolbar colours', () => {
  it('normalises stored colours so the palette swatch is checked', () => {
    expect(normalizeColor('#FF0000')).toBe('#ff0000');
    expect(normalizeColor('#F00')).toBe('#ff0000');
    expect(normalizeColor('rgb(255, 242, 204)')).toBe('#fff2cc');
    expect(normalizeColor('rgba(74,134,232,1)')).toBe('#4a86e8');
    expect(normalizeColor('rgb(0 0 0 / 50%)')).toBe('#000000');
    expect(normalizeColor('#ffff00ff')).toBe('#ffff00');
  });

  it('treats missing and fully transparent colours as none', () => {
    for (const value of [null, undefined, '', 'transparent', 'rgba(0, 0, 0, 0)', '#ffffff00']) expect(normalizeColor(value)).toBeNull();
  });
});

describe('review: paragraph spacing defaults', () => {
  const at = (document: ReturnType<typeof doc>, pos: number) => ({ state: EditorState.create({ doc: document, selection: TextSelection.create(document, pos) }) });

  it('reads Normal paragraphs as 8 pt after and nothing before', () => {
    const spacing = paragraphSpacing(at(doc(paragraph(text('a'))), 1));
    expect(spacing).toMatchObject({ before: 0, after: 8, baseBefore: 0, baseAfter: 8 });
  });

  it('gives headings their built-in space before and none after, so remove and add toggle for real', () => {
    const heading = { type: 'heading', attrs: { level: 1 }, content: [text('H')] };
    expect(paragraphSpacing(at(doc(heading), 1))).toMatchObject({ before: 12, after: 0, baseBefore: 12, baseAfter: 0 });
    const cleared = { ...heading, attrs: { level: 1, spaceBefore: '0pt' } };
    expect(paragraphSpacing(at(doc(cleared), 1)).before).toBe(0);
  });

  it('gives nested paragraphs no default space after', () => {
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('item'))] }] };
    expect(paragraphSpacing(at(doc(list), 3))).toMatchObject({ after: 0, baseAfter: 0 });
  });
});
