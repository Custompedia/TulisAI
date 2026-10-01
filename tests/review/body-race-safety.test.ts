import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQLInputValue } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

// Data-safety review of the R2 bodies: two identical autosaves racing on one revision used to share one object
// (the key was revision + hash), so the loser's clean-up deleted the body the winner had just pointed the row at.
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { autosaveDocument, createCheckpoint, createDocument, getDocument } from '@/server/documents/service';
import { REFERENCE_CHUNK, sweepOrphanSnapshots } from '@/server/storage/maintenance';
import { whenIdle } from '@/lib/client/api';
import { EditorDocumentSchema } from '@/lib/contracts';

let setup: ReturnType<typeof testEnv>;
beforeEach(() => { setup = testEnv(); state.env = setup.env; setup.addUser('owner'); });
const doc = (text: string) => EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const row = (id: string) => setup.db.prepare('SELECT body_r2_key, revision FROM documents WHERE id=?').get(id) as { body_r2_key: string; revision: number };

describe('concurrent autosaves', () => {
  it('lets one of two identical saves win and keeps its body readable', async () => {
    const created = await createDocument('owner', { title: 'A', language: 'id', content: doc('a') });
    const results = await Promise.allSettled([autosaveDocument('owner', created.id, 0, doc('b')), autosaveDocument('owner', created.id, 0, doc('b'))]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'REVISION_CONFLICT' });
    // The row points at an object that exists, and every object any row references is still there.
    expect(setup.objects.has(row(created.id).body_r2_key)).toBe(true);
    expect((await getDocument('owner', created.id)).content).toEqual(doc('b'));
    const referenced = setup.db.prepare('SELECT snapshot_r2_key AS key FROM document_versions UNION SELECT body_r2_key AS key FROM documents WHERE body_r2_key IS NOT NULL').all() as Array<{ key: string }>;
    for (const { key } of referenced) expect(setup.objects.has(key), key).toBe(true);
    // The loser's own object was removed; only the live body remains under body/.
    expect([...setup.objects.keys()].filter((key) => key.includes('/body/'))).toEqual([row(created.id).body_r2_key]);
  });

  it('gives every write its own body key, even for the same revision and content', async () => {
    const created = await createDocument('owner', { title: 'A', language: 'id', content: doc('a') });
    await autosaveDocument('owner', created.id, 0, doc('same'));
    expect(row(created.id).body_r2_key).toMatch(new RegExp(`^documents/${created.id}/body/1-[0-9a-f-]{36}\\.json$`));
  });

  it('answers a conflict, not a 500, when an autosave replaces the body a checkpoint was reading', async () => {
    const created = await createDocument('owner', { title: 'A', language: 'id', content: doc('a') });
    await autosaveDocument('owner', created.id, 0, doc('b'));
    const documents = setup.env.DOCUMENTS as { get: (key: string) => Promise<unknown> };
    const get = documents.get; let raced = false;
    // The first body read lets an autosave land first: it moves the row on and deletes the body being read.
    documents.get = async (key: string) => {
      if (!raced && key.includes('/body/')) { raced = true; await autosaveDocument('owner', created.id, 1, doc('c')); }
      return get(key);
    };
    await expect(createCheckpoint('owner', created.id, 1, 'Bab 1')).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409 });
    documents.get = get;
    expect((await getDocument('owner', created.id)).content).toEqual(doc('c'));
  });
});

describe('orphan sweep', () => {
  // D1 refuses more than 100 bound parameters; the double here does too, which the old sweep (two per key) broke on.
  const limitParameters = () => {
    const db = setup.env.DB as { prepare: (sql: string) => { bind: (...values: SQLInputValue[]) => unknown } };
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const statement = prepare(sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: SQLInputValue[]) => { if (values.length > 100) throw new Error('too many SQL variables'); return bind(...values); };
      return statement;
    };
  };
  const old = new Date(0);
  const listing = (keys: string[]) => { (setup.env.DOCUMENTS as { list: unknown }).list = async () => ({ objects: keys.map((key) => ({ key, uploaded: old })), truncated: false }); };

  it('checks references 40 keys at a time, so a page of 100 old objects is swept', async () => {
    const created = await createDocument('owner', { title: 'A', language: 'id', content: doc('a') });
    const live = row(created.id).body_r2_key;
    const keys = [live, ...Array.from({ length: 99 }, (_, index) => `documents/${created.id}/body/9-orphan-${index}.json`)];
    for (const key of keys) if (!setup.objects.has(key)) setup.objects.set(key, '{}');
    listing(keys); limitParameters();
    expect(REFERENCE_CHUNK * 2).toBeLessThanOrEqual(100);
    const result = await sweepOrphanSnapshots(setup.env as never, Date.now());
    expect(result).toMatchObject({ scanned: 100, deleted: 99 });
    expect(setup.objects.has(live)).toBe(true);
  });

  it('deletes nothing whose reference check failed', async () => {
    const keys = Array.from({ length: 60 }, (_, index) => `documents/x/body/1-orphan-${index}.json`);
    for (const key of keys) setup.objects.set(key, '{}');
    listing(keys);
    const db = setup.env.DB as { prepare: (sql: string) => unknown };
    const prepare = db.prepare.bind(db); let lookups = 0;
    db.prepare = (sql: string) => { if (sql.includes('snapshot_r2_key IN') && ++lookups === 2) throw new Error('D1 unavailable'); return prepare(sql); };
    const result = await sweepOrphanSnapshots(setup.env as never, Date.now());
    // The first 40 were checked and are orphans; the 20 in the failed lookup stay.
    expect(result.deleted).toBe(40);
    for (const key of keys.slice(40)) expect(setup.objects.has(key)).toBe(true);
  });
});

describe('client saves run one at a time', () => {
  it('makes callers that arrive during a save wait for it, then read the state afresh', async () => {
    const inFlight: { current: Promise<unknown> | null } = { current: null };
    let dirty = true; let active = 0; let most = 0; const sent: number[] = [];
    // The same shape as Workspace.flush: wait until idle, then save only if something is still unsaved.
    const flush = async () => {
      await whenIdle(inFlight);
      const run = (async () => {
        if (!dirty) return 'clean';
        dirty = false; active++; most = Math.max(most, active); sent.push(sent.length);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return 'saved';
      })();
      inFlight.current = run;
      try { return await run; } finally { if (inFlight.current === run) inFlight.current = null; }
    };
    const results = await Promise.all([flush(), flush(), flush(), flush()]);
    expect(sent).toHaveLength(1);
    expect(most).toBe(1);
    expect(results.sort()).toEqual(['clean', 'clean', 'clean', 'saved']);
  });
});
