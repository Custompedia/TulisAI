import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { autosaveDocument, createCheckpoint, createDocument, getDocument, permanentlyDeleteDocument, trashDocument } from '@/server/documents/service';
import { shouldDiscard } from '@/components/workspace/editor-rules';
import { documentText } from '@/lib/editor/document';
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
const exists = (id: string) => db.prepare('SELECT 1 AS ok FROM documents WHERE id=?').get(id) !== undefined;

describe('UX 4 finding 1: permanent delete has a server guard', () => {
  it('deletes an untouched revision-0 skeleton or blank notebook when the revision matches', async () => {
    const skeleton = await make('skeleton');
    await permanentlyDeleteDocument('owner-a', skeleton.id, 0);
    expect(exists(skeleton.id)).toBe(false);
    const blank = await make('blank', EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph' }] }));
    await permanentlyDeleteDocument('owner-a', blank.id, 0);
    expect(exists(blank.id)).toBe(false);
  });

  it('refuses a stale revision: a notebook saved elsewhere keeps its content', async () => {
    const doc = await make('skeleton');
    await autosaveDocument('owner-a', doc.id, 0, filled);
    await expect(permanentlyDeleteDocument('owner-a', doc.id, 0)).rejects.toMatchObject({ code: 'DELETE_REFUSED', status: 409, details: { currentRevision: 1 } });
    await expect(permanentlyDeleteDocument('owner-a', doc.id, 1)).rejects.toMatchObject({ code: 'DELETE_REFUSED' });
    expect(documentText((await getDocument('owner-a', doc.id)).content)).toBe('Isi yang sudah ditulis.');
  });

  it('refuses a revision-0 notebook that was not made as a skeleton or blank one, and a missing revision', async () => {
    for (const source of ['compose', 'import', 'copy', 'skill', undefined]) {
      const doc = await make(source, filled);
      await expect(permanentlyDeleteDocument('owner-a', doc.id, 0)).rejects.toMatchObject({ code: 'DELETE_REFUSED', status: 409 });
      expect(exists(doc.id)).toBe(true);
    }
    const skeleton = await make('skeleton');
    await expect(permanentlyDeleteDocument('owner-a', skeleton.id)).rejects.toMatchObject({ code: 'DELETE_REFUSED' });
    expect(exists(skeleton.id)).toBe(true);
  });

  it('deletes any notebook already in the trash, and never another owner\'s', async () => {
    const doc = await make('compose', filled);
    await createCheckpoint('owner-a', doc.id, 0, 'Draft');
    await trashDocument('owner-a', doc.id);
    await expect(permanentlyDeleteDocument('owner-b', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await permanentlyDeleteDocument('owner-a', doc.id);
    expect(exists(doc.id)).toBe(false);
    await expect(permanentlyDeleteDocument('owner-a', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('UX 4 finding 2: auto-discard never drops a local recovery copy', () => {
  const base = { source: 'skeleton', revision: 0, dirty: false, text: 'Pendahuluan\nMetode', original: 'Pendahuluan\nMetode' };
  it('discards only an untouched notebook with nothing pending', () => {
    expect(shouldDiscard(base)).toBe(true);
    expect(shouldDiscard({ ...base, busy: false, recovery: false, cachedDraft: false })).toBe(true);
  });
  it('keeps it while a recovery copy waits, a cached draft differs, or a request is in flight', () => {
    expect(shouldDiscard({ ...base, recovery: true })).toBe(false);
    expect(shouldDiscard({ ...base, cachedDraft: true })).toBe(false);
    expect(shouldDiscard({ ...base, busy: true })).toBe(false);
    expect(shouldDiscard({ ...base, source: 'blank', text: '', original: '', recovery: true })).toBe(false);
  });
});

