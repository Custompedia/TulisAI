import { appendFileSync, mkdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnv } from '../helpers/d1';
import { thesisDocx } from '../helpers/docx';

// The owner's request: "docs gagal karena terlalu panjang, pastikan berapapun panjangnya bisa masuk". A 1,500-page
// thesis (6,000,000 characters, pictures, every kind of page break) goes through the real routes against an
// in-memory D1 and R2: import, create (the request that used to answer 413), autosave, version, export.
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown>, user: 'pro' }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));
vi.mock('@/server/auth/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/auth/auth')>()), requireUser: async () => ({ id: state.user }) }));

import { POST as importRoute } from '@/app/api/documents/import/route';
import { POST as createRoute } from '@/app/api/documents/route';
import { POST as autosaveRoute } from '@/app/api/documents/[id]/autosave/route';
import { GET as exportRoute } from '@/app/api/documents/[id]/export/route';
import { adminActivatePlan } from '@/server/access/periods';
import { createCheckpoint, getDocument } from '@/server/documents/service';
import { docxToEditorDocument } from '@/lib/docx/import';
import { jsonDocumentTextLength } from '@/lib/editor/validate';
import type { EditorDocument } from '@/lib/contracts';

let setup: ReturnType<typeof testEnv>;
beforeEach(async () => {
  setup = testEnv(); state.env = setup.env;
  setup.addUser('admin', 'admin'); setup.addUser('pro');
  await adminActivatePlan({ actorId: 'admin', ownerId: 'pro', plan: 'pro' });
});

// The measurements land in .local/ (git-ignored) for the PR; the assertions are deliberately loose.
const report = (line: string) => { try { mkdirSync('.local', { recursive: true }); appendFileSync('.local/long-docx-measurements.log', `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ } };
const MB = 1024 * 1024;
async function measured<T>(label: string, work: () => Promise<T>): Promise<{ value: T; ms: number; cpu: number; heap: number }> {
  (globalThis as { gc?: () => void }).gc?.();
  const heap0 = process.memoryUsage().heapUsed; let peak = heap0;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 2);
  const started = performance.now(); const cpu0 = process.cpuUsage();
  try {
    const value = await work();
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    const used = process.cpuUsage(cpu0); const result = { value, ms: performance.now() - started, cpu: (used.user + used.system) / 1000, heap: (peak - heap0) / MB };
    report(`${label}: ${result.ms.toFixed(0)} ms wall, ${result.cpu.toFixed(0)} ms CPU, peak heap +${result.heap.toFixed(1)} MB`);
    return result;
  } finally { clearInterval(sampler); }
}

const gzip = async (text: string) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const jsonRequest = (url: string, body: BodyInit, method = 'POST') => new Request(url, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body });

describe('a 1,500-page thesis', () => {
  it('imports, creates a notebook, autosaves, versions and exports within loose time and memory bounds', async () => {
    const { bytes, stats } = await thesisDocx({ pages: 1500, pictures: true, mediaBytes: 12_000_000 });
    report(`fixture: ${(bytes.length / 1e6).toFixed(1)} MB .docx, ${stats.characters} characters, ${stats.paragraphs} paragraphs, ${stats.pictures} pictures`);
    expect(stats.characters).toBeGreaterThanOrEqual(6_000_000);

    const imported = await measured('import route', () => importRoute(new Request('https://tulis.test/api/documents/import?language=id', {
      method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Length': String(bytes.byteLength) }, body: bytes,
    })));
    expect(imported.value.status).toBe(200);
    const answer = await imported.value.text();
    const { data } = JSON.parse(answer) as { data: { content: EditorDocument; docxImportReceipt: string; title: string; warnings: string[]; pageSize: string; pageMargins: string } };
    report(`import answer: ${(answer.length / 1e6).toFixed(1)} MB of JSON, ${data.content.content.length} blocks`);
    expect(jsonDocumentTextLength(data.content)).toBeGreaterThan(6_000_000);
    expect(data.warnings).toContain('images');
    expect(data.pageSize).toBe('a4');
    expect(data.pageMargins).toBe('2268,1701,1701,2268');
    // Loose bounds: a Worker gets 30 s of CPU and 128 MB; Node's numbers here are an upper estimate of both.
    expect(imported.cpu).toBeLessThan(30_000);
    expect(imported.heap).toBeLessThan(250);

    // Create: this is the request production answered with 413 PAYLOAD_TOO_LARGE. The editor sends it gzipped.
    const createBody = JSON.stringify({ title: data.title, language: 'id', content: data.content, preferences: { advanced: true }, docxImportReceipt: data.docxImportReceipt });
    const compressed = await gzip(createBody);
    report(`create body: ${(createBody.length / 1e6).toFixed(1)} MB JSON, ${(compressed.length / 1e6).toFixed(2)} MB gzipped`);
    expect(createBody.length).toBeGreaterThan(1_600_000);
    const created = await measured('create route', () => createRoute(jsonRequest('https://tulis.test/api/documents?lean=1', compressed)));
    expect(created.value.status).toBe(201);
    expect(created.cpu).toBeLessThan(30_000); expect(created.heap).toBeLessThan(250);
    const { data: notebook } = await created.value.json() as { data: { id: string; revision: number; content?: unknown } };
    expect(notebook.content).toBeUndefined();
    // The import evidence matched, and no D1 row holds the body.
    expect(setup.db.prepare('SELECT COUNT(1) AS n FROM document_portability_evidence').get()).toEqual({ n: 1 });
    expect(setup.db.prepare('SELECT body_json, storage_mode FROM documents WHERE id=?').get(notebook.id)).toEqual({ body_json: null, storage_mode: 'r2' });

    // Autosave: one more paragraph at the end, sent gzipped and answered lean.
    const edited: EditorDocument = { type: 'doc', content: [...data.content.content, { type: 'paragraph', content: [{ type: 'text', text: 'Tambahan setelah impor.' }] }] };
    const saveBody = await gzip(JSON.stringify({ content: edited, expectedRevision: 0 }));
    const saved = await measured('autosave route', () => autosaveRoute(jsonRequest(`https://tulis.test/api/documents/${notebook.id}/autosave?lean=1`, saveBody, 'PATCH'), { params: Promise.resolve({ id: notebook.id }) }));
    expect(saved.value.status).toBe(200);
    expect(saved.cpu).toBeLessThan(30_000); expect(saved.heap).toBeLessThan(250);
    expect(((await saved.value.json()) as { data: { revision: number } }).data.revision).toBe(1);
    expect(setup.db.prepare('SELECT body_json FROM documents WHERE id=?').get(notebook.id)).toEqual({ body_json: null });

    const checkpoint = await measured('checkpoint', () => createCheckpoint('pro', notebook.id, 1, 'Sebelum revisi'));
    expect(checkpoint.value.revision).toBe(2);
    const loaded = await measured('open (GET)', () => getDocument('pro', notebook.id));
    expect(loaded.value.content.content.at(-1)).toMatchObject({ content: [{ text: 'Tambahan setelah impor.' }] });

    const exported = await measured('export route', () => exportRoute(new Request(`https://tulis.test/api/documents/${notebook.id}/export?format=docx`), { params: Promise.resolve({ id: notebook.id }) }));
    expect(exported.value.status).toBe(200);
    expect(exported.cpu).toBeLessThan(30_000); expect(exported.heap).toBeLessThan(250);
    const file = new Uint8Array(await exported.value.arrayBuffer());
    report(`export: ${(file.length / 1e6).toFixed(1)} MB .docx`);
    // The exported file reads back with the same text.
    const again = await docxToEditorDocument(file);
    expect(jsonDocumentTextLength(again.content)).toBeGreaterThanOrEqual(jsonDocumentTextLength(edited) - 10);
  }, 600_000);
});
