import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { adminActivatePlan, adminEndPlan, type PaidPlan } from '@/server/access/periods';
import { autosaveDocument, createDocument, getDocument } from '@/server/documents/service';
import { createStyle, listStyles, updateStyle } from '@/server/writing/styles';
import { storedSettingsForAccess } from '@/server/usage/premium';
import { PLAN_LIMITS, type Tier } from '@/lib/plans';
import type { Entitlement } from '@/server/usage/quota';
import { EditorDocumentSchema } from '@/lib/contracts';

let db: DatabaseSync;
let addUser: (id: string, role?: string) => void;
beforeEach(() => { const made = testEnv(); db = made.db; state.env = made.env; addUser = made.addUser; addUser('admin-1', 'admin'); });
afterEach(() => db.close());

const rights = (tier: Tier) => ({ features: PLAN_LIMITS[tier].features }) as unknown as Entitlement;
const content = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi notebook.' }] }] });
const customize = { mode: 'standard', customized: true, format: 'bullets', length: 'shorter', audience: 'lecturer', focus: ['clarity'], extra: 'Catatan Max', sample: 'Contoh Max' };
async function account(id: string, tier: Tier) {
  addUser(id);
  if (tier !== 'free') await adminActivatePlan({ actorId: 'admin-1', ownerId: id, plan: tier as PaidPlan });
}

describe('UX 2: Sesuaikan persistence per tier (pure rule)', () => {
  it('Free strips the Sesuaikan flag and every Max key', () => {
    const next = storedSettingsForAccess(rights('free'), customize);
    expect(next.customized).toBeUndefined();
    expect(next).toMatchObject({ format: 'bullets', length: 'shorter', audience: 'lecturer', focus: ['clarity'] });
    expect(next.extra).toBeUndefined(); expect(next.sample).toBeUndefined();
  });
  it.each(['plus', 'pro'] as const)('%s keeps the flag with format, length, reader and emphasis, and still strips the note and sample', (tier) => {
    const next = storedSettingsForAccess(rights(tier), customize);
    expect(next).toMatchObject({ customized: true, format: 'bullets', length: 'shorter', audience: 'lecturer', focus: ['clarity'] });
    expect(next.extra).toBeUndefined(); expect(next.sample).toBeUndefined();
  });
  it('Max keeps everything', () => {
    expect(storedSettingsForAccess(rights('max'), customize)).toEqual(customize);
  });
  it('a Plus request can never add, replace or clear a Max value, but may clear its own flag', () => {
    const existing = { customized: true, extra: 'lama', sample: 'lama' };
    const next = storedSettingsForAccess(rights('plus'), { customized: false, extra: 'baru', sample: '', additional_instruction: 'x' }, existing);
    expect(next).toMatchObject({ customized: false, extra: 'lama', sample: 'lama' });
    expect(next.additional_instruction).toBeUndefined();
  });
  it('a Free request cannot turn the flag on, and an existing flag survives a downgrade', () => {
    expect(storedSettingsForAccess(rights('free'), { customized: true }, {}).customized).toBeUndefined();
    expect(storedSettingsForAccess(rights('free'), { customized: false }, { customized: true }).customized).toBe(true);
  });
});

describe('UX 2: Sesuaikan persistence per tier (notebooks and skills)', () => {
  it.each([['free', false], ['plus', true], ['pro', true], ['max', true]] as const)('%s notebook create and autosave keep customized=%s', async (tier, kept) => {
    const owner = `${tier}-user`; await account(owner, tier);
    const doc = await createDocument(owner, { title: 'N', language: 'id', content, preferences: customize });
    expect(doc.preferences?.customized === true).toBe(kept);
    const saved = await autosaveDocument(owner, doc.id, doc.revision, content, { preferences: { ...customize, format: 'numbered_list' } });
    expect(saved.preferences?.customized === true).toBe(kept);
    expect(saved.preferences).toMatchObject({ format: 'numbered_list', length: 'shorter' });
    // The note and the sample are Max-only on every other plan.
    expect(saved.preferences?.extra === 'Catatan Max').toBe(tier === 'max');
    expect(saved.preferences?.sample === 'Contoh Max').toBe(tier === 'max');
  });

  it.each([['plus', true], ['pro', true], ['max', true]] as const)('%s skills keep customized=%s', async (tier, kept) => {
    const owner = `${tier}-skill`; await account(owner, tier);
    await createStyle(owner, { name: 'Caption singkat', description: null, color: null, icon: null, settings: customize });
    const [skill] = await listStyles(owner);
    expect(skill!.settings.customized).toBe(kept);
    expect(skill!.settings).toMatchObject({ format: 'bullets', length: 'shorter' });
    expect(skill!.settings.extra).toBe(tier === 'max' ? 'Catatan Max' : '');
    await updateStyle(owner, skill!.id, { settings: { ...customize, length: 'more_detailed' } });
    expect((await listStyles(owner))[0]!.settings).toMatchObject({ customized: true, length: 'more_detailed' });
  });

  it('Free cannot create skills at all', async () => {
    await account('free-skill', 'free');
    await expect(createStyle('free-skill', { name: 'X', description: null, color: null, icon: null, settings: customize })).rejects.toMatchObject({ code: 'FEATURE_LOCKED' });
  });

  it('a Max notebook downgraded to Plus keeps its note while Plus edits the format', async () => {
    await account('down', 'max');
    const doc = await createDocument('down', { title: 'N', language: 'id', content, preferences: customize });
    await adminEndPlan({ actorId: 'admin-1', ownerId: 'down', reason: 'downgrade test' });
    await adminActivatePlan({ actorId: 'admin-1', ownerId: 'down', plan: 'plus' });
    await autosaveDocument('down', doc.id, doc.revision, content, { preferences: { ...customize, extra: 'bypass', sample: '', format: 'table' } });
    expect((await getDocument('down', doc.id)).preferences).toMatchObject({ customized: true, format: 'table', extra: 'Catatan Max', sample: 'Contoh Max' });
  });
});
