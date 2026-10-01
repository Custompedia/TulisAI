import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { applyMigrations } from '../helpers/migrations';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, ConfigurationError: class extends Error {} }));

import { autosaveDocument, createDocument, getDocument } from '@/server/documents/service';
import { DocumentCreateSchema, EditorDocumentSchema } from '@/lib/contracts';
import { PREMIUM_PERSISTED_KEYS } from '@/server/usage/premium';
import { ADVANCED_PREFERENCE, PAGE_LAYOUT_PREFERENCES } from '@/lib/plans';
import { autosavePreferences, clampPreferenceValues, copyPreferences, META_VALUE_LIMIT, NOTEBOOK_META_KEYS, readMeta } from '@/lib/writing/notebook-meta';
import { defaults, normalizeSettings, type Settings } from '@/lib/writing/settings';
import { layoutPreferences, readLayout } from '@/components/workspace/page-layout';

let db: DatabaseSync;
const objects = new Map<string, string>();
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  execute() { const result = db.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
  async run() { return this.execute(); }
}

beforeEach(() => {
  db = new DatabaseSync(':memory:'); applyMigrations(db); objects.clear();
  state.env = {
    DB: { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => statements.map((statement) => statement.execute()) },
    DOCUMENTS: { head: async (key: string) => objects.has(key) ? { key, size: objects.get(key)!.length } : null, put: async (key: string, value: string) => { objects.set(key, value); return { key }; }, get: async (key: string) => { const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value }; }, delete: async () => undefined },
    AI_MONTHLY_REQUEST_LIMIT: '100', AI_FREE_CHARACTER_ALLOWANCE: '3000',
  };
  db.prepare("INSERT INTO user (id,name,email,role,tier,created_at,updated_at) VALUES ('free','F','free@example.test','user','free',1,1)").run();
});
afterEach(() => db.close());

const content = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'isi notebook' }] }] });
const longBrief = 'b'.repeat(700);
const settings: Settings = normalizeSettings({ ...defaults, mode: 'creative', styleId: 'style-1', extra: 'catatan', customized: true });
const layout = layoutPreferences(readLayout(undefined, 'id'));

describe('notebook facts survive saves and copies', () => {
  it('keeps only whitelisted keys, clamped, and never a premium key name', () => {
    for (const key of NOTEBOOK_META_KEYS) expect((PREMIUM_PERSISTED_KEYS as readonly string[]).includes(key), key).toBe(false);
    for (const key of NOTEBOOK_META_KEYS) expect(Object.hasOwn(defaults, key), key).toBe(false);
    const meta = readMeta({ docType: 'script', docSource: 'skeleton', wordTarget: 800, briefPlatform: longBrief, notes: 'n', mode: 'humanize', wordTargetx: 1, briefCta: 42 });
    expect(meta).toEqual({ docType: 'script', docSource: 'skeleton', wordTarget: 800, briefPlatform: 'b'.repeat(META_VALUE_LIMIT), notes: 'n' });
    expect(readMeta({ wordTarget: -1 })).toEqual({});
    expect(readMeta({ wordTarget: 1.5 })).toEqual({});
    expect(readMeta(null)).toEqual({});
  });

  it('keeps docType, brief and target through an autosave round trip', async () => {
    const created = await createDocument('free', { title: 'Script', language: 'id', content, preferences: clampPreferenceValues({ ...defaults, docType: 'script', docSource: 'skeleton', wordTarget: 300 }) });
    // What the editor sends on its first autosave, built from what it loaded.
    const loaded = await getDocument('free', created.id);
    const meta = { ...readMeta(loaded.preferences), briefPlatform: longBrief, briefCta: 'Ikuti akun' };
    const preferences = autosavePreferences({ settings: normalizeSettings(loaded.preferences), layout, advanced: false, meta });
    await autosaveDocument('free', created.id, loaded.revision, content, { preferences });
    const saved = (await getDocument('free', created.id)).preferences!;
    expect(saved).toMatchObject({ docType: 'script', docSource: 'skeleton', wordTarget: 300, briefCta: 'Ikuti akun' });
    expect((saved.briefPlatform as string).length).toBe(META_VALUE_LIMIT);
    // A second save from the reloaded row keeps them again.
    const again = autosavePreferences({ settings: normalizeSettings(saved), layout, advanced: false, meta: readMeta(saved) });
    await autosaveDocument('free', created.id, loaded.revision + 1, content, { preferences: again });
    expect((await getDocument('free', created.id)).preferences).toMatchObject({ docType: 'script', wordTarget: 300 });
  });

  it('never sends layout keys, the canvas flag or a skill id a free account cannot use when copying', async () => {
    const body = copyPreferences({ settings, layout, advanced: true, meta: { docType: 'essay', briefMessage: longBrief } }, { advancedNotebook: false, savedStyles: false });
    for (const key of [ADVANCED_PREFERENCE, ...PAGE_LAYOUT_PREFERENCES]) expect(Object.hasOwn(body, key), key).toBe(false);
    expect(body.styleId).toBeNull();
    expect(body).toMatchObject({ docType: 'essay', docSource: 'copy' });
    // The copy body passes create's own validation (no 400) and create's feature gates (no 403).
    const input = DocumentCreateSchema.parse({ title: 'Salinan', content, language: 'id', preferences: body });
    await expect(createDocument('free', input)).resolves.toMatchObject({ preferences: expect.objectContaining({ docType: 'essay', docSource: 'copy' }) });
  });

  it('would have been refused without the rule, and keeps layout for accounts that have the canvas', async () => {
    const raw = DocumentCreateSchema.parse({ title: 'Salinan', content, language: 'id', preferences: { ...settings, ...layout, advanced: true } });
    await expect(createDocument('free', raw)).rejects.toMatchObject({ code: 'FEATURE_LOCKED' });
    const pro = copyPreferences({ settings, layout, advanced: true, meta: {} }, { advancedNotebook: true, savedStyles: true });
    expect(pro).toMatchObject({ [ADVANCED_PREFERENCE]: true, styleId: 'style-1', pageSize: layout.pageSize });
  });

  it('clamps every string a copy or restore sends, so a long brief never turns into a 400', () => {
    const body = copyPreferences({ settings: { ...settings, sample: 's'.repeat(900) }, layout, advanced: false, meta: { notes: longBrief } }, { advancedNotebook: false, savedStyles: true });
    for (const value of Object.values(body)) if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(META_VALUE_LIMIT);
    expect(() => DocumentCreateSchema.parse({ title: 'Pemulihan', content, preferences: body })).not.toThrow();
    expect(clampPreferenceValues({ focus: Array.from({ length: 30 }, () => 'x'.repeat(400)), bad: { nested: true }, n: Number.NaN })).toEqual({ focus: Array.from({ length: 20 }, () => 'x'.repeat(300)) });
  });
});
