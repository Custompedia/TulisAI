import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { applyMigrations } from '../helpers/migrations';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../../src/server/runtime', () => ({
  runtime: () => state.env,
  requiredSetting: (value: string) => value,
  ConfigurationError: class extends Error {},
}));

import { autosaveDocument, createDocument, getDocument } from '../../src/server/documents/service';
import { createStyle, deleteStyle, listStyles } from '../../src/server/writing/styles';
import { defaults } from '../../src/lib/writing/settings';
import { entitlement, usageSummary } from '../../src/server/usage/quota';
import { assertFeature, requireFeature } from '../../src/server/usage/features';
import { EditorDocumentSchema } from '../../src/lib/contracts';
import { FEATURES, MAX_RUN_LIMIT, PLAN_LIMITS, requiredTierFor, TIERS } from '../../src/lib/plans';

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } }; }
  async run() { return this.execute(); }
}

const objects = new Map<string, string>();
const account = (id: string, tier: string, role = 'user') =>
  db.prepare(`INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES ('${id}','U','${id}@example.test','${id}','${role}','${tier}',1,1)`).run();

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  applyMigrations(db);
  objects.clear();
  state.env = {
    DB: { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => {
      db.exec('BEGIN');
      try { const results = statements.map((statement) => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } },
    DOCUMENTS: {
      head: async (key: string) => (objects.has(key) ? { key, size: objects.get(key)!.length } : null),
      put: async (key: string, value: string) => { objects.set(key, value); return { key }; },
      get: async (key: string) => { const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value, arrayBuffer: async () => new TextEncoder().encode(value).buffer }; },
      delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    },
    AI_MONTHLY_REQUEST_LIMIT: '100', AI_FREE_CHARACTER_ALLOWANCE: '100000',
  };
});
afterEach(() => { db.close(); });

const content = (text: string) => EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('review: entitlements are resolved from the account, not the client', () => {
  it('gives the free plan to an unknown account and locks every paid feature', async () => {
    const rights = await entitlement('nobody');
    expect(rights.tier).toBe('free');
    expect(rights.features).toEqual([]);
    expect(rights.limits.runLimit).toBe(PLAN_LIMITS.free.runLimit);
    for (const feature of FEATURES) expect(() => assertFeature(rights, feature)).toThrowError(/paid plan/);
  });

  it('keeps unlinked legacy tiers as noncommercial compatibility authority', async () => {
    const expected: Record<string, readonly string[]> = {
      plus: ['saved_styles'],
      pro: ['saved_styles', 'advanced_notebook', 'docx_import', 'docx_export'],
      max: FEATURES.filter((feature) => feature !== 'purchase_topup'),
    };
    for (const tier of TIERS.filter((value) => value !== 'free')) {
      account(`user-${tier}`, tier);
      const rights = await entitlement(`user-${tier}`);
      expect(rights.tier).toBe(tier);
      expect(rights.access).toMatchObject({ authority: 'legacy_local', commercialActive: false, plan: null, topupEligible: false });
      expect([...rights.features].sort()).toEqual([...expected[tier]].sort());
      for (const feature of FEATURES) {
        const allowed = expected[tier].includes(feature);
        if (allowed) expect(() => assertFeature(rights, feature)).not.toThrow();
        else expect(() => assertFeature(rights, feature)).toThrowError(/paid plan/);
      }
    }
    expect(requiredTierFor('saved_styles')).toBe('plus');
    expect(requiredTierFor('docx_import')).toBe('pro');
    expect(requiredTierFor('freeform_prompt')).toBe('max');
  });

  it('keeps a legacy team row on the rights it was sold, not on free', async () => {
    account('legacy', 'team');
    const rights = await entitlement('legacy');
    expect(rights.tier).toBe('pro');
    expect(() => assertFeature(rights, 'docx_export')).not.toThrow();
    expect(() => assertFeature(rights, 'freeform_prompt')).toThrowError(/paid plan/);
  });

  it('treats an admin as unlimited and noncommercial with no top-up capability', async () => {
    // An admin row still says tier 'free'. Holding every feature but running into the 1,000-character free
    // cap was the bug this covers.
    account('boss', 'free', 'admin');
    const rights = await entitlement('boss');
    expect(rights.unlimited).toBe(true);
    expect([...rights.features].sort()).toEqual(FEATURES.filter((feature) => feature !== 'purchase_topup').sort());
    expect(rights.access).toMatchObject({ authority: 'local_admin', commercialActive: false, plan: null, topupEligible: false });
    expect(rights.limits.runLimit).toBe(MAX_RUN_LIMIT);
    expect(rights.limits.runLimit).toBe(PLAN_LIMITS.pro.runLimit);
    expect(rights.characterLimit).toBeGreaterThan(PLAN_LIMITS.max.includedCharacters);
    const summary = await usageSummary('boss');
    expect(summary.limits.runLimit).toBe(MAX_RUN_LIMIT);
  });

  it('reports FEATURE_LOCKED with the feature and the tier a client can act on', async () => {
    await expect(requireFeature('nobody', 'docx_export')).rejects.toMatchObject({
      code: 'FEATURE_LOCKED', status: 403, details: { feature: 'docx_export', requiredTier: 'pro' },
    });
  });

  it('grants the free allowance once per account, not once per month', async () => {
    const spend = (period: string) => db.prepare(`INSERT INTO usage_ledger (id,owner_id,idempotency_key,operation,status,period_key,request_id,source_characters,charge_characters,created_at) VALUES ('${period}','trial','${period}','generate','completed','${period}','r',500,500,1)`).run();
    spend('2000-01');
    const free = await usageSummary('trial');
    expect(free.characterScope).toBe('account');
    // A run from an old period still counts: the trial is not refilled by the calendar.
    expect(free.charactersUsed).toBe(500);

    account('subscriber', 'plus');
    db.prepare("INSERT INTO usage_ledger (id,owner_id,idempotency_key,operation,status,period_key,request_id,source_characters,charge_characters,created_at) VALUES ('old','subscriber','old','generate','completed','2000-01','r',500,500,1)").run();
    const paid = await usageSummary('subscriber');
    expect(paid.characterScope).toBe('period');
    expect(paid.charactersUsed).toBe(0);
    expect(paid.characterLimit).toBe(PLAN_LIMITS.plus.includedCharacters);
  });

  it('sells saved skills from Plus while leaving what a free account already saved readable and deletable', async () => {
    account('writer', 'plus');
    const style = await createStyle('writer', { name: 'Email klien', description: null, color: null, icon: null, settings: defaults });
    db.prepare("UPDATE user SET tier='free' WHERE id='writer'").run();
    await expect(createStyle('writer', { name: 'Lainnya', description: null, color: null, icon: null, settings: defaults }))
      .rejects.toMatchObject({ code: 'FEATURE_LOCKED', status: 403, details: { feature: 'saved_styles', requiredTier: 'plus' } });
    expect((await listStyles('writer')).map((saved) => saved.id)).toEqual([style.id]);
    await expect(deleteStyle('writer', style.id)).resolves.toBeUndefined();
  });

  it('lets a per-user character override beat the tier quota', async () => {
    account('generous', 'free');
    db.prepare("UPDATE user SET ai_character_limit_override=250000 WHERE id='generous'").run();
    const summary = await usageSummary('generous');
    expect(summary.characterLimit).toBe(250_000);
    expect(summary.charactersRemaining).toBe(250_000);
  });
});

describe('review: advanced notebook mode cannot be switched on from the client', () => {
  it('refuses to create a notebook with the advanced flag on a free account', async () => {
    await expect(createDocument('free-user', { title: 'A', language: 'id', content: content('Teks'), preferences: { advanced: true } }))
      .rejects.toMatchObject({ code: 'FEATURE_LOCKED', status: 403 });
  });

  it('keeps the flag for a paid account', async () => {
    account('payer', 'pro');
    const doc = await createDocument('payer', { title: 'A', language: 'id', content: content('Teks'), preferences: { advanced: true } });
    expect((await getDocument('payer', doc.id)).preferences).toMatchObject({ advanced: true });
  });

  it('strips the flag on autosave instead of failing the save, so a writer is never locked out', async () => {
    const doc = await createDocument('free-user', { title: 'A', language: 'id', content: content('Teks') });
    const saved = await autosaveDocument('free-user', doc.id, doc.revision, content('Teks baru'), { preferences: { advanced: true, mode: 'standard' } });
    expect(saved.preferences).toEqual({ mode: 'standard' });
  });

  it('keeps the page size an import brought in, so the preview matches the source file', async () => {
    account('importer', 'pro');
    const doc = await createDocument('importer', { title: 'Letter doc', language: 'id', content: content('Teks'), preferences: { advanced: true, pageSize: 'letter' } });
    const stored = (await getDocument('importer', doc.id)).preferences;
    // A notebook imported from a Letter file must not fall back to the Indonesian A4 default.
    expect(stored).toMatchObject({ advanced: true, pageSize: 'letter' });
  });

  it('leaves other preferences untouched', async () => {
    const doc = await createDocument('free-user', { title: 'A', language: 'id', content: content('Teks'), preferences: { mode: 'academic', advanced: false } });
    expect((await getDocument('free-user', doc.id)).preferences).toEqual({ mode: 'academic', advanced: false });
  });
});
