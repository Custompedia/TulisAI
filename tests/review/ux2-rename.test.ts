import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { autosaveDocument, createDocument, getDocument, listVersions, renameDocument } from '@/server/documents/service';
import { renameNotebook } from '@/components/app/NotebookCard';
import { EditorDocumentSchema } from '@/lib/contracts';

let db: DatabaseSync;
beforeEach(() => { const made = testEnv(); db = made.db; state.env = made.env; made.addUser('owner-a'); made.addUser('owner-b'); });
afterEach(() => { vi.unstubAllGlobals(); db.close(); });
const content = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi.' }] }] });

describe('UX 2: rename without a checkpoint', () => {
  it('changes only the title, bumps the revision, and adds no version', async () => {
    const doc = await createDocument('owner-a', { title: 'Lama', language: 'id', content });
    const renamed = await renameDocument('owner-a', doc.id, doc.revision, 'Baru');
    expect(renamed).toMatchObject({ title: 'Baru', revision: doc.revision + 1 });
    const stored = await getDocument('owner-a', doc.id);
    expect(stored).toMatchObject({ title: 'Baru', revision: doc.revision + 1, content });
    expect((await listVersions('owner-a', doc.id)).items.map((version) => version.label)).toEqual(['Original']);
  });

  it('refuses a stale revision and names the current one, so an open editor cannot write the old title back', async () => {
    const doc = await createDocument('owner-a', { title: 'Lama', language: 'id', content });
    await autosaveDocument('owner-a', doc.id, doc.revision, content, { title: 'Dari editor' });
    await expect(renameDocument('owner-a', doc.id, doc.revision, 'Baru')).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409, details: { currentRevision: doc.revision + 1 } });
    await renameDocument('owner-a', doc.id, doc.revision + 1, 'Baru');
    await expect(autosaveDocument('owner-a', doc.id, doc.revision + 1, content, { title: 'Dari editor' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await getDocument('owner-a', doc.id)).title).toBe('Baru');
  });

  it('is scoped to the owner', async () => {
    const doc = await createDocument('owner-a', { title: 'Lama', language: 'id', content });
    await expect(renameDocument('owner-b', doc.id, doc.revision, 'Baru')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the library retries once on the revision the server names', async () => {
    const calls: Array<{ url: string; body: { expectedRevision: number } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { expectedRevision: number; title: string };
      calls.push({ url, body });
      if (body.expectedRevision === 3) return Response.json({ error: { code: 'REVISION_CONFLICT', message: 'x', details: { currentRevision: 5 } } }, { status: 409 });
      return Response.json({ data: { title: body.title, revision: 6, updatedAt: '2026-10-01T00:00:00.000Z' } });
    }));
    await expect(renameNotebook('doc-1', 'Baru', 3)).resolves.toMatchObject({ title: 'Baru', revision: 6 });
    expect(calls.map((call) => [call.url, call.body.expectedRevision])).toEqual([['/api/documents/doc-1/title', 3], ['/api/documents/doc-1/title', 5]]);
  });
});
