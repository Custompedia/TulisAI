import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../../src/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { aiMetrics, assertBan, assertRemove, assertRoleChange, audit, getUser, listAudit, listUsers, listUserUsage, PAGE_LIMIT, parseRange, updateUser } from '../../src/server/admin/service';
import { entitlement, usageSummary } from '../../src/server/usage/quota';
import { handleRouteError } from '../../src/server/http';
import { ForbiddenError } from '../../src/server/auth/auth';

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  async run() { const value = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(value.changes) } }; }
}
const period = new Date().toISOString().slice(0, 7);
const addUser = (id: string, name: string, extra: Partial<{ role: string; tier: string; banned: number; banExpires: number | null; override: number | null; createdAt: number }> = {}) =>
  db.prepare('INSERT INTO user (id,name,email,username,role,tier,banned,ban_expires,ai_limit_override,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, `${id}@example.test`, id, extra.role ?? 'user', extra.tier ?? 'free', extra.banned ?? 0, extra.banExpires ?? null, extra.override ?? null, extra.createdAt ?? 1000, extra.createdAt ?? 1000);
const addUsage = (owner: string, status: string, tokens: [number, number], at = 5000, key = period) =>
  db.prepare('INSERT INTO usage_ledger (id,owner_id,idempotency_key,operation,status,period_key,request_id,created_at,input_tokens,output_tokens,prompt_id,latency_ms,error_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(), owner, crypto.randomUUID(), 'generate', status, key, 'r', at, tokens[0], tokens[1], 'P01_STANDARD_REWRITE', 120, status === 'failed' ? 'timeout' : null);

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of ['0000_initial', '0001_username_auth', '0002_workspace_metadata', '0003_notebook_appearance', '0004_writing_styles', '0005_user_role', '0006_admin_panel', '0007_usage_created_index']) db.exec(readFileSync(`migrations/${file}.sql`, 'utf8'));
  state.env = { DB: { prepare: (sql: string) => new Statement(sql) }, AI_MONTHLY_REQUEST_LIMIT: '100', AI_PUBLIC_ENABLED: 'true', OPENROUTER_MODEL: 'openai/gpt-5.6-luna' };
});
afterEach(() => db.close());

describe('admin service: listing', () => {
  it('lists users with month usage, tier limits, and a summary', async () => {
    addUser('admin-1', 'Admin', { role: 'admin', createdAt: 3000 }); addUser('user-1', 'Budi', { tier: 'pro', createdAt: 2000 }); addUser('user-2', 'Citra', { override: 7, createdAt: 1000 });
    addUsage('user-1', 'completed', [10, 5]); addUsage('user-1', 'failed', [0, 0], 6000); addUsage('user-2', 'completed', [7, 3]); addUsage('user-1', 'completed', [1, 1], 1, '2000-01');
    const page = await listUsers();
    expect(page.items.map((item) => item.id)).toEqual(['admin-1', 'user-1', 'user-2']);
    expect(page.items[0]).toMatchObject({ role: 'admin', unlimited: true, requestsThisMonth: 0, lastActiveAt: null });
    expect(page.items[1]).toMatchObject({ role: 'user', tier: 'pro', requestLimit: 2000, requestsThisMonth: 2, failedThisMonth: 1, tokensThisMonth: 15, lastActiveAt: new Date(6000).toISOString() });
    expect(page.items[2]).toMatchObject({ tier: 'free', aiLimitOverride: 7, requestLimit: 7 });
    expect(page.summary).toMatchObject({ period, users: 3, admins: 1, banned: 0, tiers: { free: 2, plus: 0, pro: 1, team: 0 }, requestsThisMonth: 3, failedThisMonth: 1, tokensThisMonth: 25, monthlyLimit: 100, tierLimits: { free: 100, plus: 500, pro: 2000, team: 3000 }, aiEnabled: true });
    expect(page.pageInfo).toEqual({ page: 1, pageSize: PAGE_LIMIT, total: 3, pages: 1 });
    expect((await listUsers({ sort: 'usage' })).items.map((item) => item.id)).toEqual(['user-1', 'user-2', 'admin-1']);
    expect((await listUsers({ sort: 'name' })).items.map((item) => item.name)).toEqual(['Admin', 'Budi', 'Citra']);
  });
  it('filters by search, role, tier, and status, and paginates by page number', async () => {
    for (let index = 0; index < PAGE_LIMIT + 2; index++) addUser(`u${String(index).padStart(3, '0')}`, `User ${index}`, { createdAt: 10_000 - index, tier: index % 2 ? 'plus' : 'free', role: index === 3 ? 'admin' : 'user', banned: index === 4 ? 1 : 0, banExpires: index === 4 ? Date.now() + 60_000 : null });
    addUser('expired', 'Expired ban', { banned: 1, banExpires: 1 });
    const first = await listUsers({}, 1); expect(first.items).toHaveLength(PAGE_LIMIT); expect(first.pageInfo).toMatchObject({ page: 1, total: PAGE_LIMIT + 3, pages: 2 });
    const second = await listUsers({}, 2); expect(second.items).toHaveLength(3); expect(second.pageInfo.page).toBe(2);
    expect((await listUsers({}, 99)).pageInfo.page).toBe(2);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(PAGE_LIMIT + 3);
    expect((await listUsers({ q: 'user 7' })).items.map((item) => item.name)).toEqual(['User 7']);
    expect((await listUsers({ q: 'u001@' })).items.map((item) => item.id)).toEqual(['u001']);
    expect((await listUsers({ role: 'admin' })).items.map((item) => item.id)).toEqual(['u003']);
    expect((await listUsers({ tier: 'plus' })).items.every((item) => item.tier === 'plus')).toBe(true);
    expect((await listUsers({ status: 'banned' })).items.map((item) => item.id)).toEqual(['u004']);
    expect((await listUsers({ status: 'active', q: 'expired' })).items.map((item) => item.id)).toEqual(['expired']);
    expect(first.summary.banned).toBe(1);
  });
});

describe('admin service: updates and guards', () => {
  it('updates tier, custom limit, note, name and verification', async () => {
    addUser('user-1', 'Budi');
    const updated = await updateUser('user-1', { tier: 'plus', aiLimitOverride: 42, adminNote: 'VIP', name: 'Budi S.', emailVerified: true });
    expect(updated).toMatchObject({ tier: 'plus', aiLimitOverride: 42, requestLimit: 42, adminNote: 'VIP', name: 'Budi S.', emailVerified: true });
    expect(await updateUser('user-1', { aiLimitOverride: null, adminNote: '' })).toMatchObject({ aiLimitOverride: null, requestLimit: 500, adminNote: null });
    await expect(updateUser('missing', { tier: 'pro' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getUser('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
  it('protects against self-demotion, self-ban, self-delete, deleting admins, and losing the last admin', async () => {
    addUser('admin-1', 'Admin', { role: 'admin' }); addUser('user-1', 'Budi');
    const admin = await getUser('admin-1'); const user = await getUser('user-1');
    await expect(assertRoleChange('admin-1', admin, 'user')).rejects.toMatchObject({ code: 'SELF_DEMOTION', status: 422 });
    await expect(assertRoleChange('user-1', admin, 'user')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(assertRoleChange('admin-1', user, 'admin')).resolves.toBeUndefined();
    await expect(assertBan('admin-1', admin)).rejects.toMatchObject({ code: 'SELF_BAN' });
    await expect(assertBan('user-1', admin)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(assertBan('admin-1', user)).resolves.toBeUndefined();
    expect(() => assertRemove('admin-1', admin)).toThrow(expect.objectContaining({ code: 'SELF_DELETE' }));
    expect(() => assertRemove('user-1', admin)).toThrow(expect.objectContaining({ code: 'ADMIN_DELETE' }));
    expect(() => assertRemove('admin-1', user)).not.toThrow();
    addUser('admin-2', 'Second admin', { role: 'admin' });
    await expect(assertRoleChange('admin-2', admin, 'user')).resolves.toBeUndefined();
  });
  it('records and lists audit entries globally and per user', async () => {
    addUser('admin-1', 'Admin', { role: 'admin' }); addUser('user-1', 'Budi');
    await audit('admin-1', 'user-1', 'user.role', { from: 'user', to: 'admin' });
    await new Promise((resolve) => setTimeout(resolve, 3)); // distinct created_at so the newest-first order is deterministic
    await audit('admin-1', null, 'user.create', { email: 'x@example.test' });
    const all = await listAudit(); expect(all.items.map((item) => item.action)).toEqual(['user.create', 'user.role']); expect(all.pageInfo).toMatchObject({ total: 2, pages: 1 });
    expect(all.items[1]).toMatchObject({ actorName: 'Admin', targetName: 'Budi', details: { from: 'user', to: 'admin' } });
    expect((await listAudit({ targetUserId: 'user-1' })).items).toHaveLength(1);
    expect((await listAudit({ action: 'user.create' })).items).toHaveLength(1);
    expect((await listAudit({ q: 'budi' })).items.map((item) => item.action)).toEqual(['user.role']);
  });
  it('lists a user AI log newest first with pagination', async () => {
    addUser('user-1', 'Budi');
    for (let index = 0; index < 55; index++) addUsage('user-1', index % 9 === 0 ? 'failed' : 'completed', [2, 1], 100 + index);
    const first = await listUserUsage('user-1', null); expect(first.items).toHaveLength(50); expect(first.items[0]).toMatchObject({ createdAt: new Date(154).toISOString(), promptId: 'P01_STANDARD_REWRITE', latencyMs: 120 });
    const rest = await listUserUsage('user-1', first.nextCursor); expect(rest.items).toHaveLength(5); expect(rest.nextCursor).toBeNull();
    expect(rest.items.at(-1)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });
});

describe('AI metrics', () => {
  it('aggregates a date range by day, prompt, error, and user', async () => {
    addUser('user-1', 'Budi', { tier: 'pro' }); addUser('user-2', 'Citra');
    const day = Date.parse('2026-09-10T12:00:00Z');
    addUsage('user-1', 'completed', [10, 5], day); addUsage('user-1', 'failed', [0, 0], day + 3600_000); addUsage('user-2', 'completed', [7, 3], day + 86_400_000);
    addUsage('user-2', 'completed', [1, 1], Date.parse('2026-08-01T00:00:00Z'));
    const metrics = await aiMetrics('2026-09-10', '2026-09-11');
    expect(metrics.totals).toMatchObject({ requests: 3, completed: 2, failed: 1, users: 2, inputTokens: 17, outputTokens: 8, avgLatencyMs: 120, failRate: 33.3 });
    expect(metrics.byDay.map((row) => [row.day, row.requests, row.failed])).toEqual([['2026-09-11', 1, 0], ['2026-09-10', 2, 1]]);
    expect(metrics.byPrompt[0]).toMatchObject({ promptId: 'P01_STANDARD_REWRITE', requests: 3, failed: 1, tokens: 25 });
    expect(metrics.byError).toEqual([{ errorCode: 'timeout', count: 1 }]);
    expect(metrics.topUsers.map((row) => [row.id, row.requests])).toEqual([['user-1', 2], ['user-2', 1]]);
    expect(parseRange(null, '2026-09-30')).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(() => parseRange('2026-09-30', '2026-09-01')).toThrow(expect.objectContaining({ code: 'INVALID_RANGE' }));
    expect(() => parseRange('2020-01-01', '2026-09-01')).toThrow(expect.objectContaining({ code: 'INVALID_RANGE' }));
  });
});

describe('quota entitlements', () => {
  it('derives the effective limit from role, tier, and override', async () => {
    addUser('free', 'Free'); addUser('pro', 'Pro', { tier: 'pro' }); addUser('custom', 'Custom', { tier: 'plus', override: 12 }); addUser('admin', 'Admin', { role: 'admin', tier: 'free' });
    expect(await entitlement('free')).toMatchObject({ tier: 'free', requestLimit: 100, unlimited: false, override: null });
    expect(await entitlement('pro')).toMatchObject({ tier: 'pro', requestLimit: 2000 });
    expect(await entitlement('custom')).toMatchObject({ tier: 'plus', requestLimit: 12, override: 12 });
    expect(await entitlement('admin')).toMatchObject({ role: 'admin', unlimited: true });
    expect(await entitlement('ghost')).toMatchObject({ tier: 'free', requestLimit: 100, unlimited: false });
    addUsage('pro', 'completed', [1, 1]);
    expect(await usageSummary('pro')).toMatchObject({ tier: 'pro', requestsUsed: 1, requestLimit: 2000, requestsRemaining: 1999, unlimited: false });
  });
  it('maps ForbiddenError to its code with a 403', async () => {
    const response = handleRouteError(new ForbiddenError('ACCOUNT_DISABLED', 'disabled'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
  });
});
