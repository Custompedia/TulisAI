import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { createCheckpoint, createDocument, restoreDocument, trashDocument } from '@/server/documents/service';
import { createLock, deleteLock, listLocks } from '@/server/documents/locks';
import { EditorDocumentSchema } from '@/lib/contracts';

let db: DatabaseSync;
let env: Record<string, unknown>;
beforeEach(() => { const made = testEnv(); db = made.db; env = made.env; state.env = env; made.addUser('owner-a'); made.addUser('owner-b'); });
afterEach(() => db.close());

const text = (value: string) => ({ type: 'text', text: value });
const para = (value: string) => ({ type: 'paragraph', content: [text(value)] });
const heading = (value: string, level = 2) => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const outline = EditorDocumentSchema.parse({ type: 'doc', content: [heading('Pendahuluan'), { type: 'paragraph' }, heading('Metode'), { type: 'paragraph' }] });
const filled = EditorDocumentSchema.parse({ type: 'doc', content: [para('Isi yang sudah ditulis.')] });
const make = (source: string | undefined, content = outline, owner = 'owner-a') => createDocument(owner, { title: 'Notebook', language: 'id', content, preferences: source ? { docSource: source } : {} });

describe('UX 4 finding 5: a notebook in the trash is read-only', () => {
  it('lists and deletes locked terms only while the notebook is out of the trash', async () => {
    const doc = await make('compose', filled);
    const lock = await createLock('owner-a', doc.id, 'Isi');
    await trashDocument('owner-a', doc.id);
    await expect(listLocks('owner-a', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteLock('owner-a', doc.id, lock.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM locked_terms WHERE document_id=?').get(doc.id)).toEqual({ n: 1 });
    await restoreDocument('owner-a', doc.id);
    expect((await listLocks('owner-a', doc.id)).map((item) => item.term)).toEqual(['Isi']);
    await deleteLock('owner-a', doc.id, lock.id);
    expect(await listLocks('owner-a', doc.id)).toEqual([]);
  });

  it('a save that races a trash does not write into the trashed notebook', async () => {
    const doc = await make('compose', filled);
    const bucket = env.DOCUMENTS as { put: (key: string, value: string) => Promise<unknown> };
    const put = bucket.put;
    // The trash lands between the save's read and its UPDATE (while the snapshot uploads).
    bucket.put = async (key, value) => { db.prepare('UPDATE documents SET deleted_at=? WHERE id=?').run(Date.now(), doc.id); return put(key, value); };
    await expect(createCheckpoint('owner-a', doc.id, 0, 'Late')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    bucket.put = put;
    expect(db.prepare('SELECT revision FROM documents WHERE id=?').get(doc.id)).toEqual({ revision: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM document_versions WHERE document_id=? AND label='Late'").get(doc.id)).toEqual({ n: 0 });
  });
});
