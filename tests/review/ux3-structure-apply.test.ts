import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { createDocument, getDocument } from '@/server/documents/service';
import { applyPreview, generatePreview, keepsStructure } from '@/server/ai/service';
import { documentText, replaceBlocksKeepingStructure } from '@/lib/editor/document';
import { defaults, runtimeControls } from '@/lib/writing/settings';
import { EditorDocumentSchema } from '@/lib/contracts';

let db: DatabaseSync;
beforeEach(() => { const made = testEnv(); db = made.db; state.env = made.env; made.addUser('owner-a'); });
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const para = (value: string, attrs?: Record<string, unknown>) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [text(value)] });
const heading = (value: string, level = 2) => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const cell = (type: string, value: string) => ({ type, content: [para(value)] });
const structured = EditorDocumentSchema.parse({ type: 'doc', content: [
  heading('Latar belakang'),
  para('Kalimat pembuka yang cukup panjang.', { textAlign: 'center' }),
  { type: 'bulletList', content: [{ type: 'listItem', content: [para('Poin pertama di sini.')] }, { type: 'listItem', content: [para('Poin kedua di sini.')] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'Kolom'), cell('tableHeader', 'Nilai')] }, { type: 'tableRow', content: [cell('tableCell', 'Biaya'), cell('tableCell', 'Rendah')] }] },
  { type: 'paragraph', content: [text('Penutup ', [{ type: 'bold' }]), text('tebal.', [{ type: 'bold' }])] },
] });
const full = documentText(structured);

describe('UX 3: whole-document apply keeps the structure', () => {
  it('replaces text block by block and keeps headings, lists, tables, attributes and untouched marks', () => {
    const output = ['Latar belakang', 'Kalimat awal yang cukup panjang.', '- Poin satu di sini.', 'Poin dua di sini.', 'Kolom | Nilai', '| Ongkos | Rendah |', 'Penutup tebal.'].join('\n');
    const result = replaceBlocksKeepingStructure(structured, 0, full.length, output);
    expect(result.structured).toBe(true);
    const content = result.content!.content;
    expect(content.map((node) => node.type)).toEqual(['heading', 'paragraph', 'bulletList', 'table', 'paragraph']);
    expect(content[0]).toEqual(structured.content[0]);
    expect(content[1]).toMatchObject({ attrs: { textAlign: 'center' }, content: [{ text: 'Kalimat awal yang cukup panjang.' }] });
    expect(documentText(result.content)).toBe('Latar belakang\nKalimat awal yang cukup panjang.\nPoin satu di sini.\nPoin dua di sini.\nKolom | Nilai\nOngkos | Rendah\nPenutup tebal.');
    // The unchanged last line keeps its bold marks exactly as stored.
    expect(content[4]).toEqual(structured.content[4]);
  });

  it('refuses to line up when a line was merged or dropped, and says whether structure was at stake', () => {
    expect(replaceBlocksKeepingStructure(structured, 0, full.length, 'Latar belakang\nSatu paragraf saja.')).toEqual({ content: null, structured: true });
    const plain = EditorDocumentSchema.parse({ type: 'doc', content: [para('Satu.'), para('Dua.')] });
    expect(replaceBlocksKeepingStructure(plain, 0, 9, 'Satu dua.')).toEqual({ content: null, structured: false });
    // A row whose cell count changed cannot go back into its cells.
    expect(replaceBlocksKeepingStructure(structured, 0, full.length, full.replace('Biaya | Rendah', 'Biaya rendah')).content).toBeNull();
  });

  it('is used only for P01–P06 over several blocks without a requested shape', () => {
    expect(keepsStructure('P01_STANDARD_REWRITE', {}, true)).toBe(true);
    expect(keepsStructure('P03_HUMANIZER', { request: { format: 'paragraf', focus: [], additional_instruction: '' } }, true)).toBe(true);
    expect(keepsStructure('P01_STANDARD_REWRITE', { request: { format: 'poin', focus: [], additional_instruction: '' } }, true)).toBe(false);
    expect(keepsStructure('P01_STANDARD_REWRITE', {}, false)).toBe(false);
    expect(keepsStructure('P08_CUSTOM_TRANSFORM', {}, true)).toBe(false);
    expect(keepsStructure('P07_INLINE_ALTERNATIVES', {}, true)).toBe(false);
  });
});

const reply = (output: unknown) => Response.json({ id: 'p', choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: {} });
const transform = (value: string) => ({ transformed_text: value, change_categories: [], warnings: [], no_change_needed: false });
const runP01 = (documentId: string, source: string) => generatePreview('owner-a', `key-${Math.random()}`, { documentId, promptId: 'P01_STANDARD_REWRITE', source: { text: source }, runtime: runtimeControls({ ...defaults, mode: 'standard', language: 'id' }, 'id'), expectedRevision: 0 });

describe('UX 3: Seluruh dokumen end to end', () => {
  it('applies a line-for-line rewrite of a structured notebook without flattening it', async () => {
    const created = await createDocument('owner-a', { title: 'S', language: 'id', content: structured });
    vi.stubGlobal('fetch', vi.fn(async () => reply(transform(full.replace('Kalimat pembuka', 'Kalimat awal').replace('Poin kedua', 'Poin lain')))));
    const preview = await runP01(created.id, full);
    expect(preview.output.warnings ?? []).not.toContain('Jumlah baris hasil berbeda, jadi judul, daftar, dan tabel akan menjadi paragraf biasa.');
    await applyPreview('owner-a', preview.id, 0);
    const saved = (await getDocument('owner-a', created.id)).content;
    expect(saved.content.map((node) => node.type)).toEqual(['heading', 'paragraph', 'bulletList', 'table', 'paragraph']);
    expect(documentText(saved)).toContain('Poin lain di sini.');
  });

  it('warns in the preview, then falls back to paragraphs, when the lines no longer line up', async () => {
    const created = await createDocument('owner-a', { title: 'S', language: 'id', content: structured });
    const merged = full.replace('Kalimat pembuka yang cukup panjang.\n', '');
    vi.stubGlobal('fetch', vi.fn(async () => reply(transform(merged))));
    const preview = await runP01(created.id, full);
    expect(preview.output.warnings).toContain('Jumlah baris hasil berbeda, jadi judul, daftar, dan tabel akan menjadi paragraf biasa.');
    await applyPreview('owner-a', preview.id, 0);
    expect((await getDocument('owner-a', created.id)).content.content.every((node) => node.type === 'paragraph')).toBe(true);
  });
});
