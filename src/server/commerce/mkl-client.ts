import type { RuntimeEnv } from "../runtime";

export const B5_PLAN_VERSION = "pricing-v1" as const;
export const B5_PRODUCTS = {
  plus: { kind: "access", includedCharacters: 25_000, lockedPriceIdr: 49_000 },
  pro: { kind: "access", includedCharacters: 100_000, lockedPriceIdr: 179_000 },
  max: { kind: "access", includedCharacters: 350_000, lockedPriceIdr: 499_000 },
  topup_15k: { kind: "consumable", quantity: 15_000, lockedPriceIdr: 19_000 },
  topup_45k: { kind: "consumable", quantity: 45_000, lockedPriceIdr: 49_000 },
  topup_100k: { kind: "consumable", quantity: 100_000, lockedPriceIdr: 99_000 },
} as const;

export type B5PlanCode = keyof typeof B5_PRODUCTS;
export type PurchaseKind = "access" | "consumable";

export type MklOffer = {
  offerId: string; name: string; type: string; priceIdr: number; catalogItemId: string; catalogTitle: string;
  planCode: B5PlanCode; planVersion: typeof B5_PLAN_VERSION; commercialKind: PurchaseKind;
  termUnit: string | null; termCount: number | null; consumableValidityUnit: string | null;
  consumableValidityCount: number | null; requiresActiveAccess: boolean;
};

export type MklOrder = { id: string; orderNumber: string; status: string; grossIdr: number; paidAt: string | null };
export type MklPurchaseCorrection = {
  correctionId: string; revision: number; kind: "refund" | "reversal";
  finalState: "partially_refunded" | "reversed"; amountIdr: number; cumulativeRefundedIdr: number; correctedAt: string;
};
export type MklPurchase = {
  orderId: string; status: string; paidAt: string | null; planCode: string | null; planVersion: string | null;
  commercialKind: string; priceIdrSnapshot: number; offerId: string | null;
  application: { clientId: string; appKey: string | null; catalogItemId: string | null };
  holder: { subject: string | null; organizationId: string | null };
  fulfillmentId: string | null; fulfilledAt: string | null; consumableExpiresAt: string | null;
  consumableValidityUnit: string | null; consumableValidityCount: number | null; requiresActiveAccess: boolean;
  purchaseRevision: number; correctionsComplete: boolean; corrections: MklPurchaseCorrection[];
};

export type CommerceConfig = {
  issuer: string; clientId: string; secret: string; appKey: string; catalogItemId: string; returnUri: string;
};

export class CommerceError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); this.name = "CommerceError"; }
}

const record = (value: unknown, code = "MKL_RESPONSE_INVALID"): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CommerceError(code, "MKL returned an invalid response.", 502);
  return value as Record<string, unknown>;
};
const string = (value: unknown, field: string, nullable = false): string | null => {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value || value.length > 2048) throw new CommerceError("MKL_RESPONSE_INVALID", `MKL returned an invalid ${field}.`, 502);
  return value;
};
const integer = (value: unknown, field: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new CommerceError("MKL_RESPONSE_INVALID", `MKL returned an invalid ${field}.`, 502);
  return value as number;
};
const nullableInteger = (value: unknown, field: string): number | null => value === null ? null : integer(value, field, 1);
const bool = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new CommerceError("MKL_RESPONSE_INVALID", `MKL returned an invalid ${field}.`, 502);
  return value;
};
const instant = (value: unknown, field: string, nullable = false): string | null => {
  const parsed = string(value, field, nullable);
  if (parsed === null) return null;
  if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(parsed) || !Number.isFinite(Date.parse(parsed))) throw new CommerceError("MKL_RESPONSE_INVALID", `MKL returned an invalid ${field}.`, 502);
  return new Date(Date.parse(parsed)).toISOString();
};

const normalizeOrigin = (value: string | undefined, name: string): string => {
  try {
    const url = new URL(value?.trim() ?? "");
    if ((url.protocol !== "https:" && url.hostname !== "localhost") || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error();
    return url.origin;
  } catch { throw new CommerceError("MKL_COMMERCE_NOT_CONFIGURED", `${name} is not a valid origin.`, 503); }
};

export function commerceConfig(env: RuntimeEnv): CommerceConfig {
  const issuer = normalizeOrigin(env.MKL_ISSUER, "MKL_ISSUER");
  const clientId = env.MKL_CLIENT_ID?.trim(); const secret = env.MKL_APP_API_SECRET?.trim();
  const appKey = env.MKL_APP_KEY?.trim(); const catalogItemId = env.MKL_CATALOG_ITEM_ID?.trim();
  const appOrigin = normalizeOrigin(env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  if (!clientId || !secret || !appKey || !catalogItemId) throw new CommerceError("MKL_COMMERCE_NOT_CONFIGURED", "MKL application commerce is not configured.", 503);
  if (env.MKL_CLIENT_SECRET?.trim() && secret === env.MKL_CLIENT_SECRET.trim()) throw new CommerceError("MKL_COMMERCE_NOT_CONFIGURED", "MKL_APP_API_SECRET must be distinct from the OIDC client secret.", 503);
  let returnUri: URL;
  try { returnUri = new URL(env.MKL_COMMERCE_RETURN_URI?.trim() || "/api/commerce/mkl/return", appOrigin); }
  catch { throw new CommerceError("MKL_COMMERCE_NOT_CONFIGURED", "MKL_COMMERCE_RETURN_URI is invalid.", 503); }
  if (returnUri.origin !== appOrigin || returnUri.username || returnUri.password || returnUri.hash || returnUri.search) {
    throw new CommerceError("MKL_COMMERCE_NOT_CONFIGURED", "MKL_COMMERCE_RETURN_URI must be an exact same-origin URL without query or fragment.", 503);
  }
  return { issuer, clientId, secret, appKey, catalogItemId, returnUri: returnUri.toString() };
}

export function productContract(planCode: string, planVersion: string, kind?: PurchaseKind) {
  if (planVersion !== B5_PLAN_VERSION || !(planCode in B5_PRODUCTS)) throw new CommerceError("UNSUPPORTED_PRODUCT", "The requested MKL product is not approved for TulisAI.");
  const product = B5_PRODUCTS[planCode as B5PlanCode];
  if (kind && product.kind !== kind) throw new CommerceError("UNSUPPORTED_PRODUCT", "The requested MKL product kind does not match.");
  return { planCode: planCode as B5PlanCode, planVersion: B5_PLAN_VERSION, ...product };
}

function normalizeOffer(input: unknown, config: CommerceConfig): MklOffer {
  const value = record(input); const planCode = string(value.plan_code, "offer plan_code")!; const planVersion = string(value.plan_version, "offer plan_version")!;
  const product = productContract(planCode, planVersion);
  const commercialKind = string(value.commercial_kind, "offer commercial_kind") as PurchaseKind;
  if (commercialKind !== product.kind) throw new CommerceError("OFFER_CONTRACT_MISMATCH", "The MKL offer commercial kind does not match its approved plan code.");
  const offer: MklOffer = {
    offerId: string(value.offer_id, "offer_id")!, name: string(value.name, "offer name")!, type: string(value.type, "offer type")!,
    priceIdr: integer(value.price_idr, "offer price", 1), catalogItemId: string(value.catalog_item_id, "catalog item")!, catalogTitle: string(value.catalog_title, "catalog title")!,
    planCode: product.planCode, planVersion: product.planVersion, commercialKind,
    termUnit: string(value.term_unit, "term unit", true), termCount: nullableInteger(value.term_count, "term count"),
    consumableValidityUnit: string(value.consumable_validity_unit, "consumable validity unit", true),
    consumableValidityCount: nullableInteger(value.consumable_validity_count, "consumable validity count"),
    requiresActiveAccess: bool(value.requires_active_access, "requires_active_access"),
  };
  if (offer.catalogItemId !== config.catalogItemId) throw new CommerceError("OFFER_PROVENANCE_MISMATCH", "The MKL offer is bound to another catalog item.");
  if (offer.priceIdr !== product.lockedPriceIdr) throw new CommerceError("OFFER_CONTRACT_MISMATCH", "The MKL offer price does not match the locked TulisAI commercial contract.");
  if (product.kind === "access") {
    if (offer.termUnit !== "month" || offer.termCount !== 1 || offer.consumableValidityUnit !== null || offer.consumableValidityCount !== null || offer.requiresActiveAccess) {
      throw new CommerceError("OFFER_CONTRACT_MISMATCH", "The MKL access offer does not have the approved one-month semantics.");
    }
  } else if (offer.termUnit !== null || offer.termCount !== null || offer.consumableValidityUnit !== "month" || offer.consumableValidityCount !== 12 || !offer.requiresActiveAccess) {
    throw new CommerceError("OFFER_CONTRACT_MISMATCH", "The MKL top-up offer does not have the approved twelve-month access-gated semantics.");
  }
  return offer;
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalOffer(offer: MklOffer) {
  return { offer_id: offer.offerId, name: offer.name, type: offer.type, price_idr: offer.priceIdr, catalog_item_id: offer.catalogItemId,
    catalog_title: offer.catalogTitle, plan_code: offer.planCode, plan_version: offer.planVersion, commercial_kind: offer.commercialKind,
    term_unit: offer.termUnit, term_count: offer.termCount, consumable_validity_unit: offer.consumableValidityUnit,
    consumable_validity_count: offer.consumableValidityCount, requires_active_access: offer.requiresActiveAccess };
}

function headers(config: CommerceConfig, extra?: HeadersInit): Headers {
  const result = new Headers(extra); result.set("accept", "application/json"); result.set("MKL-Client-Id", config.clientId); result.set("Authorization", `Bearer ${config.secret}`); return result;
}

async function requestJson(config: CommerceConfig, path: string, init: RequestInit, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(new URL(path, `${config.issuer}/`), { ...init, redirect: "error", headers: headers(config, init.headers) }); }
  catch { throw new CommerceError("MKL_UNAVAILABLE", "MKL commerce is temporarily unavailable.", 503); }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* normalized below */ }
  if (!response.ok) {
    const error = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string" ? String((body as Record<string, unknown>).error) : "mkl_request_rejected";
    throw new CommerceError(`MKL_${error.toUpperCase()}`, "MKL rejected the commerce request.", response.status);
  }
  return body;
}

export async function discoverOffer(config: CommerceConfig, planCode: string, planVersion: string, fetcher: typeof fetch = fetch): Promise<MklOffer> {
  const product = productContract(planCode, planVersion); const body = record(await requestJson(config, "/app/v1/offers", { method: "GET" }, fetcher));
  if (!Array.isArray(body.offers)) throw new CommerceError("MKL_RESPONSE_INVALID", "MKL returned an invalid offers response.", 502);
  const candidates = body.offers.map((offer) => normalizeOffer(offer, config)).filter((offer) => offer.planCode === product.planCode && offer.planVersion === product.planVersion);
  if (candidates.length === 0) throw new CommerceError("OFFER_NOT_AVAILABLE", "The requested MKL offer is not available.", 404);
  if (candidates.length !== 1) throw new CommerceError("OFFER_AMBIGUOUS", "MKL returned duplicate offers for one TulisAI product.", 409);
  return candidates[0]!;
}

export async function startCheckout(config: CommerceConfig, input: { idToken: string; offerId: string; buyerName: string; buyerEmail: string; buyerPhone: string; idempotencyKey: string }, fetcher: typeof fetch = fetch) {
  const body = record(await requestJson(config, "/app/v1/checkout", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ id_token: input.idToken, offer_id: input.offerId, buyer_name: input.buyerName, buyer_email: input.buyerEmail, buyer_phone: input.buyerPhone, return_uri: config.returnUri }) }, fetcher));
  const orderId = string(body.order_id, "checkout order_id")!; const orderNumber = string(body.order_number, "checkout order_number")!;
  const checkoutUrlValue = string(body.checkout_url, "checkout URL")!;
  let checkoutUrl: URL;
  try { checkoutUrl = new URL(checkoutUrlValue); } catch { throw new CommerceError("MKL_RESPONSE_INVALID", "MKL returned an invalid checkout URL.", 502); }
  if (checkoutUrl.origin !== config.issuer || checkoutUrl.username || checkoutUrl.password || checkoutUrl.protocol !== new URL(config.issuer).protocol ||
    checkoutUrl.pathname !== `/pembayaran/${encodeURIComponent(orderId)}` || checkoutUrl.search || checkoutUrl.hash) {
    throw new CommerceError("MKL_RESPONSE_INVALID", "MKL returned an untrusted checkout URL.", 502);
  }
  if (typeof body.reused !== "boolean") throw new CommerceError("MKL_RESPONSE_INVALID", "MKL returned an invalid checkout replay fact.", 502);
  return { orderId, orderNumber, checkoutUrl: checkoutUrl.toString(), reused: body.reused };
}

export async function readOrder(config: CommerceConfig, orderId: string, fetcher: typeof fetch = fetch): Promise<MklOrder> {
  const body = record(await requestJson(config, `/app/v1/orders?order_id=${encodeURIComponent(orderId)}`, { method: "GET" }, fetcher));
  const id = string(body.id, "order id")!;
  if (id !== orderId) throw new CommerceError("ORDER_BINDING_MISMATCH", "MKL returned another order.", 502);
  return { id, orderNumber: string(body.order_number, "order number")!, status: string(body.status, "order status")!, grossIdr: integer(body.gross_idr, "order gross"), paidAt: instant(body.paid_at, "order paid_at", true) };
}

function normalizeCorrection(input: unknown): MklPurchaseCorrection {
  const value = record(input); const kind = string(value.kind, "correction kind"); const finalState = string(value.final_state, "correction final state");
  if (kind !== "refund" && kind !== "reversal") throw new CommerceError("MKL_RESPONSE_INVALID", "MKL returned an invalid correction kind.", 502);
  if (finalState !== "partially_refunded" && finalState !== "reversed") throw new CommerceError("MKL_RESPONSE_INVALID", "MKL returned an invalid correction state.", 502);
  return { correctionId: string(value.correction_id, "correction id")!, revision: integer(value.revision, "correction revision", 2), kind, finalState,
    amountIdr: integer(value.amount_idr, "correction amount", 1), cumulativeRefundedIdr: integer(value.cumulative_refunded_idr, "cumulative refund", 1), correctedAt: instant(value.corrected_at, "corrected_at")! };
}

export async function readPurchase(config: CommerceConfig, orderId: string, fetcher: typeof fetch = fetch): Promise<MklPurchase> {
  const value = record(await requestJson(config, `/app/v1/purchases?order_id=${encodeURIComponent(orderId)}`, { method: "GET" }, fetcher));
  const application = record(value.application); const holder = record(value.holder);
  if (!Array.isArray(value.corrections)) throw new CommerceError("MKL_RESPONSE_INVALID", "MKL returned invalid purchase corrections.", 502);
  const corrections = value.corrections.map(normalizeCorrection); const revision = integer(value.purchase_revision, "purchase revision");
  if (corrections.some((item, index) => item.revision !== index + 2) || (revision > 0 && corrections.length !== revision - 1)) throw new CommerceError("MKL_CORRECTION_SEQUENCE_INVALID", "MKL returned a non-contiguous correction sequence.", 502);
  const purchase: MklPurchase = {
    orderId: string(value.order_id, "purchase order_id")!, status: string(value.status, "purchase status")!, paidAt: instant(value.paid_at, "purchase paid_at", true),
    planCode: string(value.plan_code, "purchase plan_code", true), planVersion: string(value.plan_version, "purchase plan_version", true), commercialKind: string(value.commercial_kind, "purchase commercial_kind")!,
    priceIdrSnapshot: integer(value.price_idr_snapshot, "purchase price"), offerId: string(value.offer_id, "purchase offer_id", true),
    application: { clientId: string(application.client_id, "application client_id")!, appKey: string(application.app_key, "application app_key", true), catalogItemId: string(application.catalog_item_id, "application catalog_item_id", true) },
    holder: { subject: string(holder.subject, "holder subject", true), organizationId: string(holder.organization_id, "holder organization", true) },
    fulfillmentId: string(value.fulfillment_id, "fulfillment_id", true), fulfilledAt: instant(value.fulfilled_at, "fulfilled_at", true), consumableExpiresAt: instant(value.consumable_expires_at, "consumable_expires_at", true),
    consumableValidityUnit: string(value.consumable_validity_unit, "consumable validity unit", true), consumableValidityCount: nullableInteger(value.consumable_validity_count, "consumable validity count"),
    requiresActiveAccess: bool(value.requires_active_access, "requires_active_access"), purchaseRevision: revision, correctionsComplete: bool(value.corrections_complete, "corrections_complete"), corrections,
  };
  if (purchase.orderId !== orderId) throw new CommerceError("ORDER_BINDING_MISMATCH", "MKL returned another purchase.", 502);
  const correctionIds = new Set<string>(); let cumulative = 0; let correctedAt = purchase.fulfilledAt ? Date.parse(purchase.fulfilledAt) : Number.NEGATIVE_INFINITY;
  for (const correction of purchase.corrections) {
    const at = Date.parse(correction.correctedAt);
    if (correctionIds.has(correction.correctionId) || correction.amountIdr > purchase.priceIdrSnapshot || correction.cumulativeRefundedIdr !== cumulative + correction.amountIdr || correction.cumulativeRefundedIdr > purchase.priceIdrSnapshot || at < correctedAt ||
      (correction.kind === "reversal" && correction.finalState !== "reversed") ||
      (correction.finalState === "partially_refunded" && correction.cumulativeRefundedIdr >= purchase.priceIdrSnapshot) ||
      (correction.finalState === "reversed" && correction.cumulativeRefundedIdr !== purchase.priceIdrSnapshot)) {
      throw new CommerceError("MKL_CORRECTION_SEQUENCE_INVALID", "MKL returned inconsistent correction facts.", 502);
    }
    correctionIds.add(correction.correctionId); cumulative = correction.cumulativeRefundedIdr; correctedAt = at;
  }
  return purchase;
}
