import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, migrationFiles } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { addCalendarMonths, adminActivatePlan, adminEndPlan, planState } from "@/server/access/periods";
import { getUser, listUsers } from "@/server/admin/service";
import { entitlement } from "@/server/usage/quota";
import { reserveCharacters, settleReservation, walletSummary } from "@/server/usage/wallet";

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(value.changes) } }; }
  async run() { return this.execute(); }
}
const d1 = () => ({
  prepare: (sql: string) => new Statement(sql),
  batch: async (statements: Statement[]) => {
    db.exec("BEGIN IMMEDIATE");
    try { const values = statements.map((statement) => statement.execute()); db.exec("COMMIT"); return values; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  },
});

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-31T09:00:00.000Z");
const addUser = (id: string, role = "user") => db.prepare("INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
  .run(id, id, `${id}@example.test`, id, role, "free", 1, 1);
const periods = (owner: string) => db.prepare("SELECT plan_code,source,status,period_start,period_end,end_reason,granted_by FROM access_periods WHERE owner_id=? ORDER BY period_start_ms,id").all(owner);
const audits = (target: string) => db.prepare("SELECT action,actor_id FROM admin_audit_log WHERE target_user_id=? ORDER BY created_at,rowid").all(target);

beforeEach(() => {
  db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db);
  state.env = { DB: d1(), AI_MONTHLY_REQUEST_LIMIT: "100", AI_PUBLIC_ENABLED: "true", OPENROUTER_MODEL: "test" };
  addUser("admin-1", "admin"); addUser("user-1");
});
afterEach(() => db.close());

describe("calendar months", () => {
  it("anchors to the start day and clamps short months", () => {
    const jan31 = Date.parse("2028-01-31T10:00:00.000Z");
    expect(new Date(addCalendarMonths(jan31, 1)).toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(new Date(addCalendarMonths(jan31, 2)).toISOString()).toBe("2028-03-31T10:00:00.000Z");
    expect(new Date(addCalendarMonths(Date.parse("2026-12-15T00:00:00.000Z"), 1)).toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
});

describe("admin plan grants", () => {
  it("activates, extends after the last covered day, replaces, and ends — each audited", async () => {
    const first = await adminActivatePlan({ actorId: "admin-1", ownerId: "user-1", plan: "plus", note: "trial", now: NOW });
    expect(first).toMatchObject({ action: "activated", period: { plan_code: "plus", source: "admin", period_start: "2026-10-31T09:00:00.000Z", period_end: "2026-11-30T09:00:00.000Z", granted_by: "admin-1" } });

    const extended = await adminActivatePlan({ actorId: "admin-1", ownerId: "user-1", plan: "plus", now: NOW + DAY });
    expect(extended.action).toBe("extended");
    expect(extended.period).toMatchObject({ period_start: "2026-11-30T09:00:00.000Z", period_end: "2026-12-30T09:00:00.000Z" });
    expect(extended.state).toMatchObject({ current: { plan_code: "plus" }, queued: [{ plan_code: "plus" }], paidThrough: "2026-12-30T09:00:00.000Z" });

    const replaced = await adminActivatePlan({ actorId: "admin-1", ownerId: "user-1", plan: "pro", now: NOW + 2 * DAY });
    expect(replaced.action).toBe("replaced");
    expect(periods("user-1")).toEqual([
      expect.objectContaining({ plan_code: "plus", status: "ended", end_reason: "replaced_by_admin:pro" }),
      expect.objectContaining({ plan_code: "pro", status: "active", period_start: new Date(NOW + 2 * DAY).toISOString() }),
      expect.objectContaining({ plan_code: "plus", status: "ended", end_reason: "replaced_by_admin:pro" }),
    ]);

    const ended = await adminEndPlan({ actorId: "admin-1", ownerId: "user-1", reason: "test finished", now: NOW + 3 * DAY });
    expect(ended).toEqual({ current: null, queued: [], paidThrough: null });
    await expect(adminEndPlan({ actorId: "admin-1", ownerId: "user-1", reason: "again", now: NOW + 3 * DAY })).rejects.toMatchObject({ code: "NO_ACTIVE_PLAN" });
    expect(audits("user-1").map((row) => (row as { action: string }).action)).toEqual(["plan.admin.activated", "plan.admin.extended", "plan.admin.replaced", "plan.admin.ended"]);
  });

  it("lets an admin account receive a plan too", async () => {
    await adminActivatePlan({ actorId: "admin-1", ownerId: "admin-1", plan: "max", now: NOW });
    expect(await planState("admin-1", NOW)).toMatchObject({ current: { plan_code: "max", source: "admin" } });
    expect((await walletSummary("admin-1", NOW)).included).toMatchObject({ original: 350_000 });
  });

  it("never lets two active periods overlap and keeps period facts immutable", async () => {
    await adminActivatePlan({ actorId: "admin-1", ownerId: "user-1", plan: "plus", now: NOW });
    expect(() => db.prepare(`INSERT INTO access_periods (id,owner_id,plan_code,source,period_start,period_end,period_start_ms,period_end_ms,status,created_at,updated_at)
      SELECT 'x','user-1','pro','admin','a','b',?,?,'active',1,1 WHERE NOT EXISTS (SELECT 1 FROM access_periods WHERE owner_id='user-1' AND status='active'
        AND period_start_ms<? AND period_end_ms>?)`).run(NOW + DAY, NOW + 2 * DAY, NOW + 2 * DAY, NOW + DAY)).not.toThrow();
    expect(periods("user-1")).toHaveLength(1);
    expect(() => db.prepare("UPDATE access_periods SET period_end_ms=period_end_ms+1").run()).toThrow(/ACCESS_PERIOD_IMMUTABLE/);
    expect(() => db.prepare("UPDATE access_periods SET plan_code='max'").run()).toThrow(/ACCESS_PERIOD_IMMUTABLE/);
    expect(() => db.prepare(`INSERT INTO access_periods (id,owner_id,plan_code,source,period_start,period_end,period_start_ms,period_end_ms,status,created_at,updated_at)
      VALUES ('p','user-1','pro','payment','a','b',1,2,'active',1,1)`).run()).toThrow(/CHECK/);
  });
});

describe("entitlement, admin views and wallet read the local period", () => {
  it("grants the plan's tier, features and period allowance, and falls back to Free when it ends", async () => {
    expect(await entitlement("user-1")).toMatchObject({ tier: "free", access: { authority: "free", commercialActive: false } });
    const now = Date.now();
    await adminActivatePlan({ actorId: "admin-1", ownerId: "user-1", plan: "pro", now });
    expect(await entitlement("user-1")).toMatchObject({ tier: "pro", access: { authority: "admin_grant", commercialActive: true, topupEligible: true, plan: "pro", fresh: true } });
    expect(await getUser("user-1")).toMatchObject({ tier: "pro", plan: { code: "pro", source: "admin" } });
    expect((await listUsers({ tier: "pro" })).items.map((item) => item.id)).toEqual(["user-1"]);
    expect((await listUsers()).summary.tiers).toMatchObject({ pro: 1, free: 1 });

    const wallet = await walletSummary("user-1");
    expect(wallet).toMatchObject({ mode: "paid", included: { original: 100_000, remaining: 100_000 }, spendableTotal: 100_000 });
    const { reservation } = await reserveCharacters({ ownerId: "user-1", idempotencyKey: "k1", fingerprint: "f1", operation: "generate", sourceCharacters: 1_000 });
    expect(reservation).toMatchObject({ mode: "paid", application_app_key: "tulisai" });
    await settleReservation(reservation.id, 1_000, "result-1");
    expect((await walletSummary("user-1")).included).toMatchObject({ settled: 1_000, remaining: 99_000 });
    // Replaying a summary never issues a second grant for the same period.
    await walletSummary("user-1"); await walletSummary("user-1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_grants WHERE owner_id='user-1' AND kind='included'").get()).toEqual({ n: 1 });

    await adminEndPlan({ actorId: "admin-1", ownerId: "user-1", reason: "done" });
    expect(await entitlement("user-1")).toMatchObject({ tier: "free", access: { authority: "free" } });
    expect((await walletSummary("user-1")).mode).toBe("free");
    await expect(reserveCharacters({ ownerId: "user-1", idempotencyKey: "k2", fingerprint: "f2", operation: "generate", sourceCharacters: 5_000 })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  it("issues a fresh allowance when a queued renewal starts", async () => {
    const start = Date.now() - 20 * DAY;
    await adminActivatePlan({ actorId: "admin-1", ownerId: "user-1", plan: "plus", now: start });
    await adminActivatePlan({ actorId: "admin-1", ownerId: "user-1", plan: "plus", now: start });
    const first = await walletSummary("user-1", start + DAY);
    const second = await walletSummary("user-1", start + 40 * DAY);
    expect(first.included?.periodEnd).toBe(second.included?.periodStart);
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_grants WHERE owner_id='user-1' AND kind='included'").get()).toEqual({ n: 2 });
  });
});

describe("migration 0014", () => {
  it("rebuilds B4 wallet tables without losing rows or references", () => {
    const upgrade = new DatabaseSync(":memory:"); upgrade.exec("PRAGMA foreign_keys=ON");
    for (const name of migrationFiles().filter((name) => name < "0014")) upgrade.exec(readFileSync(join("migrations", name), "utf8"));
    upgrade.exec("INSERT INTO user (id,name,email,role,tier,created_at,updated_at) VALUES ('u','U','u@test','user','free',1,1)");
    upgrade.exec("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at) VALUES ('l','mkl','i','s','u','m',1,1)");
    upgrade.exec("INSERT INTO character_grants (id,owner_id,kind,original_amount,state,measurement_version,created_at,updated_at) VALUES ('g','u','free',3000,'active','v',1,1)");
    upgrade.exec(`INSERT INTO character_purchased_lots (id,owner_id,identity_link_id,fulfillment_id,customer_binding_hash,application_app_key,catalog_item_id,original_amount,
      fulfilled_at,expires_at,fulfilled_at_ms,expires_at_ms,verification_revision,verification_payload_hash,state,measurement_version,created_at,updated_at)
      VALUES ('lot','u','l','f','h','tulisai','c',100,'a','b',1,2,'1','h','active','v',1,1)`);
    upgrade.exec("INSERT INTO character_wallet_events (id,owner_id,event_type,grant_id,lot_id,created_at) VALUES ('e','u','x','g','lot',1)");
    upgrade.exec(`BEGIN;\n${readFileSync(join("migrations", "0014_local_access_periods.sql"), "utf8")}\nCOMMIT;`);
    expect(upgrade.prepare("SELECT id,identity_link_id FROM character_grants").all()).toEqual([{ id: "g", identity_link_id: null }]);
    expect(upgrade.prepare("SELECT id,identity_link_id FROM character_purchased_lots").all()).toEqual([{ id: "lot", identity_link_id: "l" }]);
    expect(upgrade.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(upgrade.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_hold'").all()).toEqual([]);
    // Included grants no longer need an MKL link.
    upgrade.exec(`INSERT INTO character_grants (id,owner_id,kind,entitlement_id,application_app_key,period_start,period_end,period_start_ms,period_end_ms,original_amount,state,measurement_version,created_at,updated_at)
      VALUES ('g2','u','included','p','tulisai','a','b',1,2,100,'active','v',1,1)`);
    upgrade.close();
  });
});
