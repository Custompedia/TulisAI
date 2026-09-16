import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown>, user: 'owner-a' as string | null }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));
vi.mock('@/server/auth/auth', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUser: async () => { if (!state.user) throw new UnauthorizedError('Sign in required.'); return { id: state.user }; } };
});

import { createDocument, getDocument, listDocuments, listVersions } from '@/server/documents/service';
import { PATCH } from '@/app/api/documents/[id]/appearance/route';
import { EditorDocumentSchema } from '@/lib/contracts';
import { NotebookAppearanceSchema, formatNotebookIcon, notebookTone, parseNotebookIcon } from '@/lib/notebook/appearance';

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(value.changes) } }; }
  async run() { return this.execute(); }
}

beforeEach(() => {
  db = new DatabaseSync(':memory:'); state.user = 'owner-a';
  for (const file of ['0000_initial', '0001_username_auth', '0002_workspace_metadata', '0003_notebook_appearance', '0004_writing_styles', '0005_user_role', '0006_admin_panel', '0007_usage_created_index', '0008_style_description']) db.exec(readFileSync(`migrations/${file}.sql`, 'utf8'));
  const objects = new Map<string, string>();
  state.env = {
    DB: { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => statements.map((statement) => statement.execute()) },
    DOCUMENTS: { head: async (key: string) => (objects.has(key) ? { key } : null), put: async (key: string, value: string) => { objects.set(key, value); return { key }; }, get: async (key: string) => { const value = objects.get(key); return value === undefined ? null : { text: async () => value }; }, delete: async () => undefined },
  };
});
afterEach(() => db.close());

const content = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi.' }] }] });
const patch = (id: string, body: unknown, key: string | null = 'k1') => PATCH(new Request(`http://localhost/api/documents/${id}/appearance`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

describe('review: notebook appearance', () => {
  it('parses, formats and validates icon values', () => {
    expect(parseNotebookIcon('emoji:📘')).toEqual({ kind: 'emoji', value: '📘' });
    expect(parseNotebookIcon('icon:Rocket')).toEqual({ kind: 'icon', name: 'Rocket' });
    expect(parseNotebookIcon('icon:Skull')).toBeNull();
    expect(parseNotebookIcon('emoji:')).toBeNull();
    expect(parseNotebookIcon(`emoji:${'a'.repeat(17)}`)).toBeNull();
    expect(formatNotebookIcon({ kind: 'icon', name: 'Leaf' })).toBe('icon:Leaf');
    expect(NotebookAppearanceSchema.safeParse({ color: 'purple', icon: null }).success).toBe(false);
    expect(NotebookAppearanceSchema.safeParse({ color: 'gray', icon: 'emoji:☕' }).success).toBe(true);
    expect(notebookTone(null, 'academic')).toBe('blue');
    expect(notebookTone('pink', 'academic')).toBe('pink');
  });

  it('persists colour and icon without bumping revision, versions or updated_at', async () => {
    const doc = await createDocument('owner-a', { title: 'Riset', language: 'id', content });
    const before = db.prepare('SELECT revision,updated_at FROM documents WHERE id=?').get(doc.id);
    const response = await patch(doc.id, { color: 'gold', icon: 'icon:Rocket' });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ id: doc.id, color: 'gold', icon: 'icon:Rocket' });
    expect(db.prepare('SELECT revision,updated_at FROM documents WHERE id=?').get(doc.id)).toEqual(before);
    expect((await listVersions('owner-a', doc.id)).items).toHaveLength(1);
    expect((await getDocument('owner-a', doc.id))).toMatchObject({ color: 'gold', icon: 'icon:Rocket', revision: 0 });
    expect((await listDocuments('owner-a')).items[0]).toMatchObject({ color: 'gold', icon: 'icon:Rocket' });
    expect((await patch(doc.id, { color: null, icon: null })).status).toBe(200);
    expect((await listDocuments('owner-a')).items[0]).toMatchObject({ color: null, icon: null });
  });

  it('rejects invalid bodies, missing keys, other owners and anonymous users', async () => {
    const doc = await createDocument('owner-a', { title: 'Riset', language: 'id', content });
    expect((await patch(doc.id, { color: 'green', icon: 'icon:NotAllowed' })).status).toBe(400);
    expect((await patch(doc.id, { color: 'green', icon: 'emoji:ok', extra: 1 })).status).toBe(400);
    expect((await patch(doc.id, { color: 'green', icon: null }, null)).status).toBe(400);
    state.user = 'owner-b';
    expect((await patch(doc.id, { color: 'green', icon: null })).status).toBe(404);
    state.user = null;
    expect((await patch(doc.id, { color: 'green', icon: null })).status).toBe(401);
    expect(db.prepare('SELECT color,icon FROM documents WHERE id=?').get(doc.id)).toEqual({ color: null, icon: null });
  });
});
