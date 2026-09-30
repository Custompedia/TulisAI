import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { autosaveDocument, createCheckpoint, createDocument, deleteDocument, getDocument, libraryCounts, listDocuments, purgeExpiredTrash, restoreDocument, setPinned, trashDocument, TRASH_RETENTION_MS } from '@/server/documents/service';
import { runMaintenance } from '@/server/storage/maintenance';
import { EditorDocumentSchema } from '@/lib/contracts';

let db: DatabaseSync;
let objects: Map<string, string>;
beforeEach(() => { const made = testEnv(); db = made.db; objects = made.objects; state.env = made.env; made.addUser('owner-a'); made.addUser('owner-b'); });
afterEach(() => db.close());

const content = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi.' }] }] });
const make = (title: string, preferences: Record<string, unknown> = {}, owner = 'owner-a') => createDocument(owner, { title, language: 'id', content, preferences });
const ids = (page: { items: Array<{ title: string }> }) => page.items.map((item) => item.title);
const at = (id: string, updated: number, created = updated) => db.prepare('UPDATE documents SET updated_at=?,created_at=? WHERE id=?').run(updated, created, id);

describe('UX 2: server-side library list', () => {
  it('searches every word of the title, escapes wildcards, and counts every match', async () => {
    const a = await make('Esai — Bab 2'); const b = await make('Bab 1 esai'); const c = await make('Laporan 100% selesai'); await make('Laporan_akhir');
    at(a.id, 3); at(b.id, 2); at(c.id, 1);
    expect(ids(await listDocuments('owner-a', undefined, 20, { q: 'bab esai' }))).toEqual(['Esai — Bab 2', 'Bab 1 esai']);
    expect(ids(await listDocuments('owner-a', undefined, 20, { q: '100%' }))).toEqual(['Laporan 100% selesai']);
    expect(ids(await listDocuments('owner-a', undefined, 20, { q: 'n_a' }))).toEqual(['Laporan_akhir']);
    const page = await listDocuments('owner-a', undefined, 1, { q: 'bab' });
    expect(page).toMatchObject({ total: 2 }); expect(page.nextCursor).not.toBeNull();
  });

  it('filters by last mode (legacy custom is Parafrase) and by kind of writing, including none', async () => {
    await make('A', { mode: 'academic', docType: 'essay' }); await make('B', { mode: 'custom', docType: 'essay' }); await make('C', { mode: 'standard' }); await make('D', {}, 'owner-b');
    expect(ids(await listDocuments('owner-a', undefined, 20, { mode: 'standard', sort: 'title' }))).toEqual(['B', 'C']);
    expect(ids(await listDocuments('owner-a', undefined, 20, { docType: 'essay', sort: 'title' }))).toEqual(['A', 'B']);
    expect(ids(await listDocuments('owner-a', undefined, 20, { docType: 'none' }))).toEqual(['C']);
    const listed = await listDocuments('owner-a', undefined, 20, { docType: 'essay', sort: 'title' });
    expect(listed.items[0]).toMatchObject({ docType: 'essay', pinned: false, mode: 'academic' });
  });

  it('sorts by title (case-insensitive) and by creation, with cursors that walk every page', async () => {
    const titles = ['beta', 'Alpha', 'gamma', 'Delta', 'epsilon'];
    for (const [index, title] of titles.entries()) { const doc = await make(title); at(doc.id, 100 - index, index); }
    const walk = async (sort: 'title' | 'created') => {
      const seen: string[] = []; let cursor: string | undefined;
      do { const page = await listDocuments('owner-a', cursor, 2, { sort }); seen.push(...ids(page)); cursor = page.nextCursor ?? undefined; } while (cursor);
      return seen;
    };
    expect(await walk('title')).toEqual(['Alpha', 'beta', 'Delta', 'epsilon', 'gamma']);
    expect(await walk('created')).toEqual(['epsilon', 'Delta', 'gamma', 'Alpha', 'beta']);
    await expect(listDocuments('owner-a', 'zz:!!:x', 2, { sort: 'title' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('gives the sidebar exact counts per group', async () => {
    const a = await make('A', { docType: 'essay', mode: 'humanize' }); await make('B', { docType: 'essay', mode: 'custom' }); const c = await make('C', { docType: 'script' }); await make('D');
    await setPinned('owner-a', a.id, true); await trashDocument('owner-a', c.id);
    expect(await libraryCounts('owner-a')).toEqual({ all: 3, pinned: 1, trash: 1, docTypes: { essay: 2, none: 1 }, modes: { humanize: 1, standard: 1, none: 1 } });
  });

  it('uses the kind-of-writing index', () => {
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM documents WHERE owner_id=? AND deleted_at IS NULL AND json_extract(preferences_json,'$.docType')=?").all('owner-a', 'essay') as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join(' ')).toContain('documents_owner_doc_type_idx');
  });
});

describe('UX 2: Sematkan', () => {
  it('pins without a revision, a version or a new updated_at', async () => {
    const doc = await make('A');
    const before = db.prepare('SELECT revision,updated_at FROM documents WHERE id=?').get(doc.id);
    await setPinned('owner-a', doc.id, true);
    expect(db.prepare('SELECT revision,updated_at FROM documents WHERE id=?').get(doc.id)).toEqual(before);
    expect((await getDocument('owner-a', doc.id)).pinned).toBe(true);
    expect(ids(await listDocuments('owner-a', undefined, 20, { pinned: true }))).toEqual(['A']);
    await setPinned('owner-a', doc.id, false);
    expect((await listDocuments('owner-a', undefined, 20, { pinned: true })).items).toEqual([]);
    await expect(setPinned('owner-b', doc.id, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('UX 2: Sampah', () => {
  it('hides a trashed notebook from every editor path and lists it in the trash with its purge date', async () => {
    const doc = await make('A');
    const trashed = await trashDocument('owner-a', doc.id);
    expect(Date.parse(trashed.purgeAt) - Date.parse(trashed.deletedAt)).toBe(TRASH_RETENTION_MS);
    await expect(getDocument('owner-a', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(autosaveDocument('owner-a', doc.id, doc.revision, content)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setPinned('owner-a', doc.id, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listDocuments('owner-a')).items).toEqual([]);
    const trash = await listDocuments('owner-a', undefined, 20, { trash: true });
    expect(trash.items[0]).toMatchObject({ title: 'A', deletedAt: trashed.deletedAt, purgeAt: trashed.purgeAt });
    await expect(trashDocument('owner-a', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('restores the same notebook, content and versions intact', async () => {
    const doc = await make('A'); await createCheckpoint('owner-a', doc.id, doc.revision, 'Draf');
    await trashDocument('owner-a', doc.id);
    await restoreDocument('owner-a', doc.id);
    expect(await getDocument('owner-a', doc.id)).toMatchObject({ title: 'A', content, revision: doc.revision + 1 });
    await expect(restoreDocument('owner-a', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(restoreDocument('owner-b', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deletes permanently with every R2 snapshot', async () => {
    const doc = await make('A'); await createCheckpoint('owner-a', doc.id, doc.revision, 'Draf');
    expect(objects.size).toBe(2);
    await trashDocument('owner-a', doc.id);
    await deleteDocument('owner-a', doc.id);
    expect(objects.size).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM document_versions').get()).toEqual({ n: 0 });
    await expect(deleteDocument('owner-a', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('purges only trash older than 30 days, with its snapshots, from the hourly maintenance', async () => {
    const old = await make('Lama'); const fresh = await make('Baru'); const kept = await make('Aktif');
    await trashDocument('owner-a', old.id); await trashDocument('owner-a', fresh.id);
    const now = Date.now();
    db.prepare('UPDATE documents SET deleted_at=? WHERE id=?').run(now - TRASH_RETENTION_MS - 1, old.id);
    const oldKeys = (db.prepare('SELECT snapshot_r2_key AS key FROM document_versions WHERE document_id=?').all(old.id) as Array<{ key: string }>).map((row) => row.key);
    expect(oldKeys.every((key) => objects.has(key))).toBe(true);
    const result = await runMaintenance(state.env as never, now);
    expect(result.trashPurged).toBe(1);
    expect(oldKeys.some((key) => objects.has(key))).toBe(false);
    expect(ids(await listDocuments('owner-a', undefined, 20, { trash: true }))).toEqual(['Baru']);
    expect((await getDocument('owner-a', kept.id)).title).toBe('Aktif');
    expect(await purgeExpiredTrash(state.env as never, now)).toBe(0);
  });
});
