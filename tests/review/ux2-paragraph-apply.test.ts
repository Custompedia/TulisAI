import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { createDocument, getDocument } from '@/server/documents/service';
import { applyFormat, applyPreview, generatePreview } from '@/server/ai/service';
import { crossesBlocks, documentText } from '@/lib/editor/document';
import { defaults, runtimeControls } from '@/lib/writing/settings';
import { EditorDocumentSchema } from '@/lib/contracts';
import { sectionBodyAt } from '@/components/workspace/editor-rules';

let db: DatabaseSync;
beforeEach(() => { const made = testEnv(); db = made.db; state.env = made.env; made.addUser('owner-a'); });
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => EditorDocumentSchema.parse({ type: 'doc', content });
const reply = (output: unknown) => Response.json({ id: 'p', choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const transform = (text: string) => ({ transformed_text: text, change_categories: [], warnings: [], no_change_needed: false });
const always = (output: unknown) => vi.stubGlobal('fetch', vi.fn(async () => reply(output)));
const runP01 = (documentId: string, revision: number, text: string, anchor: { from: number; to: number }) =>
  generatePreview('owner-a', `key-${Math.random()}`, { documentId, promptId: 'P01_STANDARD_REWRITE', source: { text, anchor }, runtime: runtimeControls({ ...defaults, mode: 'standard', language: 'id' }, 'id'), expectedRevision: revision });

describe('UX 2: multi-paragraph apply keeps paragraphs for P01–P06', () => {
  it('applies a two-paragraph rewrite as two paragraphs, with the heading untouched', async () => {
    const content = doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Latar belakang' }] }, para('Kalimat pertama yang cukup panjang.'), para('Kalimat kedua yang juga panjang.'));
    const created = await createDocument('owner-a', { title: 'P', language: 'id', content });
    const full = documentText(created.content);
    const from = full.indexOf('Kalimat pertama'); const to = full.length;
    always(transform('Kalimat awal yang cukup panjang.\n\nKalimat berikutnya yang juga panjang.'));
    const preview = await runP01(created.id, created.revision, full.slice(from, to), { from, to });
    const applied = await applyPreview('owner-a', preview.id, created.revision);
    const blocks = (await getDocument('owner-a', created.id)).content.content;
    expect(applied.revision).toBe(created.revision + 1);
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(JSON.stringify(blocks)).not.toContain('hardBreak');
    expect(documentText({ type: 'doc', content: blocks })).toBe('Latar belakang\nKalimat awal yang cukup panjang.\nKalimat berikutnya yang juga panjang.');
  });

  it('keeps hard line breaks inside a single paragraph', async () => {
    const content = doc({ type: 'paragraph', content: [{ type: 'text', text: 'Baris satu puisi ini' }, { type: 'hardBreak' }, { type: 'text', text: 'baris dua puisi ini' }] }, para('Paragraf lain di bawahnya.'));
    const created = await createDocument('owner-a', { title: 'P', language: 'id', content });
    const full = documentText(created.content);
    always(transform('Baris satu sajak ini\nbaris dua sajak ini'));
    const end = full.indexOf('\nParagraf');
    const preview = await runP01(created.id, created.revision, full.slice(0, end), { from: 0, to: end });
    await applyPreview('owner-a', preview.id, created.revision);
    const blocks = (await getDocument('owner-a', created.id)).content.content;
    expect(blocks).toHaveLength(2);
    expect(JSON.stringify(blocks)).toContain('hardBreak');
  });

  it('still refuses a multi-paragraph result that changes a number', async () => {
    const content = doc(para('Kami punya 10 gudang di kota.'), para('Semua gudang aktif setiap hari.'));
    const created = await createDocument('owner-a', { title: 'P', language: 'id', content });
    const full = documentText(created.content);
    always(transform('Kami punya 12 gudang di kota.\nSemua gudang aktif tiap hari.'));
    await expect(runP01(created.id, created.revision, full, { from: 0, to: full.length })).rejects.toMatchObject({ code: 'AI_NUMBER_REJECTED' });
  });

  it('chooses the format from the request, the paragraphs spanned and the output', () => {
    const controls = { language: 'id' } as never;
    expect(applyFormat('P02_ACADEMIC', 'a\nb', 'x\ny', controls, true)).toBe('paragraph');
    expect(applyFormat('P03_HUMANIZER', 'a', 'x\ny', controls, false)).toBe('paragraph');
    expect(applyFormat('P04_PROFESSIONAL', 'a\nb', 'x\ny', controls, false)).toBeUndefined();
    expect(applyFormat('P05_CREATIVE', 'a', 'x', controls, false)).toBeUndefined();
    expect(applyFormat('P08_CUSTOM_TRANSFORM', 'a', '1. x\n2. y\n3. z', controls, false)).toBe('paragraph');
    expect(applyFormat('P07_INLINE_ALTERNATIVES', 'a\nb', 'x\ny', controls, true)).toBeUndefined();
    expect(applyFormat('P01_STANDARD_REWRITE', 'a\nb', '- x\n- y', { language: 'id', request: { format: 'poin' } } as never, true)).toBe('bullets');
  });

  it('tells a paragraph boundary from a hard break', () => {
    const two = doc(para('Satu.'), para('Dua.'));
    expect(crossesBlocks(two, 0, 10)).toBe(true);
    expect(crossesBlocks(two, 0, 5)).toBe(false);
    const broken = doc({ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hardBreak' }, { type: 'text', text: 'B' }] });
    expect(crossesBlocks(broken, 0, 3)).toBe(false);
  });
});

describe('UX 2: "Bagian ini" is the text between headings', () => {
  const blocks = [
    { type: 'paragraph', text: 'Pembuka', pos: 0, size: 9 },
    { type: 'heading', text: 'Bab 1', pos: 9, size: 7 },
    { type: 'paragraph', text: 'Isi satu', pos: 16, size: 10 },
    { type: 'paragraph', text: 'Isi dua', pos: 26, size: 9 },
    { type: 'heading', text: 'Bab 2', pos: 35, size: 7 },
    { type: 'heading', text: 'Sub 2.1', pos: 42, size: 9 },
    { type: 'paragraph', text: 'Isi tiga', pos: 51, size: 10 },
  ];
  it('takes the run under the caret, never a heading', () => {
    expect(sectionBodyAt(blocks, 20)).toEqual({ from: 17, to: 34, heading: 'Bab 1', next: 52 });
    expect(sectionBodyAt(blocks, 10)).toEqual({ from: 17, to: 34, heading: 'Bab 1', next: 52 });
    expect(sectionBodyAt(blocks, 3)).toEqual({ from: 1, to: 8, heading: null, next: 17 });
  });
  it('is empty for a heading with only a subheading under it, and has no next at the end', () => {
    expect(sectionBodyAt(blocks, 37)).toBeNull();
    expect(sectionBodyAt(blocks, 55)).toEqual({ from: 52, to: 60, heading: 'Sub 2.1', next: null });
  });
});
