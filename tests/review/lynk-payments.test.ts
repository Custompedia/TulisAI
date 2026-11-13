import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { applyMigrations } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { LYNK_PRODUCTS, lynkProduct, lynkProductOf, YEARLY_PRICE_IDR, type LynkProductKey } from "@/lib/lynk-products";
import { PLAN_LIMITS, TOP_UPS } from "@/lib/plans";
import { adminAttachLynk, claimForVerifiedEmail, claimToken, claimWithLink, handleLynkWebhook } from "@/server/payments/lynk";
import { listOrders } from "@/server/payments/orders";
import { paymentReport } from "@/server/payments/report";
import { adminActivatePlan, planState } from "@/server/access/periods";
import { entitlement } from "@/server/usage/quota";
import { walletSummary } from "@/server/usage/wallet";

// Buying through Lynk (docs/lynk-payments.md): the signed payment.received, forwarded by the custompedia store's
// webhook, grants once per payment, waits for an account when the email has none, and is claimed by link or sign-in.

let db: DatabaseSync;
let beforeBatch: (() => void) | null = null;
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
    // A concurrent change landing between the plan read and the grant batch.
    if (beforeBatch) { const change = beforeBatch; beforeBatch = null; change(); }
    db.exec("BEGIN IMMEDIATE");
    try { const values = statements.map((statement) => statement.execute()); db.exec("COMMIT"); return values; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  },
});

const KEY = "lynk-merchant-key-test";
type Sent = { from: string; to: string[]; subject: string; text: string; html: string; reply_to?: string; idempotencyKey: string | null };
let sent: Sent[] = [];
let resendFails = false;

const count = (sql: string, ...values: SQLInputValue[]) => Number((db.prepare(sql).get(...values) as { n: number }).n);
const lynkRow = (refId: string) => db.prepare("SELECT * FROM lynk_payments WHERE ref_id=?").get(refId) as Record<string, unknown>;
const order = (id: string) => db.prepare("SELECT * FROM payment_orders WHERE id=?").get(id) as Record<string, unknown> | undefined;
const periods = (owner: string) => db.prepare("SELECT * FROM access_periods WHERE owner_id=? AND status='active' ORDER BY period_start_ms").all(owner) as Array<Record<string, unknown>>;
const addUser = (id: string, email: string, verified: boolean, role = "user") => db.prepare("INSERT INTO user (id,name,email,email_verified,username,role,tier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
  .run(id, id, email, verified ? 1 : 0, id, role, "free", 1, 1);

let refs = 0;
const item = (key: LynkProductKey) => { const product = lynkProduct(key); return { uuid: product.lynkId ? `${product.lynkId}-8244-36439` : "", title: product.title, price: product.priceIdr, qty: 1 }; };
/** A Lynk payment.received for `items`, signed as Lynk signs it (or with `signature`). */
async function pay(items: Array<{ uuid?: string; title: string; price: number; qty?: number }>, options: { email?: string; name?: string; refId?: string; signature?: string; event?: string; grandTotal?: number | string; signedTotal?: string; action?: string } = {}) {
  const refId = options.refId ?? `ref${++refs}`; const messageId = `API_CALL_${refId}`;
  const total = options.grandTotal ?? items.reduce((sum, entry) => sum + entry.price, 0);
  const body = { event: options.event ?? "payment.received", data: { message_action: options.action ?? "SUCCESS", message_code: "0", message_id: messageId, message_data: {
    createdAt: "2026-11-13T10:00:00", customer: { email: options.email ?? "Budi@Example.test", name: options.name ?? "Budi", phone: "0812" }, refId,
    items: items.map((entry) => ({ addons: [], price: entry.price, qty: entry.qty ?? 1, title: entry.title, uuid: entry.uuid ?? "" })),
    totals: { affiliate: 0, convenienceFee: 0, discount: 0, grandTotal: total, totalItem: items.length, totalPrice: total, totalShipping: 0 },
  } } };
  const signature = options.signature ?? createHash("sha256").update(`${options.signedTotal ?? total}${refId}${messageId}${KEY}`).digest("hex");
  const result = await handleLynkWebhook(JSON.stringify(body), signature);
  return { ...result, refId };
}

beforeEach(() => {
  db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db);
  state.env = { DB: d1(), BETTER_AUTH_URL: "https://tulis.test", BETTER_AUTH_SECRET: "a test secret that is long enough", LYNK_MERCHANT_KEY: KEY,
    RESEND_API_KEY: "re_test", EMAIL_FROM: "Tulis Lab <noreply@mail.marikitalembur.com>", EMAIL_REPLY_TO: "marikitalembur@gmail.com", AI_MONTHLY_REQUEST_LIMIT: "100" };
  addUser("u", "budi@example.test", true); addUser("admin-1", "admin@example.test", true, "admin");
  sent = []; resendFails = false; beforeBatch = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://api.resend.com/emails");
    if (resendFails) return Response.json({ name: "internal_server_error" }, { status: 500 });
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test");
    sent.push({ ...JSON.parse(String(init?.body)), idempotencyKey: headers.get("idempotency-key") });
    return Response.json({ id: `email-${sent.length}` });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

describe("the Lynk catalogue", () => {
  it("lists the nine products the owner chose, priced from the plan catalogue and the yearly prices", () => {
    expect(LYNK_PRODUCTS.map((product) => [product.key, product.priceIdr])).toEqual([
      ["plus-1m", 49_000], ["pro-1m", 179_000], ["max-1m", 499_000], ["plus-12m", 390_000], ["pro-12m", 1_430_000], ["max-12m", 3_990_000],
      ["topup-small", 19_000], ["topup-medium", 49_000], ["topup-large", 99_000],
    ]);
    for (const plan of ["plus", "pro", "max"] as const) expect(YEARLY_PRICE_IDR[plan]).toBeLessThan(PLAN_LIMITS[plan].priceIdr * 12);
    expect(new Set(LYNK_PRODUCTS.map((product) => product.title)).size).toBe(LYNK_PRODUCTS.length);
    expect(new Set(LYNK_PRODUCTS.filter((product) => product.lynkId).map((product) => product.lynkId)).size).toBe(LYNK_PRODUCTS.filter((product) => product.lynkId).length);
    for (const product of LYNK_PRODUCTS) if (product.lynkId) expect(product.lynkId).toMatch(/^[0-9a-f]{24}$/);
  });

  it("knows an item by its product id, else by its title with any dash or spacing; anything else is not ours", () => {
    expect(lynkProductOf({ title: "Tulis Lab Pro - Bulanan" })?.key).toBe("pro-1m");
    expect(lynkProductOf({ title: "  tulis lab max — tahunan " })?.key).toBe("max-12m");
    expect(lynkProductOf({ title: "Tulis Lab Tambahan 45.000 Karakter" })?.key).toBe("topup-medium");
    expect(lynkProductOf({ title: "Ruang KOL Pro – Bulanan", uuid: "6af5e9c36db5db9e4fb90648-1-2" })).toBeNull();
    expect(lynkProductOf({ title: "Kaos Custompedia", uuid: "" })).toBeNull();
    for (const product of LYNK_PRODUCTS) if (product.lynkId) expect(lynkProductOf({ uuid: `${product.lynkId}-1-2`, title: "renamed on Lynk" })?.key).toBe(product.key);
  });
});

describe("the webhook", () => {
  it("is closed without the merchant key, answers Lynk's unsigned test, and refuses a wrong signature", async () => {
    state.env.LYNK_MERCHANT_KEY = undefined;
    expect((await pay([item("pro-1m")])).status).toBe(503);
    state.env.LYNK_MERCHANT_KEY = KEY;
    expect(await handleLynkWebhook(JSON.stringify({ event: "test_event", data: { message: "hi" } }), null)).toEqual({ status: 200, body: { ignored: "event" } });
    expect((await handleLynkWebhook("{not json", "x")).status).toBe(400);
    expect((await pay([item("pro-1m")], { signature: "0".repeat(64) })).status).toBe(401);
    expect((await pay([item("pro-1m")], { signature: "" })).status).toBe(401);
    expect(count("SELECT COUNT(*) AS n FROM lynk_payments") + count("SELECT COUNT(*) AS n FROM payment_orders")).toBe(0);
  });

  it("grants a monthly plan to the verified account with the buyer's email, records the order, and emails the buyer", async () => {
    const paid = await pay([item("pro-1m")]);
    expect(paid).toMatchObject({ status: 200, body: { status: "granted", orderId: `LY-${paid.refId}` } });
    expect(order(`LY-${paid.refId}`)).toMatchObject({ user_id: "u", kind: "plan", plan_code: "pro", months: 1, provider: "lynk", provider_mode: "production", amount_idr: 179_000, status: "paid", fulfillment_outcome: "granted" });
    expect(lynkRow(paid.refId)).toMatchObject({ status: "granted", user_id: "u", email: "budi@example.test", product: "pro-1m", claimed_by: "email", amount_idr: 179_000 });
    const [period] = periods("u");
    expect(period).toMatchObject({ plan_code: "pro", source: "payment", payment_order_id: `LY-${paid.refId}` });
    expect(await entitlement("u")).toMatchObject({ tier: "pro" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["budi@example.test"], from: "Tulis Lab <noreply@mail.marikitalembur.com>", reply_to: "marikitalembur@gmail.com", subject: "Paket Tulis Lab Pro aktif", idempotencyKey: `tulis-lynk/${paid.refId}/granted` });
    expect(sent[0]!.text).toContain("Tulis Lab Pro 1 bulan");
    expect(JSON.parse(String(lynkRow(paid.refId).detail_json))).toMatchObject({ product: "pro-1m", email: { granted: "sent" } });
    expect((await listOrders("u"))[0]).toMatchObject({ provider: "lynk", months: 1, status: "paid", granted: true, payUrl: null });
  });

  it("counts a payment once, however often it is sent, and takes over one that was cut short", async () => {
    const first = await pay([item("plus-1m")], { refId: "same" });
    expect(first.body.status).toBe("granted");
    expect(await pay([item("plus-1m")], { refId: "same" })).toMatchObject({ status: 200, body: { duplicate: true, status: "granted" } });
    expect(periods("u")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    // A run that stopped half-way leaves "processing"; a retry within two minutes waits, a later one takes it over.
    db.prepare("INSERT INTO lynk_payments (ref_id,received_at,updated_at,email,product,status) VALUES ('cut',?,?,'budi@example.test','plus-1m','processing')").run(Date.now(), Date.now());
    expect(await pay([item("plus-1m")], { refId: "cut" })).toMatchObject({ status: 503, body: { retry: true } });
    db.prepare("UPDATE lynk_payments SET updated_at=? WHERE ref_id='cut'").run(Date.now() - 3 * 60_000);
    expect((await pay([item("plus-1m")], { refId: "cut" })).body.status).toBe("granted");
    expect(periods("u")).toHaveLength(2);
  });

  it("accepts the total written with decimals, signed as written or as a whole number", async () => {
    expect((await pay([item("plus-1m")], { grandTotal: "49000.0" })).body.status).toBe("granted");
    expect((await pay([item("plus-1m")], { grandTotal: "49000.00", signedTotal: "49000" })).body.status).toBe("granted");
    expect((await pay([item("plus-1m")], { grandTotal: "49000.00", signedTotal: "49001" })).status).toBe(401);
  });

  it("queues a renewal after the paid period, and a yearly plan as twelve monthly periods with their own allowance", async () => {
    await pay([item("pro-1m")]);
    const yearly = await pay([item("pro-12m")]);
    const rows = periods("u");
    expect(rows).toHaveLength(13);
    for (let index = 1; index < rows.length; index++) expect(rows[index]!.period_start_ms).toBe(rows[index - 1]!.period_end_ms);
    expect(rows.slice(1).map((row) => row.payment_order_id)).toEqual([`LY-${yearly.refId}`, ...Array.from({ length: 11 }, (_, index) => `LY-${yearly.refId}#${index + 2}`)]);
    // Anchored to the first day: twelve months later is the same day of the month.
    const start = new Date(Number(rows[1]!.period_start_ms)); const end = new Date(Number(rows[12]!.period_end_ms));
    expect([end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()]).toEqual([start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()]);
    const months = (Number(rows[12]!.period_end_ms) - Number(rows[0]!.period_start_ms)) / (30.44 * 86_400_000);
    expect(months).toBeGreaterThan(12.9); expect(months).toBeLessThan(13.1);
    expect(order(`LY-${yearly.refId}`)).toMatchObject({ months: 12, amount_idr: 1_430_000, access_period_id: rows[1]!.id, characters: 100_000 });
    expect(sent.at(-1)!.subject).toBe("Paket Tulis Lab Pro aktif");
    expect((await planState("u")).paidThrough).toBe(rows[12]!.period_end);
  });

  it("grants a yearly order whole or not at all when a plan changes during the grant, and a retry then grants it", async () => {
    // An admin queues a Pro month five months ahead between the plan read and the grant batch.
    beforeBatch = () => { const start = Date.now() + 150 * 86_400_000; db.prepare(`INSERT INTO access_periods (id,owner_id,plan_code,source,granted_by,period_start,period_end,period_start_ms,period_end_ms,status,created_at,updated_at)
      VALUES ('race','u','pro','admin','admin-1',?,?,?,?,'active',1,1)`).run(new Date(start).toISOString(), new Date(start + 30 * 86_400_000).toISOString(), start, start + 30 * 86_400_000); };
    await expect(pay([item("pro-12m")], { refId: "race-ref" })).rejects.toThrow();
    expect(count("SELECT COUNT(*) AS n FROM access_periods WHERE source='payment'")).toBe(0);
    expect(order("LY-race-ref")).toMatchObject({ fulfilled_at: null, status: "pending" });
    expect(lynkRow("race-ref")).toMatchObject({ status: "processing", updated_at: 0 });
    // Lynk sends it again: the twelve months now follow the queued admin month.
    expect((await pay([item("pro-12m")], { refId: "race-ref" })).body.status).toBe("granted");
    const rows = periods("u");
    expect(rows).toHaveLength(13);
    expect(rows[0]!.id).toBe("race");
    expect(rows[1]!.period_start_ms).toBe(rows[0]!.period_end_ms);
  });

  it("does not guess a swap while another plan runs: the payment is kept for an operator and the buyer is told", async () => {
    await adminActivatePlan({ actorId: "admin-1", ownerId: "u", plan: "max" });
    const paid = await pay([item("plus-1m")]);
    expect(paid.body.status).toBe("needs_operator");
    expect(order(`LY-${paid.refId}`)).toMatchObject({ status: "paid", fulfillment_outcome: "needs_operator", access_period_id: null });
    expect(lynkRow(paid.refId)).toMatchObject({ status: "needs_operator", user_id: "u" });
    expect(sent[0]!.subject).toBe("Pembayaran Tulis Lab diterima");
    const report = await paymentReport(null);
    expect(report.attention).toEqual([expect.objectContaining({ id: `LY-${paid.refId}`, reason: "needs_operator" })]);
  });

  it("adds a top-up, frozen until a plan runs, and says so in the email", async () => {
    const frozen = await pay([item("topup-medium")]);
    expect(frozen.body.status).toBe("granted");
    expect(db.prepare("SELECT original_amount,state,fulfillment_id FROM character_purchased_lots").get()).toEqual({ original_amount: 45_000, state: "frozen", fulfillment_id: `LY-${frozen.refId}` });
    expect(sent[0]!.subject).toBe("Tambahan 45.000 karakter masuk · Tulis Lab");
    expect(sent[0]!.text).toContain("baru bisa dipakai saat paket Plus, Pro, atau Max aktif");
    expect((await walletSummary("u")).purchased).toMatchObject({ available: 0, frozen: 45_000 });
    await pay([item("plus-1m")]);
    expect((await walletSummary("u")).purchased).toMatchObject({ available: 45_000, frozen: 0 });
    await pay([item("topup-small")]);
    expect(sent.at(-1)!.text).not.toContain("baru bisa dipakai");
    expect(count("SELECT COUNT(*) AS n FROM character_purchased_lots WHERE owner_id='u'")).toBe(2);
    expect(TOP_UPS.find((pack) => pack.id === "small")!.characters).toBe(15_000);
  });

  it("ignores other products in the store, and keeps an unusable email or a zero total for an operator", async () => {
    expect((await pay([{ title: "Ruang KOL Pro – Bulanan", uuid: "6af5e9c36db5db9e4fb90648-8244-1", price: 29_000 }])).body).toEqual({ ignored: "product" });
    expect((await pay([{ title: "Kaos Custompedia", price: 85_000 }])).body).toEqual({ ignored: "product" });
    const badEmail = await pay([item("plus-1m")], { email: "not-an-email" });
    expect(badEmail.body).toEqual({ failed: "email" });
    const free = await pay([item("plus-1m")], { grandTotal: 0 });
    expect(free.body.status).toBe("needs_operator");
    expect(count("SELECT COUNT(*) AS n FROM payment_orders")).toBe(0);
    expect(sent).toHaveLength(0);
    const report = await paymentReport(null);
    expect(report.lynk.map((row) => [row.refId, row.status, row.reason])).toEqual(expect.arrayContaining([[badEmail.refId, "failed", "EMAIL_INVALID"], [free.refId, "needs_operator", "ZERO_TOTAL"]]));
    expect(report.lynk.some((row) => row.status === "ignored")).toBe(false);
  });

  it("grants only its own product from a cart that holds other store products, priced at that item", async () => {
    const ruangKol = { title: "Ruang KOL Pro – Bulanan", uuid: "6af5e9c36db5db9e4fb90648-8244-1", price: 29_000 };
    const paid = await pay([ruangKol, item("pro-1m")]);
    expect(paid.body.status).toBe("granted");
    expect(order(`LY-${paid.refId}`)).toMatchObject({ plan_code: "pro", amount_idr: 179_000 });
    expect(lynkRow(paid.refId)).toMatchObject({ product: "pro-1m", amount_idr: 179_000 });
    // A second Tulis Lab product in the same payment is left for an operator, and listed.
    const two = await pay([item("topup-medium"), item("topup-small")]);
    expect(lynkRow(two.refId)).toMatchObject({ status: "granted", product: "topup-medium", amount_idr: 49_000 });
    expect((await paymentReport(null)).lynk).toEqual([expect.objectContaining({ refId: two.refId, extra: 1 })]);
  });

  it("knows each product by the id Lynk sends, whatever its title says", async () => {
    for (const product of LYNK_PRODUCTS) expect(product.lynkId).toMatch(/^[0-9a-f]{24}$/);
    const paid = await pay([{ uuid: `${lynkProduct("max-12m").lynkId}-5527-1`, title: "Tulis Lab Max (judul diganti)", price: 3_990_000 }]);
    expect(order(`LY-${paid.refId}`)).toMatchObject({ plan_code: "max", months: 12 });
  });

  it("answers a payment that was not a success without granting", async () => {
    expect((await pay([item("plus-1m")], { action: "FAILED" })).body).toEqual({ ignored: "event" });
    expect(count("SELECT COUNT(*) AS n FROM lynk_payments")).toBe(0);
  });

  it("keeps a granted payment granted when the email cannot be sent", async () => {
    resendFails = true;
    const paid = await pay([item("plus-1m")]);
    expect(paid.body.status).toBe("granted");
    expect(JSON.parse(String(lynkRow(paid.refId).detail_json)).email).toEqual({ granted: "RESEND_500" });
  });

  it("counts Lynk money as production revenue, with yearly plans apart from monthly ones", async () => {
    await pay([item("pro-1m")]); await pay([item("pro-12m")]); await pay([item("topup-large")]);
    const report = await paymentReport(null);
    expect(report.revenue.byItem).toEqual([
      { kind: "plan", item: "pro", months: 1, grossIdr: 179_000, orders: 1 },
      { kind: "plan", item: "pro", months: 12, grossIdr: 1_430_000, orders: 1 },
      { kind: "topup", item: "large", months: 1, grossIdr: 99_000, orders: 1 },
    ]);
    expect(report.revenue.netIdr).toBe(179_000 + 1_430_000 + 99_000);
    expect(report.recent.every((row) => row.provider === "lynk")).toBe(true);
  });
});

describe("a buyer without a verified account", () => {
  it("waits, emails a claim link, and the link gives the purchase to whichever account opens it", async () => {
    const paid = await pay([item("max-1m")], { email: "baru@example.test", name: "Sari" });
    expect(paid.body.status).toBe("waiting_account");
    expect(lynkRow(paid.refId)).toMatchObject({ status: "waiting_account", user_id: null, order_id: null });
    expect(sent[0]).toMatchObject({ to: ["baru@example.test"], subject: "Aktifkan Tulis Lab Max 1 bulan" });
    const link = /https:\/\/tulis\.test\/billing\/lynk\?ref=([^&\s]+)&t=([0-9a-f]{64})/.exec(sent[0]!.text)!;
    expect(decodeURIComponent(link[1]!)).toBe(paid.refId);
    expect(link[2]).toBe(await claimToken(paid.refId));

    addUser("sari", "sari.lain@example.test", false);
    await expect(claimWithLink("sari", paid.refId, "0".repeat(64))).rejects.toMatchObject({ code: "LYNK_CLAIM_INVALID" });
    expect(await claimWithLink("sari", paid.refId, link[2]!)).toMatchObject({ status: "granted", product: "max-1m", orderId: `LY-${paid.refId}` });
    expect(lynkRow(paid.refId)).toMatchObject({ status: "granted", user_id: "sari", claimed_by: "link" });
    expect(await entitlement("sari")).toMatchObject({ tier: "max" });
    // Opening the link again is harmless; another account cannot take it.
    expect((await claimWithLink("sari", paid.refId, link[2]!)).status).toBe("granted");
    await expect(claimWithLink("u", paid.refId, link[2]!)).rejects.toMatchObject({ code: "LYNK_ALREADY_CLAIMED" });
    expect(periods("sari")).toHaveLength(1);
    expect(count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='payment.lynk.claimed'")).toBe(1);
  });

  it("is not given to an unverified account with that email, but is claimed once the email is verified", async () => {
    addUser("ani", "ani@example.test", false);
    const paid = await pay([item("plus-12m")], { email: "ANI@example.test" });
    expect(paid.body.status).toBe("waiting_account");
    expect(await claimForVerifiedEmail("ani")).toBe(0);
    db.prepare("UPDATE user SET email_verified=1 WHERE id='ani'").run();
    expect(await claimForVerifiedEmail("ani")).toBe(1);
    expect(lynkRow(paid.refId)).toMatchObject({ status: "granted", user_id: "ani", claimed_by: "sign_in" });
    expect(periods("ani")).toHaveLength(12);
    expect(await claimForVerifiedEmail("ani")).toBe(0);
  });

  it("can be attached by an admin to the account with another email", async () => {
    addUser("typo", "dewi@example.test", false);
    const paid = await pay([item("pro-1m")], { email: "dewi@exmaple.test" });
    expect((await paymentReport(null)).lynk).toEqual([expect.objectContaining({ refId: paid.refId, status: "waiting_account", email: "dewi@exmaple.test" })]);
    await expect(adminAttachLynk("admin-1", paid.refId, "nobody@example.test")).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(await adminAttachLynk("admin-1", paid.refId, "Dewi@Example.test")).toMatchObject({ status: "granted" });
    expect(lynkRow(paid.refId)).toMatchObject({ status: "granted", user_id: "typo", claimed_by: "admin" });
    expect(db.prepare("SELECT actor_id,target_user_id FROM admin_audit_log WHERE action='payment.lynk.attached'").get()).toEqual({ actor_id: "admin-1", target_user_id: "typo" });
    await expect(adminAttachLynk("admin-1", paid.refId, "dewi@example.test")).rejects.toMatchObject({ code: "LYNK_NOT_CLAIMABLE" });
    expect((await paymentReport(null)).lynk).toEqual([]);
  });
});
