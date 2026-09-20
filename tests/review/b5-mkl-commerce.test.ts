import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, migrationFiles } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, ConfigurationError: class extends Error {} }));

import { B5_PLAN_VERSION, CommerceError, commerceConfig, discoverOffer, readPurchase } from "@/server/commerce/mkl-client";
import { assertPurchaseAuthorizationStart, authorizePurchaseIntent, createPurchaseIntent, getPurchaseIntent, recoverPurchaseIntent } from "@/server/commerce/intents";
import { reserveCharacters, walletSummary } from "@/server/usage/wallet";
import { createAuthorizationState, consumeAuthorizationState } from "@/server/auth/mkl-state";
import type { MklConfig, MklIdentity } from "@/server/auth/mkl-oidc";

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

const NOW = Date.now();
const iso = (value: number) => new Date(value).toISOString();
const config = { issuer: "https://mkl.test", clientId: "tulis-client", secret: "separate-app-secret", appKey: "tulisai", catalogItemId: "catalog-tulisai", returnUri: "https://tulis.test/api/commerce/mkl/return" };
const identity: MklIdentity = { issuer: config.issuer, subject: "subject-u", organizationId: "org-u", email: "buyer@example.test", emailVerified: true, name: "Test Buyer" };

const offer = (planCode: string, overrides: Record<string, unknown> = {}) => {
  const consumable = planCode.startsWith("topup_");
  const price = ({ plus: 49_000, pro: 179_000, max: 499_000, topup_15k: 19_000, topup_45k: 49_000, topup_100k: 99_000 } as Record<string, number>)[planCode] ?? 1;
  return { offer_id: `offer-${planCode}`, name: `Offer ${planCode}`, type: "one_time", price_idr: price,
    catalog_item_id: config.catalogItemId, catalog_title: "TulisAI", plan_code: planCode, plan_version: B5_PLAN_VERSION,
    term_unit: consumable ? null : "month", term_count: consumable ? null : 1, commercial_kind: consumable ? "consumable" : "access",
    consumable_validity_unit: consumable ? "month" : null, consumable_validity_count: consumable ? 12 : null,
    requires_active_access: consumable, ...overrides };
};

const activeCandidate = (overrides: Record<string, unknown> = {}) => ({ entitlement_id: "ent-access", status: "active", active: true,
  plan_code: "plus", plan_version: B5_PLAN_VERSION, period_start: iso(NOW - 60_000), period_end: iso(NOW + 86_400_000),
  access_deadline: iso(NOW + 86_400_000), commercial_kind: "access", created_at: iso(NOW - 60_000), ...overrides });
const authority = (candidates: unknown[], revision = 2) => ({ active: candidates.length > 0, entitlement_id: null, status: null, plan_code: null, plan_version: null, period_start: null, period_end: null,
  server_time: iso(NOW), application: { client_id: config.clientId, app_key: config.appKey, catalog_item_id: config.catalogItemId },
  holder: { subject: identity.subject, organization_id: identity.organizationId }, access_entitlements_complete: true,
  access_entitlements_revision: revision, cancellation_semantics: "no_separate_cancellation_state", access_entitlements: candidates });

const order = (status = "pending_payment") => ({ id: "order-1", order_number: "MKL-1", status, gross_idr: 99_000, paid_at: status === "paid" || status === "charged_back" ? iso(NOW) : null });
const purchase = (overrides: Record<string, unknown> = {}) => ({ order_id: "order-1", status: "paid", paid_at: iso(NOW), plan_code: "topup_100k", plan_version: B5_PLAN_VERSION,
  commercial_kind: "consumable", price_idr_snapshot: 99_000, offer_id: "offer-topup_100k",
  application: { client_id: config.clientId, app_key: config.appKey, catalog_item_id: config.catalogItemId },
  holder: { subject: identity.subject, organization_id: identity.organizationId }, fulfillment_id: "fulfillment-1", fulfilled_at: iso(NOW),
  consumable_expires_at: iso(Date.parse("2027-09-21T08:00:00.000Z")), consumable_validity_unit: "month", consumable_validity_count: 12,
  requires_active_access: true, purchase_revision: 1, corrections_complete: true, corrections: [], ...overrides });

type Fixture = { offers: unknown[]; entitlement: unknown; order: Record<string, unknown>; purchase: Record<string, unknown>; checkoutCalls: number; checkoutBodies: unknown[] };
const fixture = (): Fixture => ({ offers: [offer("plus"), offer("pro"), offer("max"), offer("topup_15k"), offer("topup_45k"), offer("topup_100k")],
  entitlement: authority([activeCandidate()]), order: order(), purchase: purchase(), checkoutCalls: 0, checkoutBodies: [] });
const fetcher = (f: Fixture): typeof fetch => async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.pathname === "/app/v1/offers") return Response.json({ offers: f.offers });
  if (url.pathname === "/app/v1/entitlements") return Response.json(f.entitlement);
  if (url.pathname === "/app/v1/checkout") {
    f.checkoutCalls += 1; f.checkoutBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ order_id: "order-1", order_number: "MKL-1", reused: f.checkoutCalls > 1, checkout_url: "https://mkl.test/pembayaran/order-1" });
  }
  if (url.pathname === "/app/v1/orders") return Response.json(f.order);
  if (url.pathname === "/app/v1/purchases") return Response.json(f.purchase);
  throw new Error(`unexpected ${url}`);
};

function seedUser(withPaidProjection = false) {
  db.prepare("INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("u", "User", "u@example.test", "u", "user", "free", NOW, NOW);
  db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,organization_id,user_id,profile_email,profile_name,link_method,created_at,updated_at,last_authenticated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("link-u", "mkl", config.issuer, identity.subject, identity.organizationId, "u", identity.email, identity.name, "mkl-sign-in", NOW, NOW, NOW);
  if (withPaidProjection) db.prepare(`INSERT INTO mkl_entitlement_projection (user_id,identity_link_id,issuer,subject,organization_id,application_client_id,application_app_key,catalog_item_id,
    scope_revision,authority_payload_hash,entitlement_id,status,plan_code,plan_version,period_start,period_end,access_deadline,commercial_kind,entitlement_created_at,server_time,verified_at,fresh_until,invalidated_at,invalidation_reason,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("u", "link-u", config.issuer, identity.subject, identity.organizationId, config.clientId, config.appKey, config.catalogItemId,
      1, "prior-hash", "ent-old", "active", "plus", B5_PLAN_VERSION, iso(NOW - 60_000), iso(NOW + 86_400_000), iso(NOW + 86_400_000), "access", iso(NOW - 60_000), iso(NOW), NOW, NOW + 900_000, null, null, NOW);
}

beforeEach(() => {
  db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db);
  state.env = { DB: d1(), BETTER_AUTH_URL: "https://tulis.test", MKL_ISSUER: config.issuer, MKL_CLIENT_ID: config.clientId,
    MKL_APP_API_SECRET: config.secret, MKL_APP_KEY: config.appKey, MKL_CATALOG_ITEM_ID: config.catalogItemId };
});
afterEach(() => db.close());

describe("B5 offer and configuration authority", () => {
  it("upgrades a populated 0013 database additively without rewriting B4 data", () => {
    const upgrade = new DatabaseSync(":memory:"); upgrade.exec("PRAGMA foreign_keys=ON");
    for (const name of migrationFiles().filter((name) => name !== "0014_b5_mkl_commerce.sql")) upgrade.exec(readFileSync(join("migrations", name), "utf8"));
    upgrade.exec("INSERT INTO user (id,name,email,role,tier,created_at,updated_at) VALUES ('existing','Existing','existing@test','user','free',1,1)");
    upgrade.exec(readFileSync(join("migrations", "0014_b5_mkl_commerce.sql"), "utf8"));
    expect(upgrade.prepare("SELECT id,name FROM user WHERE id='existing'").get()).toEqual({ id: "existing", name: "Existing" });
    expect(upgrade.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mkl_purchase_intents'").get()).toEqual({ name: "mkl_purchase_intents" });
    upgrade.close();
  });

  it.each([["plus", "access", 49_000], ["pro", "access", 179_000], ["max", "access", 499_000], ["topup_15k", "consumable", 19_000], ["topup_45k", "consumable", 49_000], ["topup_100k", "consumable", 99_000]] as const)
  ("selects exact %s / pricing-v1 semantics without sending local price authority", async (code, kind, price) => {
    const f = fixture(); const result = await discoverOffer(commerceConfig(state.env), code, B5_PLAN_VERSION, fetcher(f));
    expect(result).toMatchObject({ planCode: code, planVersion: B5_PLAN_VERSION, commercialKind: kind, priceIdr: price });
  });

  it("fails closed on unknown code, wrong version, duplicate semantic offers and wrong catalog binding", async () => {
    const f = fixture();
    await expect(discoverOffer(commerceConfig(state.env), "team", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "UNSUPPORTED_PRODUCT" });
    await expect(discoverOffer(commerceConfig(state.env), "plus", "pricing-v2", fetcher(f))).rejects.toMatchObject({ code: "UNSUPPORTED_PRODUCT" });
    f.offers.push(offer("plus", { offer_id: "duplicate" }));
    await expect(discoverOffer(commerceConfig(state.env), "plus", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "OFFER_AMBIGUOUS" });
    f.offers = [offer("plus", { catalog_item_id: "other" })];
    await expect(discoverOffer(commerceConfig(state.env), "plus", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "OFFER_PROVENANCE_MISMATCH" });
  });

  it("requires exact one-month access and authoritative twelve-month access-gated consumable semantics", async () => {
    const f = fixture(); f.offers = [offer("plus", { term_count: 2 })];
    await expect(discoverOffer(commerceConfig(state.env), "plus", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "OFFER_CONTRACT_MISMATCH" });
    f.offers = [offer("topup_15k", { requires_active_access: false })];
    await expect(discoverOffer(commerceConfig(state.env), "topup_15k", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "OFFER_CONTRACT_MISMATCH" });
    f.offers = [offer("topup_15k", { price_idr: 1 })];
    await expect(discoverOffer(commerceConfig(state.env), "topup_15k", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "OFFER_CONTRACT_MISMATCH" });
  });

  it("pins a same-origin query-free registered return URI", () => {
    expect(commerceConfig(state.env).returnUri).toBe("https://tulis.test/api/commerce/mkl/return");
    state.env.MKL_COMMERCE_RETURN_URI = "https://evil.test/return";
    expect(() => commerceConfig(state.env)).toThrowError(CommerceError);
  });

  it("refuses to reuse the OIDC client secret as the application commerce secret", () => {
    state.env.MKL_CLIENT_SECRET = config.secret;
    expect(() => commerceConfig(state.env)).toThrowError(CommerceError);
  });
});

describe("B5 durable intent and OIDC binding", () => {
  it("requires a linked identity and fresh paid authority for a top-up", async () => {
    db.prepare("INSERT INTO user (id,name,email,role,tier,created_at,updated_at) VALUES ('u','U','u@test','user','free',?,?)").run(NOW, NOW);
    await expect(createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "request-1", now: NOW }, fetcher(fixture())))
      .rejects.toMatchObject({ code: "MKL_IDENTITY_REQUIRED" });
    db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,organization_id,user_id,link_method,created_at,updated_at) VALUES ('l','mkl',?,?,?,'u','mkl-sign-in',?,?)")
      .run(config.issuer, identity.subject, identity.organizationId, NOW, NOW);
    await expect(createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "request-1", now: NOW }, fetcher(fixture())))
      .rejects.toMatchObject({ code: "FRESH_PAID_ACCESS_REQUIRED" });
  });

  it("uses one stable local and MKL idempotency identity across reloads and rejects changed reuse", async () => {
    seedUser(true); const f = fixture(); const input = { ownerId: "u", kind: "consumable" as const, planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "request-stable", now: NOW };
    const first = await createPurchaseIntent(input, fetcher(f)); const replay = await createPurchaseIntent(input, fetcher(f));
    expect(replay).toEqual({ intent: first.intent, created: false });
    const stored = await getPurchaseIntent("u", first.intent.purchaseId); expect(stored.mkl_idempotency_key).toBe(`tulisai:${first.intent.purchaseId}`);
    await expect(createPurchaseIntent({ ...input, planCode: "topup_45k" }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_IDEMPOTENCY_CONFLICT" });
  });

  it("blocks active access purchase, but permits a deliberate new top-up after settlement", async () => {
    seedUser(true); const f = fixture();
    await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "pro", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "access-key", now: NOW }, fetcher(f)))
      .rejects.toMatchObject({ code: "ACTIVE_ACCESS_EXISTS" });
    const first = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "topup-one", now: NOW }, fetcher(f));
    db.prepare("UPDATE mkl_purchase_intents SET status='reconciled' WHERE id=?").run(first.intent.purchaseId);
    const second = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "topup-two", now: NOW + 1 }, fetcher(f));
    expect(second.intent.purchaseId).not.toBe(first.intent.purchaseId);
  });

  it("binds purchase authorization state to user, session, browser, purchase and one-time consumption", async () => {
    const rows = new Map<string, { value: string; expiresAt: Date }>(); const adapter = { async createVerificationValue(row: { identifier: string; value: string; expiresAt: Date }) { rows.set(row.identifier, row); },
      async consumeVerificationValue(identifier: string) { const row = rows.get(identifier) ?? null; rows.delete(identifier); return row && row.expiresAt > new Date() ? row : null; } };
    const oidc: MklConfig = { issuer: config.issuer, clientId: config.clientId, clientSecret: "sso-secret", appOrigin: "https://tulis.test", redirectUri: "https://tulis.test/api/auth/mkl/callback" };
    const flow = await createAuthorizationState(adapter, oidc, { intent: "purchase", browser: "browser", userId: "u", sessionId: "session", purchaseId: crypto.randomUUID(), returnTo: "/app" });
    await expect(consumeAuthorizationState(adapter, flow.state)).resolves.toMatchObject({ intent: "purchase", userId: "u", sessionId: "session" });
    await expect(consumeAuthorizationState(adapter, flow.state)).resolves.toBeNull();
  });

  it("does not add token, authorization code, PKCE, price authority or provider fields to intent storage", () => {
    const columns = (db.prepare("PRAGMA table_info(mkl_purchase_intents)").all() as Array<{ name: string }>).map((row) => row.name);
    expect(columns.some((name) => /id_token|auth.*code|pkce|server_key|midtrans|invoice|journal/i.test(name))).toBe(false);
    expect(columns).not.toContain("price_idr");
  });
});

describe("B5 checkout, recovery and fulfillment", () => {
  it("creates one checkout from fresh identity facts and sends no price, quantity, entitlement or paid state", async () => {
    seedUser(true); const f = fixture();
    const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "checkout-key", now: NOW }, fetcher(f));
    await assertPurchaseAuthorizationStart("u", created.intent.purchaseId, NOW);
    const result = await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "ephemeral-id-token", now: NOW }, fetcher(f));
    expect(result.redirectUrl).toBe("https://mkl.test/pembayaran/order-1"); expect(f.checkoutCalls).toBe(1);
    expect(f.checkoutBodies[0]).toEqual({ id_token: "ephemeral-id-token", offer_id: "offer-topup_100k", buyer_name: identity.name, buyer_email: identity.email, buyer_phone: "0800", return_uri: config.returnUri });
    const persisted = JSON.stringify(db.prepare("SELECT * FROM mkl_purchase_intents").all());
    expect(persisted).not.toContain("ephemeral-id-token"); expect(persisted).not.toContain(config.secret);
  });

  it("two authorization callbacks converge on the stable order and never bind a second order", async () => {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "callback-race", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token-1", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token-2", now: NOW + 1 }, fetcher(f));
    expect(db.prepare("SELECT COUNT(*) AS n,MAX(mkl_order_id) AS order_id FROM mkl_purchase_intents").get()).toEqual({ n: 1, order_id: "order-1" });
    expect(f.checkoutCalls).toBe(1);
  });

  it("terminalizes a drifted pre-checkout offer and permits a deliberate replacement intent", async () => {
    seedUser(true); const f = fixture(); const first = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "drift-one", now: NOW }, fetcher(f));
    f.offers = f.offers.map((item) => (item as { plan_code?: string }).plan_code === "topup_15k" ? { ...(item as object), name: "Changed after intent" } : item);
    await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: first.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f))).rejects.toMatchObject({ code: "OFFER_CHANGED" });
    expect((await getPurchaseIntent("u", first.intent.purchaseId)).status).toBe("terminal");
    await expect(createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "drift-two", now: NOW + 1 }, fetcher(f))).resolves.toMatchObject({ created: true });
  });

  it("rejects wrong subject and organization before checkout", async () => {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "identity-check", now: NOW }, fetcher(f));
    await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity: { ...identity, subject: "other" }, idToken: "token", now: NOW }, fetcher(f)))
      .rejects.toMatchObject({ code: "PURCHASE_IDENTITY_MISMATCH" });
    await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity: { ...identity, organizationId: "other" }, idToken: "token", now: NOW }, fetcher(f)))
      .rejects.toMatchObject({ code: "PURCHASE_IDENTITY_MISMATCH" });
    expect(f.checkoutCalls).toBe(0);
  });

  it("browser/order recovery grants nothing while pending and terminalizes failed/expired/cancelled orders", async () => {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "recover-pending", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f));
    expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f))).outcome).toBe("pending");
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_purchased_lots").get()).toEqual({ n: 0 });
    f.order = order("expired");
    expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW + 1 }, fetcher(f))).outcome).toBe("terminal");
  });

  it("retains exact authoritative expiry and maps code/version—not price—to one purchased lot", async () => {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "paid-topup", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f));
    f.order = order("paid"); f.purchase = purchase();
    const recovered = await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW + 1 }, fetcher(f));
    expect(recovered.outcome).toBe("reconciled");
    expect(db.prepare("SELECT fulfillment_id,original_amount,fulfilled_at,expires_at,verification_revision FROM character_purchased_lots").get())
      .toEqual({ fulfillment_id: "fulfillment-1", original_amount: 100000, fulfilled_at: iso(NOW), expires_at: iso(Date.parse("2027-09-21T08:00:00.000Z")), verification_revision: "1" });
  });

  it("two recovery workers and repeated refreshes do not double-grant", async () => {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "recovery-race", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f)); f.order = order("paid");
    await Promise.all([recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW + 1 }, fetcher(f)), recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW + 2 }, fetcher(f))]);
    await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW + 3 }, fetcher(f));
    expect(db.prepare("SELECT COUNT(*) AS n,SUM(original_amount) AS amount FROM character_purchased_lots").get()).toEqual({ n: 1, amount: 100000 });
  });

  it("fails closed on wrong code/version/application and on incomplete correction authority", async () => {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "bad-authority", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f)); f.order = order("paid");
    f.purchase = purchase({ plan_version: "wrong" });
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_PROVENANCE_MISMATCH" });
    f.purchase = purchase({ application: { client_id: "other", app_key: config.appKey, catalog_item_id: config.catalogItemId } });
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_PROVENANCE_MISMATCH" });
    f.purchase = purchase({ corrections_complete: false });
    expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f))).outcome).toBe("reconciliation_required");
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_purchased_lots").get()).toEqual({ n: 0 });
  });

  it("rejects disagreement between authoritative order gross and frozen purchase price", async () => {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "price-conflict", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f));
    f.order = { ...order("paid"), gross_idr: 98_000 };
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_ORDER_CONFLICT" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_purchased_lots").get()).toEqual({ n: 0 });
  });

  it("paid access requires a fresh B3 reconciliation and its replay issues one included grant", async () => {
    seedUser(false); const f = fixture(); f.entitlement = authority([], 1);
    const created = await createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "plus", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "access-paid", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "before-payment", now: NOW }, fetcher(f));
    f.order = { ...order("paid"), gross_idr: 49_000 }; f.purchase = purchase({ plan_code: "plus", commercial_kind: "access", offer_id: "offer-plus", price_idr_snapshot: 49_000, fulfillment_id: null, fulfilled_at: null,
      consumable_expires_at: null, consumable_validity_unit: null, consumable_validity_count: null, requires_active_access: false, purchase_revision: 0, corrections_complete: false });
    expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f))).outcome).toBe("authorization_required");
    f.entitlement = authority([activeCandidate()], 2);
    expect((await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "after-payment", now: NOW }, fetcher(f))).intent.status).toBe("reconciled");
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "replay", now: NOW + 1 }, fetcher(f));
    expect(db.prepare("SELECT COUNT(*) AS n,MAX(original_amount) AS amount FROM character_grants WHERE kind='included'").get()).toEqual({ n: 1, amount: 25000 });
  });
});

describe("B5 ordered corrections and wallet fencing", () => {
  async function paidLot() {
    seedUser(true); const f = fixture(); const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "correction-lot", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f)); f.order = order("paid");
    await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f));
    return { f, id: created.intent.purchaseId };
  }

  it("full reversal preserves consumed characters, revokes remainder, releases holds, and replays once", async () => {
    const { f, id } = await paidLot(); const lotId = String(db.prepare("SELECT id FROM character_purchased_lots").get()!.id);
    db.prepare("UPDATE character_purchased_lots SET settled_amount=40000 WHERE id=?").run(lotId);
    db.prepare("UPDATE character_grants SET settled_amount=original_amount WHERE owner_id='u' AND kind='included'").run();
    const held = await reserveCharacters({ ownerId: "u", idempotencyKey: "held", fingerprint: "held", operation: "generate", sourceCharacters: 1000, now: NOW + 10 });
    f.purchase = purchase({ purchase_revision: 2, corrections: [{ correction_id: "correction-1", revision: 2, kind: "reversal", final_state: "reversed", amount_idr: 99_000, cumulative_refunded_idr: 99_000, corrected_at: iso(NOW + 20) }] });
    await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 20 }, fetcher(f));
    await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 21 }, fetcher(f));
    expect(db.prepare("SELECT settled_amount,reserved_amount,state,reversal_state FROM character_purchased_lots WHERE id=?").get(lotId)).toEqual({ settled_amount: 40000, reserved_amount: 0, state: "reversed", reversal_state: "reversed" });
    expect(db.prepare("SELECT state FROM character_reservations WHERE id=?").get(held.reservation.id)).toEqual({ state: "released" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_lot_corrections").get()).toEqual({ n: 1 });
    expect((await walletSummary("u", NOW + 30)).purchased.available).toBe(0);
  });

  it("rejects stale and same-revision conflicting purchase authority", async () => {
    const { f, id } = await paidLot();
    f.purchase = purchase({ purchase_revision: 2, corrections: [{ correction_id: "partial", revision: 2, kind: "refund", final_state: "partially_refunded", amount_idr: 10_000, cumulative_refunded_idr: 10_000, corrected_at: iso(NOW + 1) }] });
    await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f));
    f.purchase = purchase();
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 2 }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_REVISION_STALE" });
    f.purchase = purchase({ purchase_revision: 2, corrections: [{ correction_id: "other", revision: 2, kind: "refund", final_state: "partially_refunded", amount_idr: 20_000, cumulative_refunded_idr: 20_000, corrected_at: iso(NOW + 2) }] });
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 3 }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_REVISION_CONFLICT" });
  });

  it("fences an existing lot when correction completeness disappears and restores only after complete authority returns", async () => {
    const { f, id } = await paidLot(); f.purchase = purchase({ corrections_complete: false });
    expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f))).outcome).toBe("reconciliation_required");
    expect(db.prepare("SELECT state,reversal_state FROM character_purchased_lots").get()).toEqual({ state: "reconciliation_required", reversal_state: "reconciliation_required" });
    f.purchase = purchase();
    expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 2 }, fetcher(f))).outcome).toBe("reconciled");
    expect(db.prepare("SELECT state,reversal_state,expires_at FROM character_purchased_lots").get()).toEqual({ state: "frozen", reversal_state: "none", expires_at: iso(Date.parse("2027-09-21T08:00:00.000Z")) });
  });

  it("fences a previously spendable lot on same-revision inconsistency", async () => {
    const { f, id } = await paidLot();
    f.purchase = purchase({ consumable_expires_at: iso(Date.parse("2027-10-21T08:00:00.000Z")) });
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_REVISION_CONFLICT" });
    expect(db.prepare("SELECT state,reversal_state FROM character_purchased_lots").get()).toEqual({ state: "reconciliation_required", reversal_state: "reconciliation_required" });
  });

  it("lets a new deliberate top-up exist while an older settled lot awaits correction reconciliation", async () => {
    const { f, id } = await paidLot(); f.purchase = purchase({ corrections_complete: false });
    await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f));
    await expect(createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_45k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "next-topup", now: NOW + 2 }, fetcher(f)))
      .resolves.toMatchObject({ created: true });
  });

  it("rejects non-contiguous MKL corrections before touching B4", async () => {
    const bad = purchase({ purchase_revision: 3, corrections: [{ correction_id: "skip", revision: 3, kind: "reversal", final_state: "reversed", amount_idr: 1, cumulative_refunded_idr: 1, corrected_at: iso(NOW) }] });
    await expect(readPurchase(commerceConfig(state.env), "order-1", async () => Response.json(bad))).rejects.toMatchObject({ code: "MKL_CORRECTION_SEQUENCE_INVALID" });
  });

  it("rejects duplicate correction identity and inconsistent cumulative amounts", async () => {
    const duplicate = purchase({ purchase_revision: 3, corrections: [
      { correction_id: "same", revision: 2, kind: "refund", final_state: "partially_refunded", amount_idr: 10_000, cumulative_refunded_idr: 10_000, corrected_at: iso(NOW) },
      { correction_id: "same", revision: 3, kind: "refund", final_state: "partially_refunded", amount_idr: 10_000, cumulative_refunded_idr: 20_000, corrected_at: iso(NOW + 1) },
    ] });
    await expect(readPurchase(commerceConfig(state.env), "order-1", async () => Response.json(duplicate))).rejects.toMatchObject({ code: "MKL_CORRECTION_SEQUENCE_INVALID" });
    const cumulative = purchase({ purchase_revision: 2, corrections: [
      { correction_id: "one", revision: 2, kind: "refund", final_state: "partially_refunded", amount_idr: 10_000, cumulative_refunded_idr: 20_000, corrected_at: iso(NOW) },
    ] });
    await expect(readPurchase(commerceConfig(state.env), "order-1", async () => Response.json(cumulative))).rejects.toMatchObject({ code: "MKL_CORRECTION_SEQUENCE_INVALID" });
  });
});
