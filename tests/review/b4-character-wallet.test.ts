import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, migrationFiles } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, ConfigurationError: class extends Error {} }));

import { countCodePoints, requestFingerprint } from "@/server/usage/measurement";
import {
  acceptVerifiedPurchasedLot, applyVerifiedLotCorrection, ensureFreeGrant, EXECUTION_LEASE_MS,
  extendReservation, issueIncludedGrantFromProjection, reapExpiredReservations, releaseReservation, reserveCharacters,
  settleReservation, walletSummary,
} from "@/server/usage/wallet";

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(value.changes) } }; }
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

const NOW = Date.parse("2026-09-21T04:00:00.000Z");
const iso = (millis: number) => new Date(millis).toISOString();
const user = (id = "u") => db.prepare("INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
  .run(id, id, `${id}@example.test`, id, "user", "free", NOW, NOW);
const paid = (plan: "plus" | "pro" | "max" = "plus", overrides: { userId?: string; entitlementId?: string; start?: number; end?: number; revision?: number; freshUntil?: number } = {}) => {
  const owner = overrides.userId ?? "u"; const start = overrides.start ?? NOW - 1_000; const end = overrides.end ?? NOW + 86_400_000;
  const revision = overrides.revision ?? 1; const entitlement = overrides.entitlementId ?? `ent-${plan}`;
  db.prepare("INSERT OR IGNORE INTO external_identity_link (id,provider,issuer,subject,organization_id,user_id,link_method,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(`link-${owner}`, "mkl", "https://mkl.test", `subject-${owner}`, `org-${owner}`, owner, "mkl-sign-in", NOW, NOW);
  db.prepare(`INSERT INTO mkl_entitlement_projection (user_id,identity_link_id,issuer,subject,organization_id,application_client_id,application_app_key,catalog_item_id,
      scope_revision,authority_payload_hash,entitlement_id,status,plan_code,plan_version,period_start,period_end,access_deadline,commercial_kind,entitlement_created_at,
      server_time,verified_at,fresh_until,invalidated_at,invalidation_reason,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET scope_revision=excluded.scope_revision,authority_payload_hash=excluded.authority_payload_hash,
      entitlement_id=excluded.entitlement_id,status=excluded.status,plan_code=excluded.plan_code,plan_version=excluded.plan_version,
      period_start=excluded.period_start,period_end=excluded.period_end,access_deadline=excluded.access_deadline,
      server_time=excluded.server_time,verified_at=excluded.verified_at,fresh_until=excluded.fresh_until,invalidated_at=NULL,invalidation_reason=NULL,updated_at=excluded.updated_at`)
    .run(owner, `link-${owner}`, "https://mkl.test", `subject-${owner}`, `org-${owner}`, "client", "tulisai", "catalog", revision,
      `hash-${revision}-${plan}-${entitlement}`, entitlement, "active", plan, "pricing-v1", iso(start), iso(end), iso(end), "access", iso(start), iso(NOW), NOW,
      overrides.freshUntil ?? NOW + 15 * 60_000, null, null, NOW);
  return { owner, start, end, entitlement, revision };
};
const fulfillment = (id: string, quantity: number, expiresAt: number, fulfilledAt = NOW - 10_000) => ({
  ownerId: "u", identityLinkId: "link-u", fulfillmentId: id, customerBindingHash: "binding-u", applicationAppKey: "tulisai", catalogItemId: "catalog",
  offerId: "fixture-offer", offerVersion: "fixture-v1", quantity, fulfilledAt: iso(fulfilledAt), expiresAt: iso(expiresAt),
  verificationRevision: "fixture-rev-1", verificationPayloadHash: `payload-${id}-${quantity}-${expiresAt}`,
});
const reserve = (key: string, amount: number, now = NOW, fingerprint = `fp-${key}`) => reserveCharacters({
  ownerId: "u", idempotencyKey: key, fingerprint, operation: "generate", sourceCharacters: amount, now,
});

beforeEach(() => {
  db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db);
  state.env = { DB: d1() };
});
afterEach(() => db.close());

describe("B4 Unicode and safe Free cutover", () => {
  it("measures Unicode code points and hashes normalized metadata without storing content", async () => {
    expect(countCodePoints("abc")).toBe(3); expect(countCodePoints("😀")).toBe(1); expect(countCodePoints("a😀b")).toBe(3);
    expect(await requestFingerprint({ b: 2, a: 1 })).toBe(await requestFingerprint({ a: 1, b: 2 }));
  });

  it("issues one fixed Free grant and never reissues it across link churn or paid expiry", async () => {
    user(); await ensureFreeGrant("u", NOW); await ensureFreeGrant("u", NOW + 1);
    expect(db.prepare("SELECT COUNT(*) AS n,MAX(original_amount) AS amount FROM character_grants WHERE owner_id='u' AND kind='free'").get()).toEqual({ n: 1, amount: 3000 });
    paid(); db.prepare("DELETE FROM mkl_entitlement_projection WHERE user_id='u'").run(); db.prepare("DELETE FROM external_identity_link WHERE user_id='u'").run();
    await ensureFreeGrant("u", NOW + 2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_grants WHERE owner_id='u' AND kind='free'").get()).toEqual({ n: 1 });
  });

  it("reconciles only demonstrably unused legacy Free accounts and leaves ambiguous evidence pending", () => {
    const legacy = new DatabaseSync(":memory:"); legacy.exec("PRAGMA foreign_keys=ON");
    for (const name of migrationFiles().filter((name) => name !== "0013_b4_character_wallet.sql")) legacy.exec(readFileSync(join("migrations", name), "utf8"));
    legacy.exec("INSERT INTO user (id,name,email,tier,created_at,updated_at) VALUES ('unused','U','unused@test','free',1,1),('used','U','used@test','free',1,1),('override','U','override@test','free',1,1)");
    legacy.exec("INSERT INTO usage_ledger (id,owner_id,idempotency_key,operation,status,period_key,request_id,charge_characters,created_at) VALUES ('x','used','x','generate','completed','2026-08','x',0,1)");
    legacy.exec("UPDATE user SET ai_character_limit_override=99999 WHERE id='override'");
    legacy.exec(readFileSync(join("migrations", "0013_b4_character_wallet.sql"), "utf8"));
    expect(legacy.prepare("SELECT owner_id,free_grant_state FROM character_wallet_account ORDER BY owner_id").all()).toEqual([
      { owner_id: "override", free_grant_state: "legacy_pending" }, { owner_id: "unused", free_grant_state: "reconciled" }, { owner_id: "used", free_grant_state: "legacy_pending" },
    ]);
    expect(legacy.prepare("SELECT owner_id,original_amount FROM character_grants").all()).toEqual([{ owner_id: "unused", original_amount: 3000 }]);
    legacy.close();
  });
});

describe("B4 included grants and paid isolation", () => {
  it("issues exact Plus/Pro/Max amounts once per verified entitlement period", async () => {
    for (const [plan, amount] of [["plus", 25_000], ["pro", 100_000], ["max", 350_000]] as const) {
      const owner = `u-${plan}`; user(owner); paid(plan, { userId: owner, entitlementId: `ent-${plan}` });
      await issueIncludedGrantFromProjection(owner, NOW); await issueIncludedGrantFromProjection(owner, NOW + 1);
      expect(db.prepare("SELECT COUNT(*) AS n,MAX(original_amount) AS amount FROM character_grants WHERE owner_id=? AND kind='included'").get(owner)).toEqual({ n: 1, amount });
    }
  });

  it("does not replenish on revision replay or month boundaries, but creates one grant for a genuinely new period", async () => {
    user(); const first = paid("plus"); await issueIncludedGrantFromProjection("u", NOW);
    const reservation = await reserve("spend", 1000); await settleReservation(reservation.reservation.id, 1000, "preview-1", null, NOW + 10);
    paid("plus", { entitlementId: first.entitlement, start: first.start, end: first.end, revision: 2 }); await issueIncludedGrantFromProjection("u", NOW + 20);
    expect(db.prepare("SELECT COUNT(*) AS n,MAX(settled_amount) AS used FROM character_grants WHERE owner_id='u' AND kind='included'").get()).toEqual({ n: 1, used: 1000 });
    paid("plus", { entitlementId: "ent-renewed", start: first.end, end: first.end + 86_400_000, revision: 3, freshUntil: first.end + 15 * 60_000 });
    await issueIncludedGrantFromProjection("u", first.end + 1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_grants WHERE owner_id='u' AND kind='included'").get()).toEqual({ n: 2 });
  });

  it("spends paid inventory without touching an original Free remainder", async () => {
    user(); await ensureFreeGrant("u", NOW); paid("plus"); await issueIncludedGrantFromProjection("u", NOW);
    const held = await reserve("paid-use", 500); await settleReservation(held.reservation.id, 500, "paid-preview", null, NOW + 1);
    expect(db.prepare("SELECT settled_amount FROM character_grants WHERE owner_id='u' AND kind='free'").get()).toEqual({ settled_amount: 0 });
    expect(db.prepare("SELECT settled_amount FROM character_grants WHERE owner_id='u' AND kind='included'").get()).toEqual({ settled_amount: 500 });
  });
});

describe("B4 purchased lots, ordering and freeze", () => {
  it("accepts a verified fulfillment exactly once and stores authoritative timestamps", async () => {
    user(); paid(); const fact = fulfillment("ful-1", 15_000, NOW + 100_000);
    const first = await acceptVerifiedPurchasedLot(fact, NOW); expect(await acceptVerifiedPurchasedLot(fact, NOW + 1)).toBe(first);
    expect(db.prepare("SELECT COUNT(*) AS n,original_amount,fulfilled_at,expires_at FROM character_purchased_lots").get()).toEqual({ n: 1, original_amount: 15000, fulfilled_at: fact.fulfilledAt, expires_at: fact.expiresAt });
    await expect(acceptVerifiedPurchasedLot({ ...fact, verificationPayloadHash: "different" }, NOW)).rejects.toMatchObject({ code: "FULFILLMENT_REPLAY_CONFLICT" });
  });

  it("orders included first, then lots by expiry, purchase time, and stable ID, spanning sources", async () => {
    user(); paid(); await issueIncludedGrantFromProjection("u", NOW);
    db.prepare("UPDATE character_grants SET settled_amount=24990 WHERE owner_id='u' AND kind='included'").run();
    await acceptVerifiedPurchasedLot(fulfillment("z-later-id", 10, NOW + 20_000, NOW - 20_000), NOW);
    await acceptVerifiedPurchasedLot(fulfillment("a-earlier-expiry", 10, NOW + 10_000, NOW - 5_000), NOW);
    await acceptVerifiedPurchasedLot(fulfillment("b-same-expiry", 10, NOW + 20_000, NOW - 20_000), NOW);
    const held = await reserve("span", 35); const rows = db.prepare("SELECT source_kind,source_id,reserved_amount FROM character_allocations WHERE reservation_id=? ORDER BY ordinal").all(held.reservation.id);
    expect(rows.map((row) => (row as { source_kind: string }).source_kind)).toEqual(["included_grant", "purchased_lot", "purchased_lot", "purchased_lot"]);
    expect((rows[1] as { source_id: string }).source_id).toBe(db.prepare("SELECT id FROM character_purchased_lots WHERE fulfillment_id='a-earlier-expiry'").get()!.id);
    const tieIds = db.prepare("SELECT id FROM character_purchased_lots WHERE fulfillment_id IN ('z-later-id','b-same-expiry') ORDER BY id").all().map((row) => row.id);
    expect(rows.slice(2).map((row) => row.source_id)).toEqual(tieIds);
  });

  it("freezes without paid authority, reactivates only unexpired lots, and never extends expiry", async () => {
    user(); paid(); await acceptVerifiedPurchasedLot(fulfillment("lot", 100, NOW + 1_000), NOW);
    db.prepare("UPDATE mkl_entitlement_projection SET fresh_until=? WHERE user_id='u'").run(NOW - 1);
    expect((await walletSummary("u", NOW)).purchased.frozen).toBe(100);
    await expect(reserve("free-only", 3001, NOW)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    paid("plus", { revision: 2 }); expect((await walletSummary("u", NOW + 1)).purchased.available).toBe(100);
    expect((await walletSummary("u", NOW + 1_001)).purchased.expired).toBe(100);
  });
});

describe("B4 atomic reservation, settlement, lease and reversal", () => {
  it("prevents overspend and enforces owner-scoped fingerprint idempotency", async () => {
    user(); const outcomes = await Promise.allSettled([reserve("a", 2000), reserve("b", 2000)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const first = await reserveCharacters({ ownerId: "u", idempotencyKey: "same", fingerprint: "one", operation: "generate", sourceCharacters: 1, now: NOW });
    expect((await reserveCharacters({ ownerId: "u", idempotencyKey: "same", fingerprint: "one", operation: "generate", sourceCharacters: 1, now: NOW })).created).toBe(false);
    await expect(reserveCharacters({ ownerId: "u", idempotencyKey: "same", fingerprint: "two", operation: "generate", sourceCharacters: 1, now: NOW })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await releaseReservation(first.reservation.id, "test", NOW + 1);
  });

  it("settles exact charge, releasing excess from the last allocations first", async () => {
    user(); paid(); await issueIncludedGrantFromProjection("u", NOW); db.prepare("UPDATE character_grants SET settled_amount=24990 WHERE kind='included'").run();
    await acceptVerifiedPurchasedLot(fulfillment("lot", 100, NOW + 10_000), NOW);
    const held = await reserve("settle", 50); await settleReservation(held.reservation.id, 15, "preview", "provider", NOW + 1);
    expect(db.prepare("SELECT settled_amount,released_amount FROM character_allocations WHERE reservation_id=? ORDER BY ordinal").all(held.reservation.id)).toEqual([
      { settled_amount: 10, released_amount: 0 }, { settled_amount: 5, released_amount: 35 },
    ]);
  });

  it("CAS-fences concurrent hold extensions so the same delta cannot reserve twice", async () => {
    user(); const held = await reserve("extend-race", 100);
    const results = await Promise.allSettled([extendReservation(held.reservation.id, 250, NOW + 1), extendReservation(held.reservation.id, 250, NOW + 1)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(db.prepare("SELECT current_hold,state FROM character_reservations WHERE id=?").get(held.reservation.id)).toEqual({ current_hold: 250, state: "reserved" });
    expect(db.prepare("SELECT SUM(reserved_amount) AS held FROM character_allocations WHERE reservation_id=?").get(held.reservation.id)).toEqual({ held: 250 });
  });

  it("allows pre-expiry settlement inside the 90s lease, then fences stale workers after reaping", async () => {
    user(); paid("plus", { end: NOW + 10 }); await issueIncludedGrantFromProjection("u", NOW);
    const inside = await reserve("inside", 10); await settleReservation(inside.reservation.id, 10, "inside-preview", null, NOW + 20);
    expect(db.prepare("SELECT state FROM character_reservations WHERE id=?").get(inside.reservation.id)).toEqual({ state: "settled" });
    paid("plus", { entitlementId: "ent-next", start: NOW, end: NOW + 200_000, revision: 2 });
    const stale = await reserve("stale", 10, NOW + 30); expect(stale.reservation.lease_deadline).toBe(NOW + 30 + EXECUTION_LEASE_MS);
    expect(await reapExpiredReservations(stale.reservation.lease_deadline + 1)).toBe(1);
    await expect(settleReservation(stale.reservation.id, 10, "late", null, stale.reservation.lease_deadline + 2)).rejects.toMatchObject({ code: "RESERVATION_EXPIRED" });
    expect(await reapExpiredReservations(stale.reservation.lease_deadline + 3)).toBe(0);
  });

  it("extends from the original pre-expiry snapshot inside the lease but never migrates into a new period", async () => {
    user(); const first = paid("plus", { end: NOW + 10 }); await issueIncludedGrantFromProjection("u", NOW);
    const afterExpiry = await reserve("after-expiry", 100); await settleReservation(afterExpiry.reservation.id, 250, "expanded", null, NOW + 20);
    expect(db.prepare("SELECT settled_amount FROM character_reservations WHERE id=?").get(afterExpiry.reservation.id)).toEqual({ settled_amount: 250 });

    // Leave exactly 100 in the first period, reserve it, then activate a new
    // period. The old operation cannot take its extra output from the renewal.
    db.prepare("UPDATE character_grants SET settled_amount=24900,reserved_amount=0 WHERE entitlement_id=?").run(first.entitlement);
    const old = await reserve("old-period", 100, NOW + 1);
    paid("plus", { entitlementId: "ent-new-period", start: NOW, end: NOW + 200_000, revision: 2 });
    await issueIncludedGrantFromProjection("u", NOW + 2);
    await expect(settleReservation(old.reservation.id, 250, "must-not-migrate", null, NOW + 3)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    await releaseReservation(old.reservation.id, "test cleanup", NOW + 4);
    expect(db.prepare("SELECT settled_amount FROM character_grants WHERE entitlement_id='ent-new-period'").get()).toEqual({ settled_amount: 0 });
  });

  it("reverses unspent inventory, releases every affected reservation, preserves consumption, and replays once", async () => {
    user(); paid(); await issueIncludedGrantFromProjection("u", NOW); db.prepare("UPDATE character_grants SET settled_amount=25000 WHERE kind='included'").run();
    const lotId = await acceptVerifiedPurchasedLot(fulfillment("reversed", 100, NOW + 100_000), NOW);
    const consumed = await reserve("consumed", 20); await settleReservation(consumed.reservation.id, 20, "done", null, NOW + 1);
    const outstanding = await reserve("outstanding", 30, NOW + 2);
    const correction = { ownerId: "u", lotId, correctionId: "corr-1", revision: 1, kind: "reversal" as const, payloadHash: "corr-hash", reasonCode: "refund" };
    await applyVerifiedLotCorrection(correction, NOW + 3); await applyVerifiedLotCorrection(correction, NOW + 4);
    expect(db.prepare("SELECT state,reversal_state,settled_amount,reserved_amount FROM character_purchased_lots WHERE id=?").get(lotId)).toEqual({ state: "reversed", reversal_state: "reversed", settled_amount: 20, reserved_amount: 0 });
    expect(db.prepare("SELECT state FROM character_reservations WHERE id=?").get(outstanding.reservation.id)).toEqual({ state: "released" });
    await expect(settleReservation(outstanding.reservation.id, 30, "late", null, NOW + 5)).rejects.toMatchObject({ code: "RESERVATION_EXPIRED" });
    await expect(applyVerifiedLotCorrection({ ...correction, payloadHash: "conflict" }, NOW + 6)).rejects.toMatchObject({ code: "CORRECTION_CONFLICT" });
  });

  it("accepts only one of two concurrent correction identities at the same revision", async () => {
    user(); paid(); const lotId = await acceptVerifiedPurchasedLot(fulfillment("correction-race", 100, NOW + 100_000), NOW);
    const base = { ownerId: "u", lotId, revision: 1, kind: "reversal" as const, reasonCode: "refund" };
    const results = await Promise.allSettled([
      applyVerifiedLotCorrection({ ...base, correctionId: "a", payloadHash: "a" }, NOW + 1),
      applyVerifiedLotCorrection({ ...base, correctionId: "b", payloadHash: "b" }, NOW + 1),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_lot_corrections WHERE lot_id=?").get(lotId)).toEqual({ n: 1 });
  });
});
