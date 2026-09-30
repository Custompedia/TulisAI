import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown>, session: { id: 'admin-1', role: 'admin' } }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));
vi.mock('@/server/auth/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/auth')>();
  return { ...actual, requireAdmin: async () => { if (state.session.role !== 'admin') throw new actual.ForbiddenError(); return state.session; } };
});

import { POST as action } from '@/app/api/admin/users/[id]/actions/route';
import { adminActivatePlan } from '@/server/access/periods';
import { grantAdminCharacters, listAdminGrants } from '@/server/usage/admin-grants';
import { reserveCharacters, settleReservation, walletSummary } from '@/server/usage/wallet';
import { actionLabel, ADMIN_ACTIONS, detailSummary } from '@/components/admin/admin-shared';

let db: DatabaseSync;
beforeEach(() => {
  const made = testEnv(); db = made.db; state.env = made.env; state.session = { id: 'admin-1', role: 'admin' };
  made.addUser('admin-1', 'admin'); made.addUser('plus-user'); made.addUser('free-user'); made.addUser('mallory');
});
afterEach(() => db.close());

const key = () => crypto.randomUUID();
const grant = (ownerId: string, requestKey = key(), amount = 5_000, extra: Partial<{ validityDays: number; note: string; now: number }> = {}) =>
  grantAdminCharacters({ actorId: 'admin-1', ownerId, amount, validityDays: extra.validityDays ?? 30, note: extra.note ?? 'Kompensasi gangguan', requestKey, now: extra.now });
const lots = (owner: string) => db.prepare("SELECT original_amount,state,catalog_item_id,identity_link_id FROM character_purchased_lots WHERE owner_id=?").all(owner);
const audits = (owner: string) => db.prepare("SELECT action,actor_id,details_json FROM admin_audit_log WHERE target_user_id=? AND action='wallet.admin.grant'").all(owner) as Array<{ action: string; actor_id: string; details_json: string }>;
const post = (userId: string, body: unknown) => action(new Request(`http://localhost/api/admin/users/${userId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key() }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: userId }) });

describe('UX 2: admin character grant', () => {
  it('credits a spendable lot to a paid account, with a wallet event and an audit entry in the same batch', async () => {
    await adminActivatePlan({ actorId: 'admin-1', ownerId: 'plus-user', plan: 'plus' });
    const before = await walletSummary('plus-user');
    const result = await grant('plus-user');
    expect(result.replayed).toBe(false);
    expect(lots('plus-user')).toEqual([{ original_amount: 5_000, state: 'frozen', catalog_item_id: 'admin_grant', identity_link_id: null }]);
    const after = await walletSummary('plus-user');
    expect(after.spendableTotal).toBe(before.spendableTotal + 5_000);
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_wallet_events WHERE owner_id='plus-user' AND event_type='admin_grant_issued' AND quantity=5000").get()).toEqual({ n: 1 });
    const [entry] = audits('plus-user');
    expect(entry).toMatchObject({ action: 'wallet.admin.grant', actor_id: 'admin-1' });
    expect(JSON.parse(entry!.details_json)).toMatchObject({ amount: 5_000, validityDays: 30, note: 'Kompensasi gangguan', lotId: result.lotId });
  });

  it('is idempotent per request key and refuses the same key with other facts', async () => {
    const requestKey = key();
    const first = await grant('plus-user', requestKey);
    const again = await grant('plus-user', requestKey, 5_000, { now: Date.now() + 60_000 });
    expect(again).toEqual({ ...first, replayed: true });
    expect(lots('plus-user')).toHaveLength(1);
    expect(audits('plus-user')).toHaveLength(1);
    await expect(grant('plus-user', requestKey, 9_000)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    await expect(grant('mallory', requestKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(lots('plus-user')).toHaveLength(1);
    expect(lots('mallory')).toHaveLength(0);
  });

  it('spends the grant after the included allowance and never beyond it', async () => {
    await adminActivatePlan({ actorId: 'admin-1', ownerId: 'plus-user', plan: 'plus' });
    await grant('plus-user', key(), 1_000);
    await walletSummary('plus-user'); // issues the period's included grant
    db.prepare("UPDATE character_grants SET settled_amount=original_amount-500 WHERE owner_id='plus-user' AND kind='included'").run();
    const { reservation } = await reserveCharacters({ ownerId: 'plus-user', idempotencyKey: key(), fingerprint: 'f', operation: 'P01_STANDARD_REWRITE', sourceCharacters: 1_200 });
    await settleReservation(reservation.id, 1_200, 'result');
    expect(db.prepare("SELECT source_kind,settled_amount FROM character_allocations WHERE reservation_id=? ORDER BY ordinal").all(reservation.id))
      .toEqual([{ source_kind: 'included_grant', settled_amount: 500 }, { source_kind: 'purchased_lot', settled_amount: 700 }]);
    await expect(reserveCharacters({ ownerId: 'plus-user', idempotencyKey: key(), fingerprint: 'g', operation: 'P01_STANDARD_REWRITE', sourceCharacters: 301 })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect((await listAdminGrants('plus-user'))[0]).toMatchObject({ amount: 1_000, remaining: 300, state: 'active' });
  });

  it('stays frozen on a Free account, like a top-up, and expires on time', async () => {
    const now = Date.now();
    await grant('free-user', key(), 2_000, { validityDays: 1, now });
    const free = await walletSummary('free-user');
    expect(free.spendableTotal).toBe(3_000);
    expect(free.purchased.frozen).toBe(2_000);
    expect((await walletSummary('free-user', now + 2 * 86_400_000)).purchased).toMatchObject({ frozen: 0, expired: 2_000 });
  });

  it('validates the amount, validity and note', async () => {
    await expect(grant('plus-user', key(), 0)).rejects.toMatchObject({ code: 'GRANT_INVALID' });
    await expect(grant('plus-user', key(), 500_001)).rejects.toMatchObject({ code: 'GRANT_INVALID' });
    await expect(grant('plus-user', key(), 10, { validityDays: 366 })).rejects.toMatchObject({ code: 'GRANT_INVALID' });
    await expect(grant('plus-user', key(), 10, { note: '  ' })).rejects.toMatchObject({ code: 'GRANT_INVALID' });
    expect(lots('plus-user')).toEqual([]);
  });

  it('is admin-only through the actions route, and a replayed submit credits once', async () => {
    const requestKey = key();
    const body = { action: 'grant-characters', amount: 1_500, validityDays: 90, note: 'Uji coba', requestKey };
    state.session = { id: 'mallory', role: 'user' };
    expect((await post('mallory', body)).status).toBe(403);
    expect(lots('mallory')).toEqual([]);
    state.session = { id: 'admin-1', role: 'admin' };
    expect((await post('plus-user', { ...body, requestKey: 'not-a-uuid' })).status).toBe(400);
    expect((await post('plus-user', body)).status).toBe(200);
    expect((await post('plus-user', body)).status).toBe(200);
    expect(lots('plus-user')).toHaveLength(1);
    expect(audits('plus-user')).toHaveLength(1);
  });

  it('has a label in the admin log', () => {
    const t = (id: string) => id;
    expect(ADMIN_ACTIONS).toContain('wallet.admin.grant');
    expect(actionLabel('wallet.admin.grant', t)).toBe('Menghibahkan karakter');
    expect(detailSummary({ id: 'a', actorId: 'x', actorName: null, targetUserId: 'y', targetName: null, action: 'wallet.admin.grant', details: { amount: 5000, expiresAt: '2026-10-31T00:00:00.000Z', note: 'Uji' }, createdAt: '' }, t)).toBe('5.000 karakter · sampai 2026-10-31 · Uji');
  });
});
