import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown>, user: 'free-user' }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));
vi.mock('@/server/auth/auth', () => ({
  requireUser: async () => ({ id: state.user }),
  isAdminRole: (role: string | null | undefined) => (role ?? '').split(',').includes('admin'),
}));

import { GET, PATCH } from '@/app/api/settings/route';
import { adminActivatePlan, adminEndPlan } from '@/server/access/periods';
import { newNotebookBody } from '@/lib/writing/new-notebook';
import { opensPaged } from '@/lib/writing/preferences';
import { ADVANCED_PREFERENCE } from '@/lib/plans';

let db: DatabaseSync;
beforeEach(() => { const made = testEnv(); db = made.db; state.env = made.env; made.addUser('admin-1', 'admin'); made.addUser('free-user'); made.addUser('pro-user'); });
afterEach(() => db.close());

const base = { interfaceLanguage: 'id', writingLanguage: 'auto', defaultMode: 'P03_HUMANIZER', primaryUseCase: 'general', humanizerContext: 'general', localDrafts: true };
const patch = (body: unknown) => PATCH(new Request('http://localhost/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) }));
const read = async () => ((await (await GET(new Request('http://localhost/api/settings'))).json()) as { data: Record<string, unknown> }).data;

describe('UX 2: Kanvas bawaan', () => {
  it('starts on Teks and refuses Halaman without the page canvas', async () => {
    state.user = 'free-user';
    expect(await read()).toMatchObject({ defaultCanvas: 'text' });
    const refused = await patch({ ...base, defaultCanvas: 'page' });
    expect(refused.status).toBe(403);
    expect((await refused.json()) as unknown).toMatchObject({ error: { code: 'FEATURE_LOCKED', details: { feature: 'advanced_notebook', requiredTier: 'pro' } } });
    expect((await patch({ ...base, defaultCanvas: 'text' })).status).toBe(200);
    expect((await patch({ ...base, defaultCanvas: 'sheet' })).status).toBe(400);
  });

  it('lets Pro choose Halaman, keeps it when a client leaves the field out, and keeps it after a downgrade', async () => {
    state.user = 'pro-user';
    await adminActivatePlan({ actorId: 'admin-1', ownerId: 'pro-user', plan: 'pro' });
    expect((await patch({ ...base, defaultCanvas: 'page' })).status).toBe(200);
    expect(await read()).toMatchObject({ defaultCanvas: 'page' });
    // Onboarding and the language menu send no canvas; that must not reset it.
    expect((await patch({ ...base, writingLanguage: 'en' })).status).toBe(200);
    expect(await read()).toMatchObject({ defaultCanvas: 'page', writingLanguage: 'en' });
    await adminEndPlan({ actorId: 'admin-1', ownerId: 'pro-user', reason: 'test downgrade' });
    expect((await patch({ ...base, defaultCanvas: 'page' })).status).toBe(200);
    expect(await read()).toMatchObject({ defaultCanvas: 'page' });
  });

  it('opens new notebooks on Halaman only with the canvas, and the dialog choice still wins', () => {
    const context = { defaultMode: 'P03_HUMANIZER', writingLanguage: 'auto' as const, humanizerContext: 'general', locale: 'id' as const, now: new Date('2026-10-01T00:00:00Z') };
    expect(opensPaged('page', true)).toBe(true);
    expect(opensPaged('page', false)).toBe(false);
    expect(opensPaged('text', true)).toBe(false);
    expect(newNotebookBody('essay', {}, { ...context, advancedNotebook: true, defaultPaged: true }).preferences[ADVANCED_PREFERENCE]).toBe(true);
    expect(Object.hasOwn(newNotebookBody('essay', { paged: false }, { ...context, advancedNotebook: true, defaultPaged: true }).preferences, ADVANCED_PREFERENCE)).toBe(false);
    expect(Object.hasOwn(newNotebookBody('essay', {}, { ...context, advancedNotebook: false, defaultPaged: true }).preferences, ADVANCED_PREFERENCE)).toBe(false);
  });
});
