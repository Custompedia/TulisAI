import { z } from 'zod';
import { RequestError } from '../http';
import { runtime } from '../runtime';
import { isAdminRole } from '../auth/auth';
import { asTier, monthlyLimit, periodKey, tierLimit, TIERS, type Tier } from '../usage/quota';

export const RoleSchema = z.enum(['user', 'admin']);
export const TierSchema = z.enum(TIERS);
export const UserPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  emailVerified: z.boolean().optional(),
  tier: TierSchema.optional(),
  aiLimitOverride: z.number().int().min(1).max(1_000_000).nullable().optional(),
  adminNote: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });
export const CreateUserSchema = z.object({
  name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(200), username: z.string().trim().min(3).max(30).regex(/^[a-z0-9._]+$/),
  password: z.string().min(10).max(128), role: RoleSchema.default('user'), tier: TierSchema.default('free'), emailVerified: z.boolean().default(true),
});
export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set-role'), role: RoleSchema }),
  z.object({ action: z.literal('ban'), reason: z.string().trim().min(1).max(300), expiresInDays: z.number().int().min(1).max(3650).nullable().default(null) }),
  z.object({ action: z.literal('unban') }),
  z.object({ action: z.literal('set-password'), newPassword: z.string().min(10).max(128) }),
  z.object({ action: z.literal('revoke-sessions'), sessionToken: z.string().min(1).optional() }),
]);
export type Role = z.infer<typeof RoleSchema>;
export type UserPatch = z.infer<typeof UserPatchSchema>;

export type AdminUser = {
  id: string; name: string; email: string; username: string | null; image: string | null; role: Role; tier: Tier; emailVerified: boolean; createdAt: string; updatedAt: string;
  banned: boolean; banReason: string | null; banExpires: string | null; aiLimitOverride: number | null; adminNote: string | null; requestLimit: number; unlimited: boolean;
  requestsThisMonth: number; failedThisMonth: number; tokensThisMonth: number; lastActiveAt: string | null; documents: number;
};
export type AdminSummary = { period: string; users: number; admins: number; banned: number; tiers: Record<Tier, number>; requestsThisMonth: number; failedThisMonth: number; tokensThisMonth: number; monthlyLimit: number; tierLimits: Record<Tier, number>; aiEnabled: boolean; model: string };
export type AuditEntry = { id: string; actorId: string; actorName: string | null; targetUserId: string | null; targetName: string | null; action: string; details: Record<string, unknown>; createdAt: string };
export type UsageEntry = { id: string; operation: string; promptId: string | null; status: string; sourceCharacters: number | null; inputTokens: number | null; outputTokens: number | null; latencyMs: number | null; errorCode: string | null; createdAt: string; completedAt: string | null };
export type UserSort = 'newest' | 'oldest' | 'name' | 'usage' | 'active';
export type UserFilter = { q?: string; role?: 'user' | 'admin'; tier?: Tier; status?: 'active' | 'banned'; sort?: UserSort };
export const USER_SORTS: UserSort[] = ['newest', 'oldest', 'name', 'usage', 'active'];
export type PageInfo = { page: number; pageSize: number; total: number; pages: number };

type Row = { id: string; name: string; email: string; username: string | null; image: string | null; role: string | null; tier: string | null; email_verified: number; created_at: number; updated_at: number; banned: number; ban_reason: string | null; ban_expires: number | null; ai_limit_override: number | null; admin_note: string | null; requests: number | null; failed: number | null; tokens: number | null; last_active: number | null; documents: number | null };

const iso = (value: number | null | undefined) => (value === null || value === undefined ? null : new Date(value).toISOString());
const activeBan = (row: { banned: number; ban_expires: number | null }) => row.banned === 1 && (row.ban_expires === null || row.ban_expires > Date.now());
function toUser(row: Row): AdminUser {
  const role: Role = isAdminRole(row.role) ? 'admin' : 'user'; const tier = asTier(row.tier);
  const override = typeof row.ai_limit_override === 'number' && row.ai_limit_override > 0 ? row.ai_limit_override : null;
  return {
    id: row.id, name: row.name, email: row.email, username: row.username, image: row.image, role, tier, emailVerified: row.email_verified === 1, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    banned: activeBan(row), banReason: row.ban_reason, banExpires: iso(row.ban_expires), aiLimitOverride: override, adminNote: row.admin_note, requestLimit: override ?? tierLimit(tier), unlimited: role === 'admin',
    requestsThisMonth: row.requests ?? 0, failedThisMonth: row.failed ?? 0, tokensThisMonth: row.tokens ?? 0, lastActiveAt: iso(row.last_active), documents: row.documents ?? 0,
  };
}

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.username, u.image, u.role, u.tier, u.email_verified, u.created_at, u.updated_at, u.banned, u.ban_reason, u.ban_expires, u.ai_limit_override, u.admin_note,
    l.requests, l.failed, l.tokens, l.last_active, d.documents
  FROM user u
  LEFT JOIN (
    SELECT owner_id, COUNT(1) AS requests, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)) AS tokens, MAX(created_at) AS last_active
    FROM usage_ledger WHERE period_key=? GROUP BY owner_id
  ) l ON l.owner_id=u.id
  LEFT JOIN (SELECT owner_id, COUNT(1) AS documents FROM documents GROUP BY owner_id) d ON d.owner_id=u.id`;

export const PAGE_LIMIT = 50;
const parseCursor = (cursor: string | null): [number | null, string | null] => {
  if (!cursor) return [null, null];
  const [at, id] = cursor.split(':'); const time = Number(at);
  if (!id || !Number.isSafeInteger(time)) throw new RequestError('INVALID_CURSOR', 'The page cursor is invalid.');
  return [time, id];
};
export const pageOf = (value: string | null | undefined): number => { const page = Number(value ?? '1'); return Number.isSafeInteger(page) && page >= 1 ? page : 1; };
const pageInfo = (page: number, total: number, pageSize = PAGE_LIMIT): PageInfo => ({ page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) });
const ORDER: Record<UserSort, string> = { newest: 'u.created_at DESC, u.id DESC', oldest: 'u.created_at ASC, u.id ASC', name: 'lower(u.name) ASC, u.id ASC', usage: 'COALESCE(l.requests,0) DESC, u.created_at DESC, u.id DESC', active: 'COALESCE(l.last_active,0) DESC, u.created_at DESC, u.id DESC' };
const USER_WHERE = `
    WHERE (? IS NULL OR lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(u.username,'')) LIKE ?)
      AND (? IS NULL OR (CASE WHEN ? = 'admin' THEN (','||COALESCE(u.role,'')||',') LIKE '%,admin,%' ELSE (','||COALESCE(u.role,'')||',') NOT LIKE '%,admin,%' END))
      AND (? IS NULL OR u.tier = ?)
      AND (? IS NULL OR (CASE WHEN ? = 'banned' THEN (u.banned = 1 AND (u.ban_expires IS NULL OR u.ban_expires > ?)) ELSE NOT (u.banned = 1 AND (u.ban_expires IS NULL OR u.ban_expires > ?)) END))`;

// Page-number pagination (the user table is small and the admin wants numbered pages); search plus role/tier/status filters and a sort.
export async function listUsers(filter: UserFilter = {}, page = 1): Promise<{ summary: AdminSummary; items: AdminUser[]; pageInfo: PageInfo }> {
  const period = periodKey();
  const term = (filter.q ?? '').trim().toLowerCase().slice(0, 100); const like = term ? `%${term}%` : null;
  const roleFilter = filter.role ?? null; const tierFilter = filter.tier ?? null; const statusFilter = filter.status ?? null; const now = Date.now();
  const where = [like, like, like, like, roleFilter, roleFilter, tierFilter, tierFilter, statusFilter, statusFilter, now, now];
  const count = await runtime().DB.prepare(`SELECT COUNT(1) AS n FROM user u ${USER_WHERE}`).bind(...where).first<{ n: number }>();
  const total = count?.n ?? 0; const info = pageInfo(Math.min(page, Math.max(1, Math.ceil(total / PAGE_LIMIT))), total);
  const rows = await runtime().DB.prepare(`${USER_SELECT} ${USER_WHERE} ORDER BY ${ORDER[filter.sort ?? 'newest']} LIMIT ? OFFSET ?`)
    .bind(period, ...where, PAGE_LIMIT, (info.page - 1) * PAGE_LIMIT).all<Row>();
  return { summary: await summary(period), items: rows.results.map(toUser), pageInfo: info };
}

async function summary(period: string): Promise<AdminSummary> {
  const now = Date.now();
  const [users, usage] = await Promise.all([
    runtime().DB.prepare(`SELECT COUNT(1) AS users, SUM(CASE WHEN (','||COALESCE(role,'')||',') LIKE '%,admin,%' THEN 1 ELSE 0 END) AS admins,
      SUM(CASE WHEN banned = 1 AND (ban_expires IS NULL OR ban_expires > ?) THEN 1 ELSE 0 END) AS banned,
      SUM(CASE WHEN tier='plus' THEN 1 ELSE 0 END) AS plus, SUM(CASE WHEN tier='pro' THEN 1 ELSE 0 END) AS pro, SUM(CASE WHEN tier='team' THEN 1 ELSE 0 END) AS team FROM user`).bind(now)
      .first<{ users: number; admins: number | null; banned: number | null; plus: number | null; pro: number | null; team: number | null }>(),
    runtime().DB.prepare(`SELECT COUNT(1) AS requests, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)) AS tokens FROM usage_ledger WHERE period_key=?`).bind(period)
      .first<{ requests: number; failed: number | null; tokens: number | null }>(),
  ]);
  const env = runtime(); const total = users?.users ?? 0; const plus = users?.plus ?? 0; const pro = users?.pro ?? 0; const team = users?.team ?? 0;
  return {
    period, users: total, admins: users?.admins ?? 0, banned: users?.banned ?? 0, tiers: { free: Math.max(0, total - plus - pro - team), plus, pro, team },
    requestsThisMonth: usage?.requests ?? 0, failedThisMonth: usage?.failed ?? 0, tokensThisMonth: usage?.tokens ?? 0,
    monthlyLimit: monthlyLimit(), tierLimits: { free: tierLimit('free'), plus: tierLimit('plus'), pro: tierLimit('pro'), team: tierLimit('team') },
    aiEnabled: env.AI_PUBLIC_ENABLED === 'true', model: env.OPENROUTER_MODEL?.trim() || 'openai/gpt-5.6-luna',
  };
}

export async function getUser(userId: string): Promise<AdminUser> {
  const row = await runtime().DB.prepare(`${USER_SELECT} WHERE u.id=?`).bind(periodKey(), userId).first<Row>();
  if (!row) throw new RequestError('NOT_FOUND', 'User not found.', 404);
  return toUser(row);
}

export async function countAdmins(): Promise<number> {
  const row = await runtime().DB.prepare(`SELECT COUNT(1) AS n FROM user WHERE (','||COALESCE(role,'')||',') LIKE '%,admin,%' AND NOT (banned = 1 AND (ban_expires IS NULL OR ban_expires > ?))`).bind(Date.now()).first<{ n: number }>();
  return row?.n ?? 0;
}

// Guards that the auth plugin does not provide: no self-demotion, and never leave the workspace without an active admin.
export async function assertRoleChange(actorId: string, target: AdminUser, role: Role): Promise<void> {
  if (actorId === target.id && role !== 'admin') throw new RequestError('SELF_DEMOTION', 'You cannot remove your own admin role.', 422);
  if (target.role === 'admin' && role !== 'admin' && !target.banned && (await countAdmins()) <= 1) throw new RequestError('LAST_ADMIN', 'At least one active admin must remain.', 422);
}
export async function assertBan(actorId: string, target: AdminUser): Promise<void> {
  if (actorId === target.id) throw new RequestError('SELF_BAN', 'You cannot disable your own account.', 422);
  if (target.role === 'admin' && !target.banned && (await countAdmins()) <= 1) throw new RequestError('LAST_ADMIN', 'At least one active admin must remain.', 422);
}
export function assertRemove(actorId: string, target: AdminUser): void {
  if (actorId === target.id) throw new RequestError('SELF_DELETE', 'You cannot delete your own account from the admin panel.', 422);
  if (target.role === 'admin') throw new RequestError('ADMIN_DELETE', 'Remove the admin role before deleting this account.', 422);
}

export async function updateUser(userId: string, patch: UserPatch): Promise<AdminUser> {
  const sets: string[] = []; const values: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name=?'); values.push(patch.name); }
  if (patch.emailVerified !== undefined) { sets.push('email_verified=?'); values.push(patch.emailVerified ? 1 : 0); }
  if (patch.tier !== undefined) { sets.push('tier=?'); values.push(patch.tier); }
  if (patch.aiLimitOverride !== undefined) { sets.push('ai_limit_override=?'); values.push(patch.aiLimitOverride); }
  if (patch.adminNote !== undefined) { sets.push('admin_note=?'); values.push(patch.adminNote || null); }
  sets.push('updated_at=?'); values.push(Date.now(), userId);
  const result = await runtime().DB.prepare(`UPDATE user SET ${sets.join(', ')} WHERE id=?`).bind(...values).run();
  if (result.meta.changes !== 1) throw new RequestError('NOT_FOUND', 'User not found.', 404);
  return getUser(userId);
}

export async function setTier(userId: string, tier: Tier): Promise<void> {
  await runtime().DB.prepare('UPDATE user SET tier=?, updated_at=? WHERE id=?').bind(tier, Date.now(), userId).run();
}

export async function audit(actorId: string, targetUserId: string | null, action: string, details: Record<string, unknown> = {}): Promise<void> {
  await runtime().DB.prepare('INSERT INTO admin_audit_log (id,actor_id,target_user_id,action,details_json,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), actorId, targetUserId, action, JSON.stringify(details), Date.now()).run();
}

const AUDIT_LIMIT = 50;
export type AuditFilter = { targetUserId?: string | null; action?: string | null; q?: string };
export async function listAudit(filter: AuditFilter = {}, page = 1): Promise<{ items: AuditEntry[]; pageInfo: PageInfo }> {
  const target = filter.targetUserId ?? null; const action = filter.action?.trim() || null; const term = (filter.q ?? '').trim().toLowerCase().slice(0, 100); const like = term ? `%${term}%` : null;
  const where = `FROM admin_audit_log a LEFT JOIN user actor ON actor.id=a.actor_id LEFT JOIN user target ON target.id=a.target_user_id
    WHERE (? IS NULL OR a.target_user_id = ?) AND (? IS NULL OR a.action = ?) AND (? IS NULL OR lower(COALESCE(actor.name,'')) LIKE ? OR lower(COALESCE(target.name,'')) LIKE ? OR lower(a.details_json) LIKE ?)`;
  const values = [target, target, action, action, like, like, like, like];
  const count = await runtime().DB.prepare(`SELECT COUNT(1) AS n ${where}`).bind(...values).first<{ n: number }>();
  const total = count?.n ?? 0; const info = pageInfo(Math.min(page, Math.max(1, Math.ceil(total / AUDIT_LIMIT))), total, AUDIT_LIMIT);
  const rows = await runtime().DB.prepare(`SELECT a.id, a.actor_id, a.target_user_id, a.action, a.details_json, a.created_at, actor.name AS actor_name, target.name AS target_name ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`)
    .bind(...values, AUDIT_LIMIT, (info.page - 1) * AUDIT_LIMIT)
    .all<{ id: string; actor_id: string; target_user_id: string | null; action: string; details_json: string; created_at: number; actor_name: string | null; target_name: string | null }>();
  const items = rows.results.map((row) => { let details: Record<string, unknown> = {}; try { details = JSON.parse(row.details_json) as Record<string, unknown>; } catch { /* keep empty */ } return { id: row.id, actorId: row.actor_id, actorName: row.actor_name, targetUserId: row.target_user_id, targetName: row.target_name, action: row.action, details, createdAt: new Date(row.created_at).toISOString() }; });
  return { items, pageInfo: info };
}

// --- AI monitoring over an inclusive [from, to] date range in UTC.
export type AiMetrics = {
  from: string; to: string; totals: { requests: number; completed: number; failed: number; running: number; users: number; inputTokens: number; outputTokens: number; characters: number; avgLatencyMs: number | null; failRate: number };
  byDay: Array<{ day: string; requests: number; failed: number; tokens: number; users: number }>;
  byPrompt: Array<{ promptId: string; requests: number; failed: number; tokens: number; avgLatencyMs: number | null }>;
  byError: Array<{ errorCode: string; count: number }>;
  topUsers: Array<{ id: string; name: string; email: string; role: Role; tier: Tier; requests: number; failed: number; tokens: number }>;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseRange(from: string | null, to: string | null): { from: string; to: string; start: number; end: number } {
  const today = new Date().toISOString().slice(0, 10);
  const toDay = to && DAY_RE.test(to) ? to : today;
  const fromDay = from && DAY_RE.test(from) ? from : new Date(Date.parse(`${toDay}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const start = Date.parse(`${fromDay}T00:00:00Z`); const end = Date.parse(`${toDay}T00:00:00Z`) + 86_400_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new RequestError('INVALID_RANGE', 'The date range is invalid.');
  if (end - start > 366 * 86_400_000) throw new RequestError('INVALID_RANGE', 'The date range may span at most one year.');
  return { from: fromDay, to: toDay, start, end };
}
export async function aiMetrics(from: string | null, to: string | null): Promise<AiMetrics> {
  const range = parseRange(from, to); const db = runtime().DB;
  const tokens = "SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0))";
  const [totals, byDay, byPrompt, byError, topUsers] = await Promise.all([
    db.prepare(`SELECT COUNT(1) AS requests, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN status='reserved' THEN 1 ELSE 0 END) AS running,
      COUNT(DISTINCT owner_id) AS users, SUM(COALESCE(input_tokens,0)) AS input_tokens, SUM(COALESCE(output_tokens,0)) AS output_tokens, SUM(COALESCE(source_characters,0)) AS characters, AVG(latency_ms) AS avg_latency
      FROM usage_ledger WHERE created_at >= ? AND created_at < ?`).bind(range.start, range.end).first<{ requests: number; completed: number | null; failed: number | null; running: number | null; users: number; input_tokens: number | null; output_tokens: number | null; characters: number | null; avg_latency: number | null }>(),
    db.prepare(`SELECT date(created_at/1000,'unixepoch') AS day, COUNT(1) AS requests, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, ${tokens} AS tokens, COUNT(DISTINCT owner_id) AS users
      FROM usage_ledger WHERE created_at >= ? AND created_at < ? GROUP BY day ORDER BY day DESC`).bind(range.start, range.end).all<{ day: string; requests: number; failed: number | null; tokens: number | null; users: number }>(),
    db.prepare(`SELECT COALESCE(prompt_id, operation) AS prompt_id, COUNT(1) AS requests, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, ${tokens} AS tokens, AVG(latency_ms) AS avg_latency
      FROM usage_ledger WHERE created_at >= ? AND created_at < ? GROUP BY COALESCE(prompt_id, operation) ORDER BY requests DESC`).bind(range.start, range.end).all<{ prompt_id: string; requests: number; failed: number | null; tokens: number | null; avg_latency: number | null }>(),
    db.prepare(`SELECT error_code, COUNT(1) AS count FROM usage_ledger WHERE created_at >= ? AND created_at < ? AND status='failed' GROUP BY error_code ORDER BY count DESC LIMIT 20`).bind(range.start, range.end).all<{ error_code: string | null; count: number }>(),
    db.prepare(`SELECT u.id, u.name, u.email, u.role, u.tier, l.requests, l.failed, l.tokens FROM (
        SELECT owner_id, COUNT(1) AS requests, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, ${tokens} AS tokens FROM usage_ledger WHERE created_at >= ? AND created_at < ? GROUP BY owner_id ORDER BY requests DESC LIMIT 20
      ) l JOIN user u ON u.id=l.owner_id ORDER BY l.requests DESC`).bind(range.start, range.end).all<{ id: string; name: string; email: string; role: string | null; tier: string | null; requests: number; failed: number | null; tokens: number | null }>(),
  ]);
  const requests = totals?.requests ?? 0; const failed = totals?.failed ?? 0;
  return {
    from: range.from, to: range.to,
    totals: { requests, completed: totals?.completed ?? 0, failed, running: totals?.running ?? 0, users: totals?.users ?? 0, inputTokens: totals?.input_tokens ?? 0, outputTokens: totals?.output_tokens ?? 0, characters: totals?.characters ?? 0, avgLatencyMs: totals?.avg_latency === null || totals?.avg_latency === undefined ? null : Math.round(totals.avg_latency), failRate: requests ? Math.round((failed / requests) * 1000) / 10 : 0 },
    byDay: byDay.results.map((row) => ({ day: row.day, requests: row.requests, failed: row.failed ?? 0, tokens: row.tokens ?? 0, users: row.users })),
    byPrompt: byPrompt.results.map((row) => ({ promptId: row.prompt_id, requests: row.requests, failed: row.failed ?? 0, tokens: row.tokens ?? 0, avgLatencyMs: row.avg_latency === null ? null : Math.round(row.avg_latency) })),
    byError: byError.results.map((row) => ({ errorCode: row.error_code ?? 'unknown', count: row.count })),
    topUsers: topUsers.results.map((row) => ({ id: row.id, name: row.name, email: row.email, role: isAdminRole(row.role) ? 'admin' : 'user', tier: asTier(row.tier), requests: row.requests, failed: row.failed ?? 0, tokens: row.tokens ?? 0 })),
  };
}

export async function listUserUsage(userId: string, cursor: string | null): Promise<{ items: UsageEntry[]; nextCursor: string | null }> {
  const [after, afterId] = parseCursor(cursor);
  const rows = await runtime().DB.prepare(`
    SELECT id, operation, prompt_id, status, source_characters, input_tokens, output_tokens, latency_ms, error_code, created_at, completed_at
    FROM usage_ledger WHERE owner_id=? AND (? IS NULL OR (created_at < ? OR (created_at = ? AND id < ?)))
    ORDER BY created_at DESC, id DESC LIMIT ?`).bind(userId, after, after, after, afterId, AUDIT_LIMIT + 1)
    .all<{ id: string; operation: string; prompt_id: string | null; status: string; source_characters: number | null; input_tokens: number | null; output_tokens: number | null; latency_ms: number | null; error_code: string | null; created_at: number; completed_at: number | null }>();
  const items = rows.results.slice(0, AUDIT_LIMIT).map((row) => ({ id: row.id, operation: row.operation, promptId: row.prompt_id, status: row.status, sourceCharacters: row.source_characters, inputTokens: row.input_tokens, outputTokens: row.output_tokens, latencyMs: row.latency_ms, errorCode: row.error_code, createdAt: new Date(row.created_at).toISOString(), completedAt: iso(row.completed_at) }));
  const last = items[AUDIT_LIMIT - 1];
  return { items, nextCursor: rows.results.length > AUDIT_LIMIT && last ? `${new Date(last.createdAt).getTime()}:${last.id}` : null };
}
