import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testEnv } from '../helpers/d1';

// Production answered POST /api/documents with 413 for a long import: bodies were capped at 1.6 MB and stored in a
// D1 column. Bodies now live in R2, requests may be gzipped, and the caps are the ones in src/lib/limits.ts.
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown>, user: 'owner' }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));
vi.mock('@/server/auth/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/auth/auth')>()), requireUser: async () => ({ id: state.user }) }));

import { POST as createRoute } from '@/app/api/documents/route';
import { POST as autosaveRoute } from '@/app/api/documents/[id]/autosave/route';
import { autosaveDocument, createCheckpoint, createDocument, getDocument } from '@/server/documents/service';
import { DOCUMENT_JSON, jsonShapeProblem, readJson, RequestError } from '@/server/http';
import { MAX_DOCUMENT_CHARACTERS, MAX_DOCUMENT_REQUEST_BYTES } from '@/lib/limits';
import { EditorDocumentSchema } from '@/lib/contracts';
import { jsonBody } from '@/lib/client/api';

let setup: ReturnType<typeof testEnv>;
beforeEach(() => { setup = testEnv(); state.env = setup.env; setup.addUser('owner'); state.user = 'owner'; });

const gzip = async (text: string) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const post = (url: string, body: BodyInit, method = 'POST') => new Request(url, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body });
const paragraphs = (count: number, length = 500) => ({ type: 'doc', content: Array.from({ length: count }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `${index} ${'kata '.repeat(length / 5)}`.slice(0, length) }] })) });
const row = (id: string) => setup.db.prepare('SELECT body_json, body_r2_key, storage_mode, revision FROM documents WHERE id=?').get(id) as { body_json: string | null; body_r2_key: string; storage_mode: string; revision: number };
const bodies = () => [...setup.objects.keys()].filter((key) => key.includes('/body/'));

describe('request bodies', () => {
  const Schema = z.object({ text: z.string() });
  const request = (body: BodyInit, headers: Record<string, string> = {}) => new Request('https://tulis.test/x', { method: 'POST', headers, body });

  it('reads a gzip body by its magic bytes and the same JSON uncompressed', async () => {
    const json = JSON.stringify({ text: 'halo dunia' });
    expect(await readJson(request(await gzip(json)), Schema)).toEqual({ text: 'halo dunia' });
    expect(await readJson(request(json), Schema)).toEqual({ text: 'halo dunia' });
  });

  it('refuses a zip bomb as soon as it inflates past the cap', async () => {
    const bomb = await gzip(`{"text":"${'0'.repeat(MAX_DOCUMENT_REQUEST_BYTES + 1000)}"}`);
    expect(bomb.length).toBeLessThan(100_000);
    await expect(readJson(request(bomb), Schema, DOCUMENT_JSON)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    await expect(readJson(request(await gzip('{"text":"not json'), {}), Schema)).rejects.toBeInstanceOf(RequestError);
  });

  it('counts objects and arrays before parsing, so a body of empty brackets cannot exhaust memory', () => {
    const brackets = new TextEncoder().encode(`[${Array(2_000_000).fill('[]').join(',')}]`);
    expect(jsonShapeProblem(brackets)).toBe('containers');
    expect(jsonShapeProblem(new TextEncoder().encode('['.repeat(70) + ']'.repeat(70)))).toBe('depth');
    // Brackets inside strings are text, not structure.
    expect(jsonShapeProblem(new TextEncoder().encode(JSON.stringify({ text: '[{'.repeat(100_000) })), 10)).toBeNull();
  });

  it('lets the editor drop null attributes and gzip a long body, which the server reads back unchanged', async () => {
    const small = await jsonBody({ content: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null, lineHeight: '2' } }] } });
    expect(small).toEqual({ body: '{"content":{"type":"doc","content":[{"type":"paragraph","attrs":{"lineHeight":"2"}}]}}', compressed: false });
    const long = { content: paragraphs(2000), expectedRevision: 3 };
    const sent = await jsonBody(long);
    expect(sent.compressed).toBe(true);
    const Autosave = z.object({ content: EditorDocumentSchema, expectedRevision: z.number() });
    const read = await readJson(new Request('https://tulis.test/x', { method: 'POST', body: sent.body }), Autosave, DOCUMENT_JSON);
    expect(read).toEqual(long);
    expect((sent.body as ArrayBuffer).byteLength).toBeLessThan(JSON.stringify(long).length / 5);
  });

  it('keeps the small cap on every other route', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(1_700_000) });
    await expect(readJson(request(big), Schema)).rejects.toMatchObject({ status: 413 });
    await expect(readJson(request(await gzip(big)), Schema)).rejects.toMatchObject({ status: 413 });
  });
});

describe('long notebooks are stored in R2, never in a D1 row', () => {
  it('creates a notebook bigger than the old 1.6 MB request cap (the old 413 path) and answers lean when asked', async () => {
    const body = JSON.stringify({ title: 'Skripsi', language: 'id', content: paragraphs(6000) });
    expect(body.length).toBeGreaterThan(3_000_000);
    const plain = await createRoute(post('https://tulis.test/api/documents?lean=1', body));
    expect(plain.status).toBe(201);
    const compressed = await createRoute(post('https://tulis.test/api/documents', await gzip(body)));
    expect(compressed.status).toBe(201);
    const { data } = await compressed.json() as { data: { id: string; content: { content: unknown[] } } };
    expect(data.content.content).toHaveLength(6000);
    expect(row(data.id)).toMatchObject({ body_json: null, storage_mode: 'r2' });
  });

  it('autosaves to a new body object, deletes the one it replaced, and keeps versions in their own objects', async () => {
    const created = await createDocument('owner', { title: 'A', language: 'id', content: EditorDocumentSchema.parse(paragraphs(10)) });
    // Until the first save the Original version's object is the body.
    expect(row(created.id).body_r2_key).toContain('/versions/');
    const first = await autosaveDocument('owner', created.id, 0, EditorDocumentSchema.parse(paragraphs(11)), undefined, { lean: true });
    expect(first).not.toHaveProperty('content');
    expect(row(created.id)).toMatchObject({ body_json: null, storage_mode: 'r2', revision: 1 });
    expect(bodies()).toEqual([row(created.id).body_r2_key]);
    await autosaveDocument('owner', created.id, 1, EditorDocumentSchema.parse(paragraphs(12)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bodies()).toEqual([row(created.id).body_r2_key]);
    const checkpoint = await createCheckpoint('owner', created.id, 2, 'Bab 1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bodies()).toEqual([]);
    expect(row(created.id).body_r2_key).toContain('/versions/');
    expect((await getDocument('owner', checkpoint.id)).content.content).toHaveLength(12);
    expect(setup.db.prepare("SELECT COUNT(1) AS n FROM documents WHERE body_json IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it('still opens a notebook saved in the old D1 column, and moves it to R2 on the next save', async () => {
    const created = await createDocument('owner', { title: 'Lama', language: 'id', content: EditorDocumentSchema.parse(paragraphs(2)) });
    setup.db.prepare("UPDATE documents SET body_json=?, body_r2_key=NULL, storage_mode='d1' WHERE id=?").run(JSON.stringify(paragraphs(3)), created.id);
    expect((await getDocument('owner', created.id)).content.content).toHaveLength(3);
    await autosaveDocument('owner', created.id, 0, EditorDocumentSchema.parse(paragraphs(4)));
    expect(row(created.id)).toMatchObject({ body_json: null, storage_mode: 'r2' });
  });

  it('autosaves a gzipped long notebook through the route and keeps the revision guard', async () => {
    const created = await createDocument('owner', { title: 'A', language: 'id', content: EditorDocumentSchema.parse(paragraphs(2)) });
    const save = async (revision: number) => autosaveRoute(post(`https://tulis.test/api/documents/${created.id}/autosave?lean=1`, await gzip(JSON.stringify({ content: paragraphs(5000), expectedRevision: revision })), 'PATCH'), { params: Promise.resolve({ id: created.id }) });
    expect((await save(0)).status).toBe(200);
    const stale = await save(0);
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: { code: string } }).error.code).toBe('REVISION_CONFLICT');
    // The losing save's object was removed again; only the winner's body remains.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bodies()).toEqual([row(created.id).body_r2_key]);
  });

  it('refuses more text than the notebook cap with 413', async () => {
    const tooLong = { type: 'doc', content: Array.from({ length: 9 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'a'.repeat(MAX_DOCUMENT_CHARACTERS / 8) }] })) };
    await expect(createDocument('owner', { title: 'X', language: 'id', content: EditorDocumentSchema.parse(tooLong) })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
  });
});
