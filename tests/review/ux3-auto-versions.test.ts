import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { AUTO_VERSION_INTERVAL_MS, AUTO_VERSION_KEEP, autosaveDocument, createCheckpoint, createDocument, listVersions, restoreVersion, updateVersionLabel } from '@/server/documents/service';
import { EditorDocumentSchema } from '@/lib/contracts';
import { matchesFilter, versionLabel } from '@/components/workspace/versions';

let db: DatabaseSync; let objects: Map<string, string>;
const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
const MINUTE = 60_000;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); const made = testEnv(); db = made.db; objects = made.objects; state.env = made.env; made.addUser('owner-a'); });
afterEach(() => { vi.useRealTimers(); db.close(); });

const body = (text: string) => EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const kinds = () => (db.prepare("SELECT kind FROM document_versions ORDER BY rowid").all() as Array<{ kind: string }>).map((row) => row.kind);
const autos = () => db.prepare("SELECT id,snapshot_r2_key AS key,revision,label FROM document_versions WHERE kind='auto' ORDER BY created_at").all() as Array<{ id: string; key: string; revision: number; label: string }>;

describe('UX 3: automatic versions', () => {
  it('snapshots at most once per 30 minutes of editing, and only when the content changed', async () => {
    const created = await createDocument('owner-a', { title: 'A', language: 'id', content: body('awal') });
    let revision = created.revision;
    const save = async (minutes: number, text: string) => { vi.setSystemTime(T0 + minutes * MINUTE); const saved = await autosaveDocument('owner-a', created.id, revision, body(text)); revision = saved.revision; return saved as { autoVersion?: boolean }; };
    expect((await save(5, 'dua')).autoVersion).toBeUndefined(); // 5 minutes after the Original
    expect((await save(31, 'tiga')).autoVersion).toBe(true);
    expect(autos()).toEqual([expect.objectContaining({ revision, label: 'Automatic version' })]);
    expect((await save(45, 'empat')).autoVersion).toBeUndefined(); // 14 minutes after the last one
    expect((await save(75, 'empat')).autoVersion).toBe(true); // content differs from the last version (tiga)
    expect((await save(120, 'empat')).autoVersion).toBeUndefined(); // unchanged since the last version
    expect(AUTO_VERSION_INTERVAL_MS).toBe(30 * MINUTE);
    // A manual checkpoint also counts as a recent version.
    vi.setSystemTime(T0 + 130 * MINUTE); await createCheckpoint('owner-a', created.id, revision, null); revision += 1;
    expect((await save(140, 'lima')).autoVersion).toBeUndefined();
  });

  it('keeps the newest 20 automatic versions, deletes older ones with their R2 objects, and never touches other kinds', async () => {
    const created = await createDocument('owner-a', { title: 'A', language: 'id', content: body('awal') });
    let revision = created.revision;
    vi.setSystemTime(T0 + MINUTE); await createCheckpoint('owner-a', created.id, revision, 'Manual'); revision += 1;
    const seen: string[] = [];
    for (let index = 1; index <= AUTO_VERSION_KEEP + 5; index++) {
      vi.setSystemTime(T0 + index * 31 * MINUTE);
      revision = (await autosaveDocument('owner-a', created.id, revision, body(`isi ${index}`))).revision;
      seen.push(autos().at(-1)!.key);
    }
    expect(autos()).toHaveLength(AUTO_VERSION_KEEP);
    const pruned = seen.slice(0, 5);
    for (const key of pruned) expect(objects.has(key)).toBe(false);
    for (const key of seen.slice(5)) expect(objects.has(key)).toBe(true);
    expect(kinds().filter((kind) => kind !== 'auto')).toEqual(['original', 'checkpoint']);
    expect((await listVersions('owner-a', created.id, undefined, 50)).items.filter((version) => version.kind === 'auto')).toHaveLength(AUTO_VERSION_KEEP);
  });

  it('never lets an automatic version stand in for the checkpoint before a restore', async () => {
    const created = await createDocument('owner-a', { title: 'A', language: 'id', content: body('awal') });
    vi.setSystemTime(T0 + 31 * MINUTE);
    const saved = await autosaveDocument('owner-a', created.id, created.revision, body('baru'));
    expect(autos()).toHaveLength(1);
    const original = (await listVersions('owner-a', created.id)).items.find((version) => version.kind === 'original')!;
    await restoreVersion('owner-a', created.id, original.id, saved.revision);
    expect(kinds()).toEqual(['original', 'auto', 'checkpoint', 'restore']);
  });

  it('keeps an automatic version the writer named, as an ordinary checkpoint', async () => {
    const created = await createDocument('owner-a', { title: 'A', language: 'id', content: body('awal') });
    vi.setSystemTime(T0 + 31 * MINUTE);
    await autosaveDocument('owner-a', created.id, created.revision, body('baru'));
    const named = await updateVersionLabel('owner-a', created.id, autos()[0]!.id, 'Draf untuk dosen');
    expect(named).toMatchObject({ kind: 'checkpoint', label: 'Draf untuk dosen' });
    expect(autos()).toHaveLength(0);
  });

  it('shows automatic versions under their own Riwayat filter', () => {
    const auto = { id: 'a', kind: 'auto' as const, label: 'Automatic version', revision: 3, createdAt: '' };
    const manual = { id: 'b', kind: 'checkpoint' as const, label: 'Manual checkpoint', revision: 2, createdAt: '' };
    expect(matchesFilter(auto, 'auto')).toBe(true);
    expect(matchesFilter(auto, 'manual')).toBe(false);
    expect(matchesFilter(manual, 'manual')).toBe(true);
    expect(matchesFilter(auto, 'all')).toBe(true);
    expect(versionLabel(auto, (id) => id)).toBe('Versi otomatis');
  });
});
