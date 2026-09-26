import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, ConfigurationError: class extends Error {} }));
vi.mock("@/components/app/AppShell", () => ({ useSessionGuard: () => () => false, useShell: () => ({ usage: null, refresh: async () => {} }) }));

import { commerceCatalog, type CatalogProduct } from "@/server/commerce/catalog";
import { B5_PLAN_VERSION, CommerceError, discoverOffer, discoverOffers, commerceConfig } from "@/server/commerce/mkl-client";
import { ApiError, errorText } from "@/lib/client/api";
import { blockedLabel, isSettledOutcome, outcomeNotice, phoneLooksValid, purchaseStatus, type OfferState, type RecoveryOutcome } from "@/lib/client/commerce";
import { BuyControl, CheckoutPanel, type Availability } from "@/components/app/PlansDialog";

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  async run() { const value = db.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(value.changes) } }; }
}
const d1 = () => ({ prepare: (sql: string) => new Statement(sql) });

const NOW = Date.now();
const iso = (value: number) => new Date(value).toISOString();
const config = { issuer: "https://mkl.test", clientId: "tulis-client", secret: "separate-app-secret", appKey: "tulisai", catalogItemId: "catalog-tulisai" };
const PRICES: Record<string, number> = { plus: 49_000, pro: 179_000, max: 499_000, topup_15k: 19_000, topup_45k: 49_000, topup_100k: 99_000 };
const offer = (planCode: string, overrides: Record<string, unknown> = {}) => {
  const consumable = planCode.startsWith("topup_");
  return { offer_id: `offer-${planCode}`, name: `Offer ${planCode}`, type: "one_time", price_idr: PRICES[planCode], catalog_item_id: config.catalogItemId,
    catalog_title: "TulisAI", plan_code: planCode, plan_version: B5_PLAN_VERSION, term_unit: consumable ? null : "month", term_count: consumable ? null : 1,
    commercial_kind: consumable ? "consumable" : "access", consumable_validity_unit: consumable ? "month" : null, consumable_validity_count: consumable ? 12 : null,
    requires_active_access: consumable, ...overrides };
};
const ALL = Object.keys(PRICES);

let offers: unknown[]; let offerCalls = 0; let unreachable = false;
const fetcher: typeof fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.pathname !== "/app/v1/offers") throw new Error(`unexpected ${url}`);
  offerCalls += 1; if (unreachable) throw new TypeError("network down");
  return Response.json({ offers });
};

function seedUser({ linked = true, paid = false } = {}) {
  db.prepare("INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES ('u','User','u@example.test','u','user','free',?,?)").run(NOW, NOW);
  if (!linked) return;
  db.prepare(`INSERT INTO external_identity_link (id,provider,issuer,subject,organization_id,user_id,profile_email,profile_name,link_method,created_at,updated_at,last_authenticated_at)
    VALUES ('link-u','mkl',?,'subject-u','org-u','u','u@example.test','User','mkl-sign-in',?,?,?)`).run(config.issuer, NOW, NOW, NOW);
  if (paid) db.prepare(`INSERT INTO mkl_entitlement_projection (user_id,identity_link_id,issuer,subject,organization_id,application_client_id,application_app_key,catalog_item_id,
    scope_revision,authority_payload_hash,entitlement_id,status,plan_code,plan_version,period_start,period_end,access_deadline,commercial_kind,entitlement_created_at,server_time,verified_at,fresh_until,invalidated_at,invalidation_reason,updated_at)
    VALUES ('u','link-u',?,'subject-u','org-u',?,?,?,1,'hash','ent-1','active','plus',?,?,?,?,'access',?,?,?,?,NULL,NULL,?)`).run(config.issuer, config.clientId, config.appKey, config.catalogItemId,
    B5_PLAN_VERSION, iso(NOW - 60_000), iso(NOW + 86_400_000), iso(NOW + 86_400_000), iso(NOW - 60_000), iso(NOW), NOW, NOW + 900_000, NOW);
}

function seedIntent(id: string, kind: "access" | "consumable", status: string, bound: boolean) {
  db.prepare(`INSERT INTO mkl_purchase_intents (id,owner_id,identity_link_id,organization_id,purchase_kind,plan_code,plan_version,offer_id,offer_contract_json,offer_contract_hash,
    client_request_key_hash,request_fingerprint,mkl_idempotency_key,buyer_phone,return_uri,mkl_order_id,mkl_order_number,checkout_url,order_bound_at,status,created_at,updated_at)
    VALUES (?,'u','link-u','org-u',?,?,?,'offer','{}','hash',?,'fingerprint',?,'0800','https://tulis.test/api/commerce/mkl/return',?,?,?,?,?,?,?)`)
    .run(id, kind, kind === "access" ? "pro" : "topup_15k", B5_PLAN_VERSION, `key-${id}`, `tulisai:${id}`,
      bound ? `order-${id}` : null, bound ? `MKL-${id}` : null, bound ? `${config.issuer}/pembayaran/order-${id}` : null, bound ? NOW : null, status, NOW, NOW);
}

const states = (products: CatalogProduct[]) => Object.fromEntries(products.map((product) => [product.planCode, product.state]));

beforeEach(() => {
  db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db);
  offers = ALL.map((code) => offer(code)); offerCalls = 0; unreachable = false;
  state.env = { DB: d1(), BETTER_AUTH_URL: "https://tulis.test", MKL_ISSUER: config.issuer, MKL_CLIENT_ID: config.clientId, MKL_APP_API_SECRET: config.secret,
    MKL_APP_KEY: config.appKey, MKL_CATALOG_ITEM_ID: config.catalogItemId, TULISAI_COMMERCE_CHECKOUT_ENABLED: "true" };
});
afterEach(() => db.close());

describe("B6 catalog: the server decides what can be bought", () => {
  it("says nothing is for sale while TulisAI's own checkout switch is closed, and never asks MKL", async () => {
    seedUser(); state.env.TULISAI_COMMERCE_CHECKOUT_ENABLED = "false";
    const catalog = await commerceCatalog("u", NOW, fetcher);
    expect(catalog.checkoutOpen).toBe(false);
    expect(new Set(catalog.products.map((product) => product.state))).toEqual(new Set(["checkout_closed"]));
    expect(catalog.products.map((product) => [product.planCode, product.priceIdr])).toEqual(ALL.map((code) => [code, PRICES[code]]));
    expect(offerCalls).toBe(0);
  });

  it("reports an unconfigured deployment and an unreachable MKL as such, not as unavailable products", async () => {
    seedUser(); delete state.env.MKL_APP_API_SECRET;
    expect(new Set((await commerceCatalog("u", NOW, fetcher)).products.map((product) => product.state))).toEqual(new Set(["not_configured"]));
    state.env.MKL_APP_API_SECRET = config.secret; unreachable = true;
    expect(new Set((await commerceCatalog("u", NOW, fetcher)).products.map((product) => product.state))).toEqual(new Set(["mkl_unavailable"]));
  });

  it("reads MKL once, and a product that breaks the locked contract fails alone", async () => {
    seedUser({ linked: true });
    offers = [...ALL.filter((code) => code !== "pro").map((code) => offer(code)), offer("pro", { price_idr: 150_000 }), offer("max")];
    const catalog = await commerceCatalog("u", NOW, fetcher);
    expect(offerCalls).toBe(1);
    expect(states(catalog.products)).toEqual({ plus: "available", pro: "unavailable", max: "unavailable", topup_15k: "paid_access_required", topup_45k: "paid_access_required", topup_100k: "paid_access_required" });
  });

  it("asks an unlinked account to link MKL before buying", async () => {
    seedUser({ linked: false });
    expect(new Set((await commerceCatalog("u", NOW, fetcher)).products.map((product) => product.state))).toEqual(new Set(["link_required"]));
  });

  it("sells plans to a free account and top-ups only while paid access is active", async () => {
    seedUser();
    expect(states((await commerceCatalog("u", NOW, fetcher)).products)).toEqual({ plus: "available", pro: "available", max: "available",
      topup_15k: "paid_access_required", topup_45k: "paid_access_required", topup_100k: "paid_access_required" });
    db.close(); db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); applyMigrations(db); seedUser({ paid: true });
    expect(states((await commerceCatalog("u", NOW, fetcher)).products)).toEqual({ plus: "active_access", pro: "active_access", max: "active_access",
      topup_15k: "available", topup_45k: "available", topup_100k: "available" });
  });

  it("points at the purchase already in progress, but an unbound draft does not block a new one", async () => {
    seedUser(); seedIntent("draft", "access", "created", false);
    expect(states((await commerceCatalog("u", NOW, fetcher)).products).plus).toBe("available");
    // A new purchase supersedes the draft (the one-open-access index allows only one).
    db.prepare("UPDATE mkl_purchase_intents SET status='terminal',terminal_reason='superseded_by_new_intent' WHERE id='draft'").run();
    seedIntent("paying", "access", "pending_payment", true);
    const catalog = await commerceCatalog("u", NOW, fetcher);
    expect(catalog.products.filter((product) => product.kind === "access").map((product) => [product.state, product.openPurchaseId]))
      .toEqual([["purchase_open", "paying"], ["purchase_open", "paying"], ["purchase_open", "paying"]]);
    expect(states(catalog.products).topup_15k).toBe("paid_access_required");
  });

  it("keeps discoverOffer's single-product behavior and matches discoverOffers product by product", async () => {
    offers = [...ALL.map((code) => offer(code)), offer("topup_45k")];
    const cfg = commerceConfig(state.env as never);
    await expect(discoverOffer(cfg, "topup_45k", B5_PLAN_VERSION, fetcher)).rejects.toMatchObject({ code: "OFFER_AMBIGUOUS" });
    await expect(discoverOffer(cfg, "unknown", B5_PLAN_VERSION, fetcher)).rejects.toMatchObject({ code: "UNSUPPORTED_PRODUCT" });
    const all = await discoverOffers(cfg, fetcher);
    expect(all.topup_45k).toBeInstanceOf(CommerceError); expect((all.topup_45k as CommerceError).code).toBe("OFFER_AMBIGUOUS");
    expect(all.plus).toMatchObject({ offerId: "offer-plus", priceIdr: 49_000 });
  });
});

type T = (id: string, en: string) => string;
const id: T = (value) => value;

describe("B6 client: purchase state is described, never decided", () => {
  const every: OfferState[] = ["available", "checkout_closed", "not_configured", "mkl_unavailable", "unavailable", "link_required", "purchase_open", "active_access", "paid_access_required"];

  it("offers a buy action only for an available product, and explains every other state", () => {
    for (const state of every) {
      const label = blockedLabel(state, id);
      if (state === "available") expect(label).toBeNull(); else expect(label).toMatch(/\S/);
    }
  });

  it("shows success only for a reconciled purchase", () => {
    const outcomes: RecoveryOutcome[] = ["authorization_required", "pending", "terminal", "reconciled", "reconciliation_required", "retry"];
    for (const outcome of outcomes) for (const kind of ["access", "consumable"] as const) {
      expect(outcomeNotice(outcome, kind, id).tone === "success").toBe(outcome === "reconciled");
    }
    for (const status of ["created", "checkout_pending", "pending_payment", "paid_awaiting_authority", "reconciling", "reconciliation_required", "terminal", "mystery"]) {
      expect(purchaseStatus({ kind: "access", status, terminalReason: null, orderStatus: null }, id).tone).not.toBe("success");
    }
    expect(purchaseStatus({ kind: "consumable", status: "reconciled", terminalReason: null, orderStatus: null }, id)).toEqual({ label: "Karakter ditambahkan", tone: "success" });
    expect(purchaseStatus({ kind: "access", status: "terminal", terminalReason: "order_charged_back", orderStatus: null }, id).label).toContain("ditarik");
    expect(outcomes.filter(isSettledOutcome)).toEqual(["terminal", "reconciled", "reconciliation_required"]);
  });

  it("checks the phone shape the server accepts", () => {
    expect(phoneLooksValid("0812-3456-7890")).toBe(true);
    expect(phoneLooksValid("+62 812 3456 7890")).toBe(true);
    expect(phoneLooksValid("0812")).toBe(false);
    expect(phoneLooksValid("0812 3456 789x")).toBe(false);
  });

  it("has a specific message for every purchase error the server can raise", () => {
    const fallback = errorText(new ApiError("SOMETHING_NEW", 400), false);
    const codes = new Set<string>();
    const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path); else if (/\.tsx?$/.test(entry.name)) for (const match of readFileSync(path, "utf8").matchAll(/CommerceError\("([A-Z_]+)"/g)) codes.add(match[1]!);
    } };
    walk(join("src", "server"));
    expect(codes.size).toBeGreaterThan(20);
    for (const code of codes) expect([code, errorText(new ApiError(code, 409), false)]).not.toEqual([code, fallback]);
  });
});

const product = (overrides: Partial<CatalogProduct> = {}): CatalogProduct => ({ planCode: "plus", planVersion: "pricing-v1", kind: "access", characters: 25_000, priceIdr: 49_000, state: "available", openPurchaseId: null, ...overrides });
const available = (overrides: Partial<Availability> = {}): Availability => ({ product: product(), loading: false, failed: false, onRetry: vi.fn(), ...overrides });
const buy = (availability: Availability) => renderToStaticMarkup(createElement(BuyControl, { availability, label: "Pilih Plus", t: id, onBuy: vi.fn() }));

describe("B6 views", () => {
  it("renders a real buy button only when the server says the product is available", () => {
    expect(buy(available())).toMatch(/<button[^>]*>Pilih Plus<\/button>/);
    const closed = buy(available({ product: product({ state: "checkout_closed" }) }));
    expect(closed).not.toContain("<button"); expect(closed).toContain("Pembelian belum dibuka");
    expect(buy(available({ product: product({ state: "link_required" }) }))).toContain('href="/settings#profil"');
    expect(buy(available({ product: product({ state: "purchase_open", openPurchaseId: "p" }) }))).toContain('href="/settings#pembelian"');
    expect(buy(available({ product: null, loading: true }))).toContain("Memeriksa ketersediaan");
    expect(buy(available({ product: null, failed: true }))).toMatch(/<button[^>]*>.*Muat ulang status pembelian/);
  });

  it("asks only for a phone number before handing the buyer to MKL", () => {
    const html = renderToStaticMarkup(createElement(CheckoutPanel, { product: product({ planCode: "topup_45k", kind: "consumable", characters: 45_000 }), onBack: vi.fn() }));
    expect(html).toContain("Rp49.000");
    expect(html).toContain("45.000 karakter AI tambahan");
    expect(html).toContain("Berlaku 12 bulan sejak MKL mencatat pembelian.");
    expect(html).toContain('type="tel"');
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain("Lanjut ke MKL untuk membayar");
    expect(html).toContain("TulisAI tidak menerima atau menyimpan data pembayaranmu");
    // The button stays disabled until the phone looks valid.
    expect(html.match(/<button[^>]*>/g)!.find((tag) => tag.includes('type="submit"'))).toContain('disabled=""');
  });
});
