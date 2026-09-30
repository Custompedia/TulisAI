import { runtime } from "../runtime";
import { writeAudit } from "../audit";
import { RequestError } from "../http";

// Local paid-access authority (migration 0014). MKL retired its services on
// 2026-09-28, so TulisAI itself records who has Plus/Pro/Max and until when.
export const LOCAL_APP_KEY = "tulisai";
export const LOCAL_PLAN_VERSION = "pricing-v1";
export const PAID_PLANS = ["plus", "pro", "max"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type AccessSource = "admin" | "payment";

export type AccessPeriod = {
  id: string; owner_id: string; plan_code: PaidPlan; source: AccessSource; payment_order_id: string | null;
  granted_by: string | null; note: string | null; period_start: string; period_end: string;
  period_start_ms: number; period_end_ms: number; status: "active" | "ended";
  ended_at: number | null; ended_by: string | null; end_reason: string | null; created_at: number; updated_at: number;
};

export type PlanState = {
  current: AccessPeriod | null;
  // Renewals already granted, starting where the previous period ends.
  queued: AccessPeriod[];
  // Last instant covered by the current period plus every queued renewal.
  paidThrough: string | null;
};

/**
 * Add calendar months in UTC, anchored to the start day: Jan 31 + 1 month is
 * Feb 28/29, and the next month is Mar 31 again, not Mar 28.
 */
export function addCalendarMonths(fromMs: number, months: number, anchorDay?: number): number {
  const from = new Date(fromMs); const day = anchorDay ?? from.getUTCDate();
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Active, not yet finished periods of an owner, oldest first. */
async function livePeriods(ownerId: string, now: number): Promise<AccessPeriod[]> {
  const result = await runtime().DB.prepare(`SELECT * FROM access_periods WHERE owner_id=? AND status='active' AND period_end_ms>?
    ORDER BY period_start_ms,id`).bind(ownerId, now).all<AccessPeriod>();
  return result.results ?? [];
}

export async function activeAccessPeriod(ownerId: string, now = Date.now()): Promise<AccessPeriod | null> {
  return await runtime().DB.prepare(`SELECT * FROM access_periods WHERE owner_id=? AND status='active'
    AND period_start_ms<=? AND period_end_ms>? ORDER BY period_start_ms DESC,id LIMIT 1`).bind(ownerId, now, now).first<AccessPeriod>() ?? null;
}

export async function planState(ownerId: string, now = Date.now()): Promise<PlanState> {
  const live = await livePeriods(ownerId, now);
  const current = live.find((period) => period.period_start_ms <= now) ?? null;
  const queued = live.filter((period) => period.period_start_ms > now);
  const last = live.at(-1);
  return { current, queued, paidThrough: last ? last.period_end : null };
}

/**
 * Insert one period only if it overlaps no other active period of the owner.
 * The guard runs inside the same batch as any preceding end statements.
 */
export function periodInsertStatement(input: {
  id: string; ownerId: string; plan: PaidPlan; source: AccessSource; paymentOrderId?: string | null;
  grantedBy?: string | null; note?: string | null; startMs: number; endMs: number; now: number; extraGuard?: { sql: string; values: unknown[] };
}): D1PreparedStatement {
  return runtime().DB.prepare(`INSERT INTO access_periods (id,owner_id,plan_code,source,payment_order_id,granted_by,note,period_start,period_end,
      period_start_ms,period_end_ms,status,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,'active',?,? WHERE NOT EXISTS (SELECT 1 FROM access_periods WHERE owner_id=? AND status='active'
      AND period_start_ms<? AND period_end_ms>?)${input.extraGuard ? ` AND ${input.extraGuard.sql}` : ""}`)
    .bind(input.id, input.ownerId, input.plan, input.source, input.paymentOrderId ?? null, input.grantedBy ?? null, input.note ?? null,
      iso(input.startMs), iso(input.endMs), input.startMs, input.endMs, input.now, input.now, input.ownerId, input.endMs, input.startMs,
      ...(input.extraGuard?.values ?? []));
}

function endStatement(period: AccessPeriod, actorId: string | null, reason: string, now: number): D1PreparedStatement {
  return runtime().DB.prepare(`UPDATE access_periods SET status='ended',ended_at=?,ended_by=?,end_reason=?,updated_at=?
    WHERE id=? AND status='active'`).bind(now, actorId, reason.slice(0, 200), now, period.id);
}

async function runBatch(statements: D1PreparedStatement[]) {
  const db = runtime().DB;
  if (typeof db.batch === "function") return db.batch(statements);
  const results = [];
  for (const statement of statements) results.push(await statement.run());
  return results;
}

export type AdminPlanResult = { action: "activated" | "extended" | "replaced"; period: AccessPeriod; state: PlanState };

/**
 * Admin grant, following Mari Rekap's "Atur paket":
 * - no running plan: one month starting now;
 * - same plan running: one more month queued after the last covered instant;
 * - different plan running: the running and queued periods end now and the
 *   new plan runs one month from now.
 * Admins may receive plans too; every change is audited.
 */
export async function adminActivatePlan(input: { actorId: string; ownerId: string; plan: PaidPlan; note?: string | null; now?: number }): Promise<AdminPlanResult> {
  const now = input.now ?? Date.now(); const before = await planState(input.ownerId, now);
  const live = [...(before.current ? [before.current] : []), ...before.queued];
  const id = crypto.randomUUID(); const statements: D1PreparedStatement[] = [];
  let action: AdminPlanResult["action"]; let startMs: number;
  if (before.current && before.current.plan_code === input.plan) {
    action = "extended"; startMs = live.at(-1)!.period_end_ms;
  } else if (live.length > 0) {
    action = "replaced"; startMs = now;
    for (const period of live) statements.push(endStatement(period, input.actorId, `replaced_by_admin:${input.plan}`, now));
  } else {
    action = "activated"; startMs = now;
  }
  const endMs = addCalendarMonths(startMs, 1);
  statements.push(periodInsertStatement({ id, ownerId: input.ownerId, plan: input.plan, source: "admin", grantedBy: input.actorId, note: input.note ?? null, startMs, endMs, now }));
  const results = await runBatch(statements);
  if ((results.at(-1)?.meta.changes ?? 0) !== 1) throw new RequestError("PLAN_CHANGED_CONCURRENTLY", "The plan changed while this was being saved. Reload and try again.", 409);
  const period = (await runtime().DB.prepare("SELECT * FROM access_periods WHERE id=?").bind(id).first<AccessPeriod>())!;
  await writeAudit(input.actorId, input.ownerId, `plan.admin.${action}`, {
    plan: input.plan, periodId: id, periodStart: period.period_start, periodEnd: period.period_end, note: input.note ?? null,
    replaced: action === "replaced" ? live.map((item) => ({ id: item.id, plan: item.plan_code, source: item.source, periodEnd: item.period_end })) : undefined,
  });
  return { action, period, state: await planState(input.ownerId, now) };
}

/** End the running plan and every queued renewal now. Purchased characters are untouched. */
export async function adminEndPlan(input: { actorId: string; ownerId: string; reason: string; now?: number }): Promise<PlanState> {
  const now = input.now ?? Date.now(); const before = await planState(input.ownerId, now);
  const live = [...(before.current ? [before.current] : []), ...before.queued];
  if (live.length === 0) throw new RequestError("NO_ACTIVE_PLAN", "This account has no running or queued plan.", 409);
  await runBatch(live.map((period) => endStatement(period, input.actorId, `admin:${input.reason}`, now)));
  await writeAudit(input.actorId, input.ownerId, "plan.admin.ended", {
    reason: input.reason, ended: live.map((item) => ({ id: item.id, plan: item.plan_code, source: item.source, periodEnd: item.period_end })),
  });
  return planState(input.ownerId, now);
}
