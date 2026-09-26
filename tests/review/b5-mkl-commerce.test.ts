import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, migrationFiles } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, ConfigurationError: class extends Error {} }));

import { B5_PLAN_VERSION, CommerceError, assertCheckoutOpen, commerceConfig, discoverOffer, readPurchase } from "@/server/commerce/mkl-client";
import { refreshMklAuthority } from "@/server/entitlements/authority";
import { getMklLinkByUserId } from "@/server/identity/links";
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

const order = (status = "pending_payment") => ({ id: "order-1", order_number: "MKL-1", status, gross_idr: 99_000, paid_at: ["paid", "chargeback_pending", "charged_back", "disputed_review"].includes(status) ? iso(NOW) : null });
const purchase = (overrides: Record<string, unknown> = {}) => ({ order_id: "order-1", status: "paid", paid_at: iso(NOW), plan_code: "topup_100k", plan_version: B5_PLAN_VERSION,
  commercial_kind: "consumable", price_idr_snapshot: 99_000, offer_id: "offer-topup_100k",
  application: { client_id: config.clientId, app_key: config.appKey, catalog_item_id: config.catalogItemId },
  holder: { subject: identity.subject, organization_id: identity.organizationId }, fulfillment_id: "fulfillment-1", fulfilled_at: iso(NOW),
  consumable_expires_at: iso(Date.parse("2027-09-21T08:00:00.000Z")), consumable_validity_unit: "month", consumable_validity_count: 12,
  requires_active_access: true, purchase_revision: 1, corrections_complete: true, corrections: [], ...overrides });

const PAID_AT = iso(NOW - 1_000);
const paidAccessOrder = (status = "paid") => ({ id: "order-1", order_number: "MKL-1", status, gross_idr: 49_000, paid_at: PAID_AT });
const paidAccessPurchase = (overrides: Record<string, unknown> = {}) => purchase({ status: "paid", paid_at: PAID_AT, plan_code: "plus", commercial_kind: "access", offer_id: "offer-plus",
  price_idr_snapshot: 49_000, fulfillment_id: null, fulfilled_at: null, consumable_expires_at: null, consumable_validity_unit: null, consumable_validity_count: null,
  requires_active_access: false, purchase_revision: 0, corrections_complete: false, ...overrides });

type Fixture ={ offers: unknown[]; entitlement: unknown; order: Record<string, unknown>; purchase: Record<string, unknown>; checkoutCalls: number; checkoutBodies: unknown[] };
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
    MKL_APP_API_SECRET: config.secret, MKL_APP_KEY: config.appKey, MKL_CATALOG_ITEM_ID: config.catalogItemId, TULISAI_COMMERCE_CHECKOUT_ENABLED: "true" };
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

  it("never asks Workers for redirect: error, and never follows an MKL redirect", async () => {
    // workerd throws on redirect "error" ("must be one of follow or manual"), so the
    // only safe mode is "manual" with the redirect itself refused.
    const modes: Array<RequestRedirect | undefined> = [];
    const redirecting: typeof fetch = async (_input, init) => { modes.push(init?.redirect); return new Response(null, { status: 302, headers: { location: "https://elsewhere.test/offers" } }); };
    await expect(discoverOffer(commerceConfig(state.env), "plus", B5_PLAN_VERSION, redirecting)).rejects.toMatchObject({ code: "MKL_UNAVAILABLE", transport: true });
    expect(modes).toEqual(["manual"]);
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
    seedUser(false); const f = fixture(); f.entitlement = { ...authority([], 1), server_time: iso(NOW - 5_000) };
    const created = await createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "plus", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "access-paid", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "before-payment", now: NOW }, fetcher(f));
    f.order = paidAccessOrder(); f.purchase = paidAccessPurchase();
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
    f.purchase = purchase({ purchase_revision: 2, corrections: [{ correction_id: "correction-1", revision: 2, kind: "reversal", final_state: "reversed", amount_idr: 99_000, cumulative_refunded_idr: 0, corrected_at: iso(NOW + 20) }] });
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

describe("B5 hardening: final states, recovery classes, gate and offers", () => {
  const DAY = 86_400_000;
  const calls = (f: Fixture) => { const seen: string[] = []; const base = fetcher(f);
    return { seen, fetch: (async (input, init) => { seen.push(new URL(String(input)).pathname); return base(input, init); }) as typeof fetch }; };
  const withResponse = (f: Fixture, path: string, reply: () => Response | Promise<Response>): typeof fetch => {
    const base = fetcher(f); return async (input, init) => new URL(String(input)).pathname === path ? reply() : base(input, init);
  };
  const intentRow = (id: string) => db.prepare("SELECT status,order_status,last_error_code,terminal_reason,lot_id,purchase_revision FROM mkl_purchase_intents WHERE id=?").get(id) as Record<string, unknown>;
  const lotRow = () => db.prepare("SELECT state,reversal_state,original_amount,reserved_amount,settled_amount,expires_at FROM character_purchased_lots").get() as Record<string, unknown>;

  async function startAccess(f: Fixture, key = "access-intent", planCode = "plus") {
    const created = await createPurchaseIntent({ ownerId: "u", kind: "access", planCode, planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: key, now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "before-payment", now: NOW }, fetcher(f));
    return created.intent.purchaseId;
  }
  async function reconciledAccess() {
    seedUser(false); const f = fixture(); f.entitlement = { ...authority([], 1), server_time: iso(NOW - 5_000) };
    const id = await startAccess(f); f.order = paidAccessOrder(); f.purchase = paidAccessPurchase();
    f.entitlement = authority([activeCandidate({ period_start: PAID_AT })], 2);
    expect((await authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "after-payment", now: NOW }, fetcher(f))).intent.status).toBe("reconciled");
    return { f, id };
  }
  async function paidTopUp(key = "hardening-lot") {
    seedUser(true); const f = fixture();
    const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: key, now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f)); f.order = order("paid");
    expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f))).outcome).toBe("reconciled");
    return { f, id: created.intent.purchaseId };
  }

  describe("A. final access intents never regress", () => {
    it("repeated recovery, re-authorization and hostile MKL answers leave a reconciled access intent untouched", async () => {
      const { f, id } = await reconciledAccess(); const before = intentRow(id);
      for (const status of ["pending_payment", "expired", "chargeback_pending", "charged_back", "something_new"]) {
        f.order = paidAccessOrder(status); const probe = calls(f);
        const again = await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 10 }, probe.fetch);
        expect(again).toMatchObject({ outcome: "reconciled", intent: { status: "reconciled" } });
        expect(probe.seen).toEqual([]);
      }
      f.entitlement = authority([], 3);
      await authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "later", now: NOW + 20 }, fetcher(f));
      await expect(assertPurchaseAuthorizationStart("u", id, NOW + 21)).rejects.toMatchObject({ code: "PURCHASE_NOT_AUTHORIZABLE" });
      expect(intentRow(id)).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM character_grants WHERE kind='included'").get()).toEqual({ n: 1 });
    });

    it("keeps terminal intents terminal and makes no MKL call for them", async () => {
      seedUser(false); const f = fixture(); f.entitlement = authority([], 1); const id = await startAccess(f);
      f.order = order("expired");
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f))).outcome).toBe("terminal");
      f.order = paidAccessOrder(); const probe = calls(f);
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 2 }, probe.fetch)).outcome).toBe("terminal");
      expect(probe.seen).toEqual([]); expect(intentRow(id)).toMatchObject({ status: "terminal", terminal_reason: "expired" });
    });
  });

  describe("B. unresolved access intents become non-blocking once authority decides", () => {
    async function awaitingAccess(paidAt: string) {
      seedUser(false); const f = fixture(); f.entitlement = { ...authority([], 1), server_time: iso(Date.parse(paidAt) - 5_000) };
      const id = await startAccess(f); f.order = { ...paidAccessOrder(), paid_at: paidAt }; f.purchase = paidAccessPurchase({ paid_at: paidAt });
      // The only projection predates payment, so recovery cannot decide yet.
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW }, fetcher(f))).outcome).toBe("authorization_required");
      expect(intentRow(id)).toMatchObject({ status: "paid_awaiting_authority", last_error_code: "ACCESS_AUTHORITY_NOT_OBSERVED" });
      return { f, id };
    }

    it("terminalizes an access intent whose paid period has expired, then allows a later purchase", async () => {
      const paidAt = iso(NOW - 40 * DAY); const { f, id } = await awaitingAccess(paidAt);
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "pro", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "blocked-renewal", now: NOW }, fetcher(f)))
        .rejects.toMatchObject({ code: "PURCHASE_ALREADY_OPEN" });
      f.entitlement = authority([activeCandidate({ status: "expired", active: false, period_start: paidAt, period_end: iso(NOW - 10 * DAY), access_deadline: iso(NOW - 10 * DAY) })], 3);
      await authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "after-expiry", now: NOW + 1 }, fetcher(f));
      expect(intentRow(id)).toMatchObject({ status: "terminal", terminal_reason: "access_not_active_after_payment", order_status: "paid" });
      for (const at of [NOW + 2, NOW + 3]) expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: at }, fetcher(f))).outcome).toBe("terminal");
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "pro", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "renewal-after-expiry", now: NOW + 4 }, fetcher(f)))
        .resolves.toMatchObject({ created: true });
      expect(db.prepare("SELECT COUNT(*) AS n FROM mkl_purchase_intents WHERE owner_id='u'").get()).toEqual({ n: 2 });
    });

    it("a new purchase resolves the old intent from fresh post-payment authority without a purchase ceremony", async () => {
      const paidAt = iso(NOW - 40 * DAY); const { f, id } = await awaitingAccess(paidAt);
      f.entitlement = authority([], 4);
      await refreshMklAuthority("u", (await getMklLinkByUserId("u"))!, "ordinary-sign-in", fetcher(f));
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "plus", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "renewal-by-sign-in", now: NOW + 1 }, fetcher(f)))
        .resolves.toMatchObject({ created: true });
      expect(intentRow(id)).toMatchObject({ status: "terminal", terminal_reason: "access_not_active_after_payment" });
    });

    it("records superseded authority as terminal instead of attributing another plan", async () => {
      const { f, id } = await awaitingAccess(PAID_AT);
      f.entitlement = authority([activeCandidate({ plan_code: "pro", period_start: PAID_AT })], 3);
      await authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "superseded", now: NOW + 1 }, fetcher(f));
      expect(intentRow(id)).toMatchObject({ status: "terminal", terminal_reason: "access_superseded" });
    });

    it("moves a legacy reconciliation_required access intent out of the blocking set", async () => {
      const paidAt = iso(NOW - 40 * DAY); const { f, id } = await awaitingAccess(paidAt);
      db.prepare("UPDATE mkl_purchase_intents SET status='reconciliation_required' WHERE id=?").run(id);
      f.entitlement = authority([], 5);
      await authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "legacy", now: NOW + 1 }, fetcher(f));
      expect(intentRow(id)).toMatchObject({ status: "terminal", terminal_reason: "access_not_active_after_payment" });
    });

    it("terminalizes a charged-back access order", async () => {
      const { f, id } = await awaitingAccess(PAID_AT);
      f.order = paidAccessOrder("charged_back"); f.purchase = paidAccessPurchase({ status: "charged_back" });
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f))).outcome).toBe("terminal");
      expect(intentRow(id)).toMatchObject({ terminal_reason: "order_charged_back" });
    });

    it("does not decide from a same-instant projection", async () => {
      const { f, id } = await awaitingAccess(PAID_AT);
      f.entitlement = { ...authority([], 3), server_time: PAID_AT };
      await authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "same-ms", now: NOW + 1 }, fetcher(f));
      expect(intentRow(id)).toMatchObject({ status: "paid_awaiting_authority" });
    });
  });

  describe("C. order status handling", () => {
    it("reconciles chargeback_pending through purchase authority, fences the lot, and never reports pending payment", async () => {
      const { f, id } = await paidTopUp();
      f.order = order("chargeback_pending"); f.purchase = purchase({ status: "chargeback_pending", corrections_complete: false });
      for (const at of [NOW + 1, NOW + 2]) {
        const recovered = await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: at }, fetcher(f));
        expect(recovered).toMatchObject({ outcome: "reconciliation_required", intent: { status: "reconciliation_required", orderStatus: "chargeback_pending" } });
      }
      expect(lotRow()).toMatchObject({ state: "reconciliation_required", reversal_state: "reconciliation_required" });
      f.order = order("charged_back"); f.purchase = purchase({ status: "charged_back", purchase_revision: 2,
        corrections: [{ correction_id: "chargeback-1", revision: 2, kind: "reversal", final_state: "reversed", amount_idr: 99_000, cumulative_refunded_idr: 0, corrected_at: iso(NOW + 3) }] });
      for (const at of [NOW + 4, NOW + 5]) expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: at }, fetcher(f))).outcome).toBe("reconciled");
      expect(lotRow()).toMatchObject({ state: "reversed", reversal_state: "reversed", original_amount: 100_000 });
      expect(db.prepare("SELECT COUNT(*) AS lots FROM character_purchased_lots").get()).toEqual({ lots: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM character_lot_corrections").get()).toEqual({ n: 1 });
    });

    it("routes chargeback_pending on an unreconciled access order to authority, not pending payment", async () => {
      seedUser(false); const f = fixture(); f.entitlement = { ...authority([], 1), server_time: iso(NOW - 5_000) }; const id = await startAccess(f);
      f.order = paidAccessOrder("chargeback_pending"); f.purchase = paidAccessPurchase({ status: "chargeback_pending" });
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW }, fetcher(f))).intent.status).toBe("paid_awaiting_authority");
    });

    it("fails closed on an unsupported order status without touching state or wallet", async () => {
      const { f, id } = await paidTopUp(); const lot = lotRow();
      f.order = order("disputed_review");
      const recovered = await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f));
      expect(recovered.outcome).toBe("retry");
      expect(intentRow(id)).toMatchObject({ status: "reconciled", order_status: "disputed_review", last_error_code: "MKL_ORDER_STATUS_UNSUPPORTED" });
      expect(lotRow()).toEqual(lot);
    });

    it("treats a pending order after verified payment as contradictory authority, never as pending", async () => {
      const { f, id } = await paidTopUp(); f.order = order("pending_payment");
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f))).outcome).toBe("reconciliation_required");
      expect(intentRow(id)).toMatchObject({ status: "reconciliation_required", last_error_code: "ORDER_STATUS_CONTRADICTS_PAYMENT" });
      expect(lotRow()).toMatchObject({ reversal_state: "reconciliation_required" });
    });
  });

  describe("D. transport failures never change wallet authority", () => {
    const failures: [string, () => Response | Promise<Response>][] = [
      ["network failure", () => { throw new TypeError("fetch failed"); }],
      ["500", () => Response.json({ error: "internal_error" }, { status: 500 })],
      ["503 without JSON", () => new Response("<html>bad gateway</html>", { status: 503 })],
      ["401", () => Response.json({ error: "invalid_client_credentials" }, { status: 401 })],
      ["403", () => Response.json({ error: "app_commerce_disabled" }, { status: 403 })],
      ["429", () => Response.json({ error: "rate_limited" }, { status: 429 })],
      ["2xx without JSON", () => new Response("<html>edge</html>", { status: 200 })],
    ];
    for (const path of ["/app/v1/orders", "/app/v1/purchases"]) {
      it.each(failures)(`leaves a healthy lot and its holds alone on ${path} %s`, async (_label, reply) => {
        const { f, id } = await paidTopUp();
        db.prepare("UPDATE character_grants SET settled_amount=original_amount WHERE owner_id='u' AND kind='included'").run();
        const held = await reserveCharacters({ ownerId: "u", idempotencyKey: "held-transport", fingerprint: "held-transport", operation: "generate", sourceCharacters: 1000, now: NOW + 10 });
        const lot = lotRow(); const intent = intentRow(id);
        const recovered = await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 11 }, withResponse(f, path, reply));
        expect(recovered.outcome).toBe("retry");
        expect(lotRow()).toEqual(lot);
        expect(db.prepare("SELECT state FROM character_reservations WHERE id=?").get(held.reservation.id)).toEqual({ state: "reserved" });
        expect({ ...intentRow(id), last_error_code: null }).toEqual({ ...intent, last_error_code: null });
        expect(String(intentRow(id).last_error_code)).toMatch(/^MKL_/);
        // Authority returns: still exactly one lot and nothing reversed.
        expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 12 }, fetcher(f))).outcome).toBe("reconciled");
        expect(db.prepare("SELECT COUNT(*) AS n,SUM(original_amount) AS amount FROM character_purchased_lots").get()).toEqual({ n: 1, amount: 100_000 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM character_lot_corrections").get()).toEqual({ n: 0 });
      });
    }

    it("a transient failure before first fulfillment grants nothing and later fulfills exactly once", async () => {
      seedUser(true); const f = fixture();
      const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_15k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "first-fulfil", now: NOW }, fetcher(f));
      await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f));
      f.order = { ...order("paid"), gross_idr: 19_000 }; f.purchase = purchase({ plan_code: "topup_15k", offer_id: "offer-topup_15k", price_idr_snapshot: 19_000 });
      const flaky = withResponse(f, "/app/v1/purchases", () => Response.json({ error: "internal_error" }, { status: 502 }));
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW + 1 }, flaky)).outcome).toBe("retry");
      expect(intentRow(created.intent.purchaseId)).toMatchObject({ status: "pending_payment", lot_id: null });
      for (const at of [NOW + 2, NOW + 3]) await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: at }, fetcher(f));
      expect(db.prepare("SELECT COUNT(*) AS n,SUM(original_amount) AS amount FROM character_purchased_lots").get()).toEqual({ n: 1, amount: 15_000 });
    });

    it("still fences on received contradictory authority", async () => {
      const { f, id } = await paidTopUp(); f.purchase = purchase({ holder: { subject: "someone-else", organization_id: identity.organizationId } });
      await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 1 }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_PROVENANCE_MISMATCH" });
      expect(lotRow()).toMatchObject({ reversal_state: "reconciliation_required" });
    });
  });

  describe("G. stale unbound intents and checkout ambiguity", () => {
    async function createdAccess(f: Fixture, key = "unbound-access", planCode = "plus") {
      return (await createPurchaseIntent({ ownerId: "u", kind: "access", planCode, planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: key, now: NOW }, fetcher(f))).intent.purchaseId;
    }

    it("closes an intent whose offer disappeared and allows a new valid purchase", async () => {
      seedUser(false); const f = fixture(); f.entitlement = authority([], 1); const id = await createdAccess(f);
      f.offers = f.offers.filter((o) => (o as { plan_code: string }).plan_code !== "plus");
      await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "t", now: NOW }, fetcher(f))).rejects.toMatchObject({ code: "OFFER_NOT_AVAILABLE" });
      expect(intentRow(id)).toMatchObject({ status: "terminal", terminal_reason: "offer_unavailable" });
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "pro", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "after-removal", now: NOW }, fetcher(f)))
        .resolves.toMatchObject({ created: true });
      expect(f.checkoutCalls).toBe(0);
    });

    it("closes an intent whose locked offer was repriced, and refuses new intents for the repriced offer", async () => {
      seedUser(false); const f = fixture(); f.entitlement = authority([], 1); const id = await createdAccess(f);
      f.offers = f.offers.map((o) => (o as { plan_code: string }).plan_code === "plus" ? offer("plus", { price_idr: 59_000 }) : o);
      await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "t", now: NOW }, fetcher(f))).rejects.toMatchObject({ code: "OFFER_CONTRACT_MISMATCH" });
      expect(intentRow(id)).toMatchObject({ status: "terminal", terminal_reason: "offer_contract_mismatch" });
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "plus", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "repriced-plus", now: NOW }, fetcher(f)))
        .rejects.toMatchObject({ code: "OFFER_CONTRACT_MISMATCH" });
      expect(f.checkoutCalls).toBe(0);
    });

    it("keeps an unbound intent open when offer discovery merely fails transiently", async () => {
      seedUser(false); const f = fixture(); f.entitlement = authority([], 1); const id = await createdAccess(f);
      await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "t", now: NOW },
        withResponse(f, "/app/v1/offers", () => Response.json({ error: "internal_error" }, { status: 500 })))).rejects.toMatchObject({ transport: true });
      expect(intentRow(id)).toMatchObject({ status: "created" });
    });

    it("a deliberate new intent supersedes an unbound created intent without deleting it", async () => {
      seedUser(false); const f = fixture(); f.entitlement = authority([], 1); const first = await createdAccess(f, "first-unbound");
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "pro", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "second-choice", now: NOW + 1 }, fetcher(f)))
        .resolves.toMatchObject({ created: true });
      expect(intentRow(first)).toMatchObject({ status: "terminal", terminal_reason: "superseded_by_new_intent" });
    });

    it("an ambiguous checkout failure keeps the stable key pending; a definitive refusal returns to created", async () => {
      seedUser(false); const f = fixture(); f.entitlement = authority([], 1); const id = await createdAccess(f);
      await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "t", now: NOW },
        withResponse(f, "/app/v1/checkout", () => Response.json({ error: "internal_error" }, { status: 502 })))).rejects.toMatchObject({ transport: true });
      expect(intentRow(id)).toMatchObject({ status: "checkout_pending" });
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "pro", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "while-ambiguous", now: NOW }, fetcher(f)))
        .rejects.toMatchObject({ code: "PURCHASE_ALREADY_OPEN" });
      await authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "t2", now: NOW + 1 }, fetcher(f));
      expect(intentRow(id)).toMatchObject({ status: "pending_payment" });
      expect(f.checkoutBodies).toHaveLength(1);

      db.prepare("DELETE FROM mkl_purchase_intents").run(); const second = await createdAccess(f, "definitive-refusal");
      await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: second, identity, idToken: "t3", now: NOW + 2 },
        withResponse(f, "/app/v1/checkout", () => Response.json({ error: "buyer_email_mismatch" }, { status: 400 })))).rejects.toMatchObject({ code: "MKL_BUYER_EMAIL_MISMATCH" });
      expect(intentRow(second)).toMatchObject({ status: "created", last_error_code: "MKL_BUYER_EMAIL_MISMATCH" });
    });
  });

  describe("offer discovery", () => {
    it("ignores unrelated, unplanned, other-version and malformed catalog entries", async () => {
      const f = fixture();
      f.offers.push({ offer_id: "legacy", name: "Legacy", type: "one_time", price_idr: 10_000, catalog_item_id: config.catalogItemId, catalog_title: "TulisAI", plan_code: null, plan_version: null, term_unit: null, term_count: null });
      f.offers.push(offer("team", { price_idr: 1 }), offer("plus", { plan_version: "pricing-v2", price_idr: 59_000 }), "garbage", null);
      f.offers.push({ offer_id: "mr", plan_code: "starter", plan_version: "pricing-v3", price_idr: 19_000 });
      for (const code of ["plus", "topup_15k"]) await expect(discoverOffer(commerceConfig(state.env), code, B5_PLAN_VERSION, fetcher(f))).resolves.toMatchObject({ planCode: code });
    });

    it("still fails closed when the TulisAI offer itself breaks the locked contract", async () => {
      const f = fixture(); f.offers = [offer("topup_45k", { price_idr: 45_000 })];
      await expect(discoverOffer(commerceConfig(state.env), "topup_45k", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "OFFER_CONTRACT_MISMATCH" });
      f.offers = [offer("plus", { consumable_validity_unit: undefined })];
      await expect(discoverOffer(commerceConfig(state.env), "plus", B5_PLAN_VERSION, fetcher(f))).rejects.toMatchObject({ code: "MKL_RESPONSE_INVALID" });
    });
  });

  describe("local commerce gate", () => {
    it("is closed unless explicitly true", () => {
      for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
        state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = value;
        expect(() => assertCheckoutOpen(state.env)).toThrowError(CommerceError);
      }
    });

    it("blocks new intents and new checkout only", async () => {
      seedUser(false); const f = fixture(); f.entitlement = authority([], 1);
      const id = (await createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "plus", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "made-while-open", now: NOW }, fetcher(f))).intent.purchaseId;
      state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = "false";
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "pro", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "made-while-closed", now: NOW }, fetcher(f)))
        .rejects.toMatchObject({ code: "COMMERCE_CHECKOUT_CLOSED" });
      await expect(createPurchaseIntent({ ownerId: "u", kind: "access", planCode: "plus", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "made-while-open", now: NOW }, fetcher(f)))
        .resolves.toMatchObject({ created: false });
      await expect(assertPurchaseAuthorizationStart("u", id, NOW)).rejects.toMatchObject({ code: "COMMERCE_CHECKOUT_CLOSED" });
      await expect(authorizePurchaseIntent({ ownerId: "u", purchaseId: id, identity, idToken: "t", now: NOW }, fetcher(f))).rejects.toMatchObject({ code: "COMMERCE_CHECKOUT_CLOSED" });
      expect(f.checkoutCalls).toBe(0); expect(intentRow(id)).toMatchObject({ status: "created" });
    });

    it("keeps recovery, access reconciliation and correction application live while closed", async () => {
      const { f, id } = await paidTopUp("gate-lot");
      state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = "false";
      const projectionBefore = db.prepare("SELECT * FROM mkl_entitlement_projection").get();
      f.purchase = purchase({ purchase_revision: 2, corrections: [{ correction_id: "closed-refund", revision: 2, kind: "refund", final_state: "partially_refunded", amount_idr: 10_000, cumulative_refunded_idr: 10_000, corrected_at: iso(NOW + 1) }] });
      expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 2 }, fetcher(f))).outcome).toBe("reconciled");
      expect(lotRow()).toMatchObject({ state: "reversed", reversal_state: "partially_refunded" });
      expect(db.prepare("SELECT * FROM mkl_entitlement_projection").get()).toEqual(projectionBefore);

      db.close(); db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db);
      state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = "true";
      seedUser(false); const g = fixture(); g.entitlement = { ...authority([], 1), server_time: iso(NOW - 5_000) }; const access = await startAccess(g, "gate-access");
      state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = "false";
      g.order = paidAccessOrder(); g.purchase = paidAccessPurchase(); g.entitlement = authority([activeCandidate({ period_start: PAID_AT })], 2);
      await expect(assertPurchaseAuthorizationStart("u", access, NOW)).resolves.toMatchObject({ id: access });
      expect((await authorizePurchaseIntent({ ownerId: "u", purchaseId: access, identity, idToken: "closed-reconcile", now: NOW }, fetcher(g))).intent.status).toBe("reconciled");
      expect(g.checkoutCalls).toBe(1);
    });
  });
});

describe("B5 correction arithmetic aligned with MKL PR #22", () => {
  type Correction = { correction_id: string; revision: number; kind: "refund" | "reversal"; final_state: "partially_refunded" | "reversed";
    amount_idr: number; cumulative_refunded_idr: number; corrected_at: string };
  const refund = (revision: number, amount: number, cumulative: number, id = `refund-${revision}`, at = iso(NOW + revision)): Correction => ({
    correction_id: id, revision, kind: "refund", final_state: cumulative >= 99_000 ? "reversed" : "partially_refunded",
    amount_idr: amount, cumulative_refunded_idr: cumulative, corrected_at: at });
  const chargeback = (revision: number, amount: number, cumulative: number, at = iso(NOW)): Correction => ({
    correction_id: "chargeback:order-1", revision, kind: "reversal", final_state: "reversed",
    amount_idr: amount, cumulative_refunded_idr: cumulative, corrected_at: at });
  const envelope = (corrections: Correction[], status = "paid") => purchase({ status, purchase_revision: 1 + corrections.length, corrections });
  const read = (body: unknown) => readPurchase(commerceConfig(state.env), "order-1", async () => Response.json(body));
  const lot = () => db.prepare("SELECT state,reversal_state,original_amount,reserved_amount,settled_amount FROM character_purchased_lots").get() as Record<string, unknown>;
  const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

  async function spentLotWithHold() {
    seedUser(true); const f = fixture();
    const created = await createPurchaseIntent({ ownerId: "u", kind: "consumable", planCode: "topup_100k", planVersion: B5_PLAN_VERSION, buyerPhone: "0800", clientRequestKey: "arith-lot", now: NOW }, fetcher(f));
    await authorizePurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, identity, idToken: "token", now: NOW }, fetcher(f)); f.order = order("paid");
    await recoverPurchaseIntent({ ownerId: "u", purchaseId: created.intent.purchaseId, now: NOW }, fetcher(f));
    const lotId = String((db.prepare("SELECT id FROM character_purchased_lots").get() as { id: string }).id);
    db.prepare("UPDATE character_purchased_lots SET settled_amount=40000 WHERE id=?").run(lotId);
    db.prepare("UPDATE character_grants SET settled_amount=original_amount WHERE owner_id='u' AND kind='included'").run();
    const held = await reserveCharacters({ ownerId: "u", idempotencyKey: "arith-held", fingerprint: "arith-held", operation: "generate", sourceCharacters: 1000, now: NOW + 10 });
    return { f, id: created.intent.purchaseId, lotId, holdId: held.reservation.id };
  }
  async function recoverTwice(f: Fixture, id: string, at: number) {
    for (const now of [at, at + 1]) expect((await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now }, fetcher(f))).outcome).toBe("reconciled");
  }
  function assertReversedWithoutDebt(holdId: string) {
    expect(lot()).toMatchObject({ state: "reversed", reversal_state: "reversed", original_amount: 100_000, settled_amount: 40_000, reserved_amount: 0 });
    expect(db.prepare("SELECT state FROM character_reservations WHERE id=?").get(holdId)).toEqual({ state: "released" });
  }

  it("accepts a clean chargeback with no prior refunds: full amount, zero cumulative refunds", async () => {
    await expect(read(envelope([chargeback(2, 99_000, 0)], "charged_back"))).resolves.toMatchObject({ corrections: [{ amountIdr: 99_000, cumulativeRefundedIdr: 0, kind: "reversal" }] });
    const { f, id, holdId } = await spentLotWithHold();
    f.order = order("charged_back"); f.purchase = envelope([chargeback(2, 99_000, 0)], "charged_back");
    await recoverTwice(f, id, NOW + 20);
    assertReversedWithoutDebt(holdId);
    expect(count("SELECT COUNT(*) AS n FROM character_lot_corrections")).toBe(1);
    expect((await walletSummary("u", NOW + 30)).purchased.available).toBe(0);
  });

  it("accepts a chargeback after a partial refund, even when its corrected_at predates the refund", async () => {
    const history = [refund(2, 10_000, 10_000), chargeback(3, 89_000, 10_000, iso(NOW - 5_000))];
    await expect(read(envelope(history, "charged_back"))).resolves.toMatchObject({ purchaseRevision: 3 });
    const { f, id, holdId } = await spentLotWithHold();
    f.order = order("paid"); f.purchase = envelope([history[0]!]);
    await recoverTwice(f, id, NOW + 20);
    expect(lot()).toMatchObject({ state: "reversed", reversal_state: "partially_refunded", settled_amount: 40_000 });
    f.order = order("charged_back"); f.purchase = envelope(history, "charged_back");
    await recoverTwice(f, id, NOW + 30);
    assertReversedWithoutDebt(holdId);
    expect(count("SELECT COUNT(*) AS n FROM character_lot_corrections")).toBe(2);
  });

  it("accepts a zero-amount chargeback when refunds already reserve the outstanding gross, and a later refund cannot downgrade it", async () => {
    await expect(read(envelope([chargeback(2, 0, 0)], "charged_back"))).resolves.toMatchObject({ corrections: [{ amountIdr: 0, cumulativeRefundedIdr: 0 }] });
    const { f, id, holdId } = await spentLotWithHold();
    f.order = order("charged_back"); f.purchase = envelope([chargeback(2, 0, 0)], "charged_back");
    await recoverTwice(f, id, NOW + 20);
    assertReversedWithoutDebt(holdId);
    // The reserved refund completes later as the next revision.
    f.purchase = envelope([chargeback(2, 0, 0), refund(3, 30_000, 30_000)], "charged_back");
    await recoverTwice(f, id, NOW + 30);
    assertReversedWithoutDebt(holdId);
    expect(count("SELECT COUNT(*) AS n FROM character_lot_corrections")).toBe(2);
  });

  it("validates completed refund arithmetic and final state from the cumulative total", async () => {
    await expect(read(envelope([refund(2, 10_000, 10_000), refund(3, 20_000, 30_000), refund(4, 69_000, 99_000)]))).resolves.toMatchObject({ purchaseRevision: 4 });
    const wrongState = { ...refund(2, 10_000, 10_000), final_state: "reversed" as const };
    const earlyPartial = { ...refund(2, 99_000, 99_000), final_state: "partially_refunded" as const };
    for (const history of [[wrongState], [earlyPartial], [refund(2, 99_001, 99_001)], [refund(2, 60_000, 60_000), refund(3, 40_000, 100_000)]]) {
      await expect(read(envelope(history))).rejects.toMatchObject({ code: "MKL_CORRECTION_SEQUENCE_INVALID" });
    }
  });

  it("rejects malformed cumulative progression and leaves the lot fenced, not corrected", async () => {
    const malformed: Correction[][] = [
      [refund(2, 10_000, 20_000)],
      [refund(2, 10_000, 10_000), refund(3, 10_000, 10_000)],
      // The pre-alignment TulisAI assumption: reversal cumulative equals price.
      [chargeback(2, 99_000, 99_000)],
      [refund(2, 10_000, 10_000), chargeback(3, 89_000, 0)],
      [refund(2, 10_000, 10_000), chargeback(3, 99_000, 10_000)],
      [chargeback(2, 99_000, 0), refund(3, 10_000, 10_000)],
      [chargeback(2, 99_000, 0), { ...chargeback(3, 0, 0), correction_id: "chargeback:again" }],
      [{ ...chargeback(2, 99_000, 0), final_state: "partially_refunded" as const }],
      [{ ...refund(2, -1, -1) }],
    ];
    for (const history of malformed) await expect(read(envelope(history))).rejects.toMatchObject({ code: expect.stringMatching(/^MKL_(CORRECTION_SEQUENCE|RESPONSE)_INVALID$/) });
    const { f, id } = await spentLotWithHold();
    f.order = order("charged_back"); f.purchase = envelope([chargeback(2, 99_000, 99_000)], "charged_back");
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 20 }, fetcher(f))).rejects.toMatchObject({ code: "MKL_CORRECTION_SEQUENCE_INVALID" });
    expect(lot()).toMatchObject({ state: "reconciliation_required", reversal_state: "reconciliation_required", settled_amount: 40_000 });
    expect(count("SELECT COUNT(*) AS n FROM character_lot_corrections")).toBe(0);
  });

  it("keeps replay inert across repeated recovery", async () => {
    const { f, id, holdId } = await spentLotWithHold();
    f.order = order("charged_back"); f.purchase = envelope([refund(2, 10_000, 10_000), chargeback(3, 89_000, 10_000)], "charged_back");
    await recoverTwice(f, id, NOW + 20);
    const events = count("SELECT COUNT(*) AS n FROM character_wallet_events");
    for (const at of [NOW + 30, NOW + 31, NOW + 32]) await recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: at }, fetcher(f));
    expect(count("SELECT COUNT(*) AS n FROM character_wallet_events")).toBe(events);
    expect(count("SELECT COUNT(*) AS n FROM character_lot_corrections")).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM character_purchased_lots")).toBe(1);
    assertReversedWithoutDebt(holdId);
  });

  it("rejects out-of-order revisions from MKL and stale envelopes after newer authority", async () => {
    const swapped = [{ ...refund(2, 10_000, 10_000), revision: 3 }, { ...chargeback(3, 89_000, 10_000), revision: 2 }];
    await expect(read({ ...envelope(swapped), purchase_revision: 3 })).rejects.toMatchObject({ code: "MKL_CORRECTION_SEQUENCE_INVALID" });
    const { f, id } = await spentLotWithHold();
    f.order = order("charged_back"); f.purchase = envelope([refund(2, 10_000, 10_000), chargeback(3, 89_000, 10_000)], "charged_back");
    await recoverTwice(f, id, NOW + 20);
    const before = lot();
    f.order = order("paid"); f.purchase = envelope([refund(2, 10_000, 10_000)]);
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 30 }, fetcher(f))).rejects.toMatchObject({ code: "PURCHASE_REVISION_STALE" });
    expect(lot()).toEqual(before);
  });

  it("fails closed when correction history conflicts with what was already applied", async () => {
    const { f, id } = await spentLotWithHold();
    f.order = order("paid"); f.purchase = envelope([refund(2, 10_000, 10_000)]);
    await recoverTwice(f, id, NOW + 20);
    // Same correction identity rewritten with different facts under a newer revision.
    f.order = order("charged_back"); f.purchase = envelope([refund(2, 20_000, 20_000, "refund-2"), chargeback(3, 79_000, 20_000)], "charged_back");
    await expect(recoverPurchaseIntent({ ownerId: "u", purchaseId: id, now: NOW + 30 }, fetcher(f))).rejects.toMatchObject({ code: "CORRECTION_CONFLICT" });
    expect(count("SELECT COUNT(*) AS n FROM character_lot_corrections")).toBe(1);
    expect(lot()).toMatchObject({ settled_amount: 40_000, reserved_amount: 0 });
    expect(db.prepare("SELECT status,last_error_code FROM mkl_purchase_intents WHERE id=?").get(id)).toEqual({ status: "reconciliation_required", last_error_code: "CORRECTION_CONFLICT" });
  });
});
