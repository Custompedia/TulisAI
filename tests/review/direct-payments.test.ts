import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { applyMigrations } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { midtransConfig, paymentOutcome, verifyNotificationSignature } from "@/server/payments/midtrans";
import { applyStatus, createCheckout, handleNotification, refreshOrder } from "@/server/payments/orders";
import { paymentReport } from "@/server/payments/report";
import { adminActivatePlan, planState } from "@/server/access/periods";
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

const KEY = "SB-Mid-server-test-key";
const buyer = { id: "u", name: "Budi", email: "budi@example.test" };
type Status = { transaction_status: string; gross_amount?: string; fraud_status?: string; currency?: string; status_code?: string };
const midtrans = { statuses: new Map<string, Status>(), snapBodies: [] as Array<Record<string, unknown>>, snapFails: false, statusFails: false };
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/snap/v1/transactions")) {
    if (midtrans.snapFails) return Response.json({ error_messages: ["down"] }, { status: 500 });
    const body = JSON.parse(String(init?.body)) as { transaction_details: { order_id: string } };
    midtrans.snapBodies.push(body as unknown as Record<string, unknown>);
    expect(new Headers(init?.headers).get("X-Override-Notification")).toBe("https://tulis.test/api/payments/midtrans/notification");
    return Response.json({ token: `tok-${body.transaction_details.order_id}`, redirect_url: `https://app.sandbox.midtrans.com/snap/v4/redirection/${body.transaction_details.order_id}` });
  }
  const match = /\/v2\/([^/]+)\/status$/.exec(url);
  if (match) {
    if (midtrans.statusFails) throw new TypeError("network");
    const id = decodeURIComponent(match[1]!); const status = midtrans.statuses.get(id);
    if (!status) return Response.json({ status_code: "404", status_message: "not found" });
    return Response.json({ order_id: id, status_code: "200", currency: "IDR", ...status });
  }
  throw new Error(`unexpected ${url}`);
};
const sign = async (orderId: string, statusCode: string, gross: string, key = KEY) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(`${orderId}${statusCode}${gross}${key}`))), (byte) => byte.toString(16).padStart(2, "0")).join("");
const notify = async (orderId: string, gross: string, key = KEY) => handleNotification({ order_id: orderId, status_code: "200", gross_amount: gross, transaction_status: "settlement", signature_key: await sign(orderId, "200", gross, key) }, Date.now(), fetcher);
const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
const order = (id: string) => db.prepare("SELECT * FROM payment_orders WHERE id=?").get(id) as Record<string, unknown>;

beforeEach(() => {
  db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db);
  state.env = { DB: d1(), BETTER_AUTH_URL: "https://tulis.test", MIDTRANS_SERVER_KEY: KEY, MIDTRANS_MODE: "sandbox", TULISAI_COMMERCE_CHECKOUT_ENABLED: "true", AI_MONTHLY_REQUEST_LIMIT: "100" };
  for (const [id, role] of [["u", "user"], ["admin-1", "admin"]]) db.prepare("INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, id === "u" ? "Budi" : "Admin", `${id}@example.test`, id, role, "free", 1, 1);
  midtrans.statuses.clear(); midtrans.snapBodies = []; midtrans.snapFails = false; midtrans.statusFails = false;
});
afterEach(() => db.close());

describe("Midtrans configuration and verification", () => {
  it("closes payments without a key and refuses risky key/mode combinations", () => {
    expect(midtransConfig({ BETTER_AUTH_URL: "https://tulis.test" } as never)).toBeNull();
    expect(midtransConfig({ BETTER_AUTH_URL: "https://tulis.test", MIDTRANS_SERVER_KEY: "SB-x", MIDTRANS_MODE: "production" } as never)).toBeNull();
    expect(midtransConfig({ BETTER_AUTH_URL: "https://tulis.test", MIDTRANS_SERVER_KEY: "x", MIDTRANS_MODE: "live" } as never)).toBeNull();
    expect(midtransConfig({ BETTER_AUTH_URL: "https://tulis.marikitalembur.com", MIDTRANS_SERVER_KEY: "SB-x" } as never)).toBeNull();
    expect(midtransConfig({ BETTER_AUTH_URL: "https://tulis.marikitalembur.com", MIDTRANS_SERVER_KEY: "Mid-server-sandbox-new", MIDTRANS_MODE: "sandbox" } as never)).toMatchObject({ mode: "sandbox" });
    expect(midtransConfig({ BETTER_AUTH_URL: "https://tulis.marikitalembur.com/", MIDTRANS_SERVER_KEY: "Mid-server-live", MIDTRANS_MODE: "production" } as never)).toMatchObject({ mode: "production", appUrl: "https://tulis.marikitalembur.com" });
  });

  it("verifies the SHA-512 signature and maps statuses without trusting card challenges", async () => {
    const config = midtransConfig(state.env as never)!;
    const good = { order_id: "TA-1", status_code: "200", gross_amount: "49000.00", signature_key: await sign("TA-1", "200", "49000.00") };
    expect(await verifyNotificationSignature(config, good)).toBe(true);
    expect(await verifyNotificationSignature(config, { ...good, gross_amount: "1.00" })).toBe(false);
    expect(await verifyNotificationSignature(config, { ...good, signature_key: good.signature_key.toUpperCase() })).toBe(true);
    expect(paymentOutcome({ transaction_status: "settlement" })).toBe("paid");
    expect(paymentOutcome({ transaction_status: "capture", fraud_status: "challenge" })).toBe("pending");
    expect(paymentOutcome({ transaction_status: "capture", fraud_status: "accept" })).toBe("paid");
    for (const [status, outcome] of [["deny", "failed"], ["expire", "expired"], ["cancel", "cancelled"], ["partial_refund", "refunded"], ["chargeback", "refunded"], ["pending", "pending"]]) expect(paymentOutcome({ transaction_status: status! })).toBe(outcome);
  });
});

describe("checkout", () => {
  it("stays closed until both the local gate and a server key allow it", async () => {
    state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = "false";
    await expect(createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).rejects.toMatchObject({ code: "PAYMENTS_CLOSED" });
    state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = "true"; state.env.MIDTRANS_SERVER_KEY = undefined;
    await expect(createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).rejects.toMatchObject({ code: "PAYMENTS_CLOSED" });
    expect(count("SELECT COUNT(*) AS n FROM payment_orders")).toBe(0);
  });

  it("prices on the server, reuses an unpaid order, and never lets the browser name an amount", async () => {
    const first = await createCheckout(buyer, { kind: "plan", plan: "pro" }, Date.now(), fetcher);
    expect(first).toMatchObject({ reused: false, order: { kind: "plan", plan: "pro", amountIdr: 179_000, characters: 100_000, mode: "sandbox", status: "pending" } });
    expect(first.order.payUrl).toContain(first.order.id);
    expect(midtrans.snapBodies[0]).toMatchObject({ transaction_details: { order_id: first.order.id, gross_amount: 179_000 }, customer_details: { email: "budi@example.test" }, callbacks: { finish: `https://tulis.test/billing/return?order=${first.order.id}` } });
    const again = await createCheckout(buyer, { kind: "plan", plan: "pro" }, Date.now(), fetcher);
    expect(again).toMatchObject({ reused: true, order: { id: first.order.id } });
    expect(midtrans.snapBodies).toHaveLength(1);
  });

  it("marks an order failed when the payment page cannot be created", async () => {
    midtrans.snapFails = true;
    await expect(createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).rejects.toMatchObject({ code: "PAYMENT_PAGE_UNAVAILABLE" });
    expect(db.prepare("SELECT status,provider_status FROM payment_orders").get()).toEqual({ status: "failed", provider_status: "snap_unavailable" });
  });

  it("requires a running plan for top-ups and refuses a different plan while one runs", async () => {
    await expect(createCheckout(buyer, { kind: "topup", pack: "small" }, Date.now(), fetcher)).rejects.toMatchObject({ code: "PAID_PLAN_REQUIRED" });
    await adminActivatePlan({ actorId: "admin-1", ownerId: "u", plan: "plus" });
    await expect(createCheckout(buyer, { kind: "plan", plan: "max" }, Date.now(), fetcher)).rejects.toMatchObject({ code: "PLAN_ACTIVE" });
    await expect(createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).resolves.toMatchObject({ order: { amountIdr: 49_000 } });
    await expect(createCheckout(buyer, { kind: "topup", pack: "medium" }, Date.now(), fetcher)).resolves.toMatchObject({ order: { kind: "topup", pack: "medium", amountIdr: 49_000, characters: 45_000 } });
  });
});

describe("notification, refresh and grants", () => {
  it("grants a paid plan exactly once, only from the status read back from Midtrans", async () => {
    const { order: created } = await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher);
    expect((await handleNotification({ order_id: created.id, status_code: "200", gross_amount: "49000.00", signature_key: "bad" }, Date.now(), fetcher)).status).toBe(401);
    // The notification claims settlement, but Midtrans says pending: nothing is granted.
    midtrans.statuses.set(created.id, { transaction_status: "pending", gross_amount: "49000.00" });
    expect(await notify(created.id, "49000.00")).toMatchObject({ status: 200, body: { ok: true, status: "pending" } });
    expect(count("SELECT COUNT(*) AS n FROM access_periods")).toBe(0);

    midtrans.statuses.set(created.id, { transaction_status: "settlement", gross_amount: "49000.00" });
    await Promise.all([notify(created.id, "49000.00"), refreshOrder("u", created.id, Date.now(), fetcher), notify(created.id, "49000.00")]);
    await refreshOrder("u", created.id, Date.now(), fetcher);
    expect(count("SELECT COUNT(*) AS n FROM access_periods WHERE source='payment'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='payment.plan.activated'")).toBe(1);
    expect(order(created.id)).toMatchObject({ status: "paid", fulfillment_outcome: "granted" });
    expect(await entitlement("u")).toMatchObject({ tier: "plus", access: { authority: "payment", commercialActive: true } });
    expect((await walletSummary("u")).included).toMatchObject({ original: 25_000 });
    await expect(refreshOrder("admin-1", created.id, Date.now(), fetcher)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await handleNotification({ order_id: "TA-unknown", status_code: "200", gross_amount: "1.00", signature_key: await sign("TA-unknown", "200", "1.00") }, Date.now(), fetcher)).toMatchObject({ status: 200, body: { ok: false } });
  });

  it("queues a paid renewal after the running period", async () => {
    const first = (await createCheckout(buyer, { kind: "plan", plan: "pro" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(first.id, { transaction_status: "settlement", gross_amount: "179000.00" }); await notify(first.id, "179000.00");
    const second = (await createCheckout(buyer, { kind: "plan", plan: "pro" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(second.id, { transaction_status: "settlement", gross_amount: "179000.00" }); await notify(second.id, "179000.00");
    const periods = db.prepare("SELECT period_start,period_end FROM access_periods ORDER BY period_start_ms").all() as Array<{ period_start: string; period_end: string }>;
    expect(periods).toHaveLength(2); expect(periods[1]!.period_start).toBe(periods[0]!.period_end);
    expect(count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='payment.plan.renewed'")).toBe(1);
  });

  it("holds the money for an operator when another plan started before payment completed", async () => {
    const created = (await createCheckout(buyer, { kind: "plan", plan: "max" }, Date.now(), fetcher)).order;
    await adminActivatePlan({ actorId: "admin-1", ownerId: "u", plan: "plus" });
    midtrans.statuses.set(created.id, { transaction_status: "settlement", gross_amount: "499000.00" }); await notify(created.id, "499000.00");
    expect(order(created.id)).toMatchObject({ status: "paid", fulfillment_outcome: "needs_operator", access_period_id: null });
    expect((await planState("u")).current).toMatchObject({ plan_code: "plus", source: "admin" });
    expect(count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='payment.needs_operator'")).toBe(1);
  });

  it("refuses a wrong amount or a mode mismatch without granting", async () => {
    const created = (await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(created.id, { transaction_status: "settlement", gross_amount: "1000.00" }); await notify(created.id, "1000.00");
    expect(order(created.id)).toMatchObject({ status: "pending", fulfilled_at: null });
    expect(count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='payment.amount_mismatch'")).toBe(1);
    state.env.MIDTRANS_MODE = "production"; state.env.MIDTRANS_SERVER_KEY = "Mid-server-live";
    midtrans.statuses.set(created.id, { transaction_status: "settlement", gross_amount: "49000.00" });
    await notify(created.id, "49000.00", "Mid-server-live");
    expect(order(created.id)).toMatchObject({ status: "pending", fulfilled_at: null });
    expect(count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='payment.mode_mismatch'")).toBe(1);
  });

  it("expires unanswered orders and never unpays a paid one", async () => {
    const created = (await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).order;
    await refreshOrder("u", created.id, Date.parse(created.expiresAt) + 1, fetcher);
    expect(order(created.id).status).toBe("expired");
    const paid = (await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(paid.id, { transaction_status: "settlement", gross_amount: "49000.00" }); await notify(paid.id, "49000.00");
    const config = midtransConfig(state.env as never)!;
    await applyStatus(config, order(paid.id) as never, { order_id: paid.id, transaction_status: "expire" });
    expect(order(paid.id).status).toBe("paid");
    midtrans.statusFails = true;
    const pending = (await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).order;
    await expect(refreshOrder("u", pending.id, Date.now(), fetcher)).rejects.toMatchObject({ code: "PAYMENT_STATUS_UNAVAILABLE" });
  });

  it("credits a top-up once, spends it after the plan allowance, and reverses only what is left on refund", async () => {
    await adminActivatePlan({ actorId: "admin-1", ownerId: "u", plan: "plus" });
    const created = (await createCheckout(buyer, { kind: "topup", pack: "small" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(created.id, { transaction_status: "settlement", gross_amount: "19000.00" });
    await Promise.all([notify(created.id, "19000.00"), notify(created.id, "19000.00")]);
    expect(count("SELECT COUNT(*) AS n FROM character_purchased_lots")).toBe(1);
    const wallet = await walletSummary("u");
    expect(wallet).toMatchObject({ mode: "paid", purchased: { available: 15_000 }, spendableTotal: 40_000 });
    const lot = db.prepare("SELECT expires_at,fulfilled_at,identity_link_id FROM character_purchased_lots").get() as { expires_at: string; fulfilled_at: string; identity_link_id: null };
    expect(lot.identity_link_id).toBeNull();
    expect(new Date(lot.expires_at).getUTCFullYear() - new Date(lot.fulfilled_at).getUTCFullYear()).toBe(1);

    db.prepare("UPDATE character_grants SET settled_amount=original_amount WHERE kind='included'").run();
    const { reservation } = await reserveCharacters({ ownerId: "u", idempotencyKey: "spend", fingerprint: "spend", operation: "generate", sourceCharacters: 5_000 });
    await settleReservation(reservation.id, 5_000, "r1");
    midtrans.statuses.set(created.id, { transaction_status: "refund", gross_amount: "19000.00" });
    await refreshOrder("u", created.id, Date.now(), fetcher); await refreshOrder("u", created.id, Date.now(), fetcher);
    expect(db.prepare("SELECT state,reversal_state,settled_amount FROM character_purchased_lots").get()).toEqual({ state: "reversed", reversal_state: "reversed", settled_amount: 5_000 });
    expect(count("SELECT COUNT(*) AS n FROM character_lot_corrections")).toBe(1);
    expect(order(created.id).status).toBe("refunded");
  });

  it("leaves a refunded plan to an operator", async () => {
    const created = (await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(created.id, { transaction_status: "settlement", gross_amount: "49000.00" }); await notify(created.id, "49000.00");
    midtrans.statuses.set(created.id, { transaction_status: "refund", gross_amount: "49000.00" }); await refreshOrder("u", created.id, Date.now(), fetcher);
    expect((await planState("u")).current).toMatchObject({ plan_code: "plus" });
    expect(count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='payment.refund.needs_operator'")).toBe(1);
    const report = await paymentReport(null);
    expect(report.attention).toEqual([expect.objectContaining({ id: created.id, reason: "plan_refunded" })]);
  });
});

describe("admin payment report", () => {
  it("counts production revenue only, shows sandbox as a count, and nets refunds", async () => {
    const sandbox = (await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(sandbox.id, { transaction_status: "settlement", gross_amount: "49000.00" }); await notify(sandbox.id, "49000.00");
    state.env.MIDTRANS_MODE = "production"; state.env.MIDTRANS_SERVER_KEY = "Mid-server-live";
    const live = (await createCheckout(buyer, { kind: "plan", plan: "plus" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(live.id, { transaction_status: "settlement", gross_amount: "49000.00" }); await notify(live.id, "49000.00", "Mid-server-live");
    const pack = (await createCheckout(buyer, { kind: "topup", pack: "large" }, Date.now(), fetcher)).order;
    midtrans.statuses.set(pack.id, { transaction_status: "settlement", gross_amount: "99000.00" }); await notify(pack.id, "99000.00", "Mid-server-live");
    midtrans.statuses.set(pack.id, { transaction_status: "refund", gross_amount: "99000.00" }); await refreshOrder("u", pack.id, Date.now(), fetcher);
    const report = await paymentReport(null);
    expect(report.revenue).toMatchObject({ plan: { grossIdr: 49_000, orders: 1 }, topup: { grossIdr: 99_000, orders: 1 }, refundedIdr: 99_000, netIdr: 49_000 });
    expect(report.sandboxOrders).toBe(1);
    expect(report.recent).toHaveLength(3);
    await expect(paymentReport("2026-13")).rejects.toMatchObject({ code: "INVALID_MONTH" });
  });
});
