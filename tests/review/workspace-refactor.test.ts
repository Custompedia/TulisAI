import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../../src/server/runtime', () => ({
  runtime: () => state.env,
  requiredSetting: (value: string) => value,
  ConfigurationError: class extends Error {},
}));

import { createCheckpoint, createDocument, deleteDocument, getDocument, listDocuments, listVersions } from '../../src/server/documents/service';
import { createLock } from '../../src/server/documents/locks';
import { EditorDocumentSchema } from '../../src/lib/contracts';

let db: DatabaseSync;
let objects: Map<string, string>;
let objectReads: number; // eslint-disable-line @typescript-eslint/no-unused-vars
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } }; }
  async run() { return this.execute(); }
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0000_initial.sql', 'utf8')); db.exec(readFileSync('migrations/0001_username_auth.sql', 'utf8')); db.exec(readFileSync('migrations/0002_workspace_metadata.sql', 'utf8'));
  objects = new Map(); objectReads = 0;
  state.env = {
    DB: { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => {
      db.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } },
    DOCUMENTS: {
      head: async (key: string) => objects.has(key) ? { key, size: objects.get(key)!.length } : null,
      put: async (key: string, value: string) => { objects.set(key, value); return { key }; },
      get: async (key: string) => { objectReads++; const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value, arrayBuffer: async () => new TextEncoder().encode(value).buffer }; },
      delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    },
  };
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); });
const content = (text: string) => EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const create = () => createDocument('owner-a', { title: 'Research', language: 'id', content: content('Sumber asli.') });

describe('review: workspace refactor persistence', () => {
  it('stores quick-start preferences and exposes the active mode in the document list', async () => {
    const doc = await createDocument('owner-a', { title: 'Skripsi', language: 'id', content: content('Sumber asli.'), preferences: { mode: 'academic', strength: 'balanced' } });
    const page = await listDocuments('owner-a');
    expect(page.items[0]).toMatchObject({ id: doc.id, mode: 'academic' });
    expect((await getDocument('owner-a', doc.id)).originalVersionId).toEqual(expect.any(String));
  });
  it('returns null mode for documents without preferences', async () => {
    await create();
    expect((await listDocuments('owner-a')).items[0]?.mode).toBeNull();
  });
  it('deletes a document with versions and locks, including its snapshots', async () => {
    const doc = await create();
    await createCheckpoint('owner-a', doc.id, doc.revision, 'Draft');
    await createLock('owner-a', doc.id, 'Sumber');
    expect(objects.size).toBeGreaterThan(0);
    await deleteDocument('owner-a', doc.id);
    await expect(getDocument('owner-a', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(objects.size).toBe(0);
    await expect(deleteDocument('owner-b', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('lists version metadata fields for the history drawer', async () => {
    const doc = await create();
    const [original] = (await listVersions('owner-a', doc.id)).items;
    expect(original).toMatchObject({ kind: 'original', promptId: null, scopeType: null });
  });
});
