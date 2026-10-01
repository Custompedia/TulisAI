import { describe, expect, it } from 'vitest';
import { planPages, type PageBlock } from '../../src/lib/editor/extensions/pagination';

// The paged canvas paginates like Word: paragraphs split between sheets at line boundaries with widow and orphan
// control (two lines at least on each side), and headings stay with the block that follows them.
const sheet = { height: 1000, top: 100, bottom: 100, gutter: 20 };
const stride = 1020; const body = 800;
const block = (height: number, extra: Partial<PageBlock> = {}): PageBlock => ({ height, gap: 0, marginTop: 0, marginBottom: 0, breakBefore: false, pageBreak: false, ...extra });
const paragraph = (lines: number, pitch = 20) => block(lines * pitch, { lines: { count: lines, pitch, offset: 0 } });

describe('review: paragraphs split between pages', () => {
  it('fills the page and carries the rest of the paragraph to the next sheet', () => {
    const plan = planPages([block(700), paragraph(10)], sheet);
    expect(plan.gaps).toEqual([]);
    // 100 px left = 5 lines of 20 px; line 5 starts the next sheet's text area.
    expect(plan.splits).toEqual([{ index: 1, line: 5, height: stride - (700 + 5 * 20), band: stride - sheet.top - sheet.gutter - (700 + 5 * 20) }]);
    expect(plan.pages).toBe(2);
    expect(plan.filler).toBe(body - 5 * 20);
  });

  it('never leaves one line alone at the foot of a page (orphan): the paragraph moves whole', () => {
    const plan = planPages([block(790), paragraph(10)], sheet);
    expect(plan.splits).toEqual([]);
    expect(plan.gaps.map((gap) => gap.index)).toEqual([1]);
  });

  it('never carries one line alone to the next page (widow): one more line goes with it', () => {
    const plan = planPages([block(620), paragraph(10)], sheet);
    // 9 lines would fit; keeping two on the next page splits after line 8.
    expect(plan.splits.map((split) => split.line)).toEqual([8]);
  });

  it('splits a paragraph longer than a page more than once', () => {
    const plan = planPages([paragraph(100)], sheet);
    expect(plan.splits.map((split) => split.line)).toEqual([40, 80]);
    expect(plan.pages).toBe(3);
    for (const split of plan.splits) expect(split.height).toBeGreaterThan(0);
  });

  it('only splits paragraphs with a uniform line grid; other blocks still move whole', () => {
    const plan = planPages([block(700), block(200)], sheet);
    expect(plan.splits).toEqual([]);
    expect(plan.gaps.map((gap) => gap.index)).toEqual([1]);
  });

  it('evaluates the line grid only when a paragraph has to be split', () => {
    let asked = 0;
    const lazy = (lines: number) => block(lines * 20, { lines: () => { asked++; return { count: lines, pitch: 20, offset: 0 }; } });
    planPages([lazy(5), lazy(5), lazy(30), lazy(10)], sheet);
    expect(asked).toBe(1);
  });
});

describe('review: headings stay with the next block', () => {
  it('moves a heading at the foot of a page to the next page with the block that follows', () => {
    const plan = planPages([block(740), block(30, { keepNext: true }), block(100)], sheet);
    expect(plan.gaps.map((gap) => gap.index)).toEqual([1]);
    expect(plan.pages).toBe(2);
  });

  it('keeps a heading in place when the next paragraph can start on the same page', () => {
    const plan = planPages([block(700), block(30, { keepNext: true }), paragraph(10)], sheet);
    expect(plan.gaps).toEqual([]);
    expect(plan.splits).toEqual([{ index: 2, line: 3, height: expect.any(Number), band: expect.any(Number) }]);
  });

  it('does not move a heading that already starts its page', () => {
    const plan = planPages([block(100), block(0, { pageBreak: true }), block(30, { keepNext: true, breakBefore: true }), block(900)], sheet);
    expect(plan.gaps.map((gap) => gap.index)).toEqual([2, 3]);
  });
});
