import type { MklIdentity } from "../auth/mkl-oidc";
import { getMklLinkByUserId, type ExternalIdentityLink } from "../identity/links";
import { AuthorityError, refreshMklAuthority } from "../entitlements/authority";
import { runtime } from "../runtime";
import {
  acceptVerifiedPurchasedLot, applyVerifiedLotCorrection, markPurchasedLotReconciliationRequired, restoreVerifiedPurchasedLot, WalletError,
} from "../usage/wallet";
import {
  B5_PLAN_VERSION, CommerceError, assertCheckoutOpen, canonicalOffer, commerceConfig, discoverOffer, productContract, readOrder, readPurchase,
  sha256Canonical, startCheckout, type B5PlanCode, type MklOffer, type MklOrder, type MklPurchase, type PurchaseKind,
} from "./mkl-client";

/** MKL order statuses, grouped by what they prove about payment. */
const PENDING_ORDER_STATUSES = new Set(["pending_payment"]);
const UNPAID_FINAL_ORDER_STATUSES = new Set(["expired", "cancelled", "failed"]);
const POST_PAYMENT_ORDER_STATUSES = new Set(["paid", "chargeback_pending", "charged_back"]);
const OPEN_INTENT_STATUSES = new Set(["created", "checkout_pending", "pending_payment", "paid_awaiting_authority", "reconciling", "reconciliation_required"]);

export type IntentStatus = "created" | "checkout_pending" | "pending_payment" | "paid_awaiting_authority" | "reconciling" | "reconciled" | "terminal" | "reconciliation_required";

/**
 * The single source of allowed intent transitions: target -> statuses it may be
 * entered from. No final status appears as a source, so a reconciled access
 * intent or any terminal intent can never move again. A consumable stays
 * re-verifiable after reconciliation because MKL corrections arrive later, but
 * it can never return to a pre-payment status.
 */
const TRANSITIONS: Record<PurchaseKind, Partial<Record<IntentStatus, readonly IntentStatus[]>>> = {
  access: {
    checkout_pending: ["created", "checkout_pending"],
    created: ["checkout_pending"],
    pending_payment: ["checkout_pending", "pending_payment"],
    paid_awaiting_authority: ["pending_payment", "paid_awaiting_authority", "reconciliation_required"],
    reconciled: ["pending_payment", "paid_awaiting_authority", "reconciliation_required"],
    reconciliation_required: ["checkout_pending", "pending_payment", "paid_awaiting_authority", "reconciliation_required"],
    terminal: ["created", "checkout_pending", "pending_payment", "paid_awaiting_authority", "reconciliation_required"],
  },
  consumable: {
    checkout_pending: ["created", "checkout_pending"],
    created: ["checkout_pending"],
    pending_payment: ["checkout_pending", "pending_payment"],
    reconciling: ["pending_payment", "reconciling", "reconciled", "reconciliation_required"],
    reconciled: ["reconciling"],
    reconciliation_required: ["checkout_pending", "pending_payment", "reconciling", "reconciled", "reconciliation_required"],
    terminal: ["created", "checkout_pending", "pending_payment"],
  },
};

export function allowedSources(kind: PurchaseKind, to: IntentStatus): readonly IntentStatus[] {
  return TRANSITIONS[kind][to] ?? [];
}

export type PurchaseIntentRow = {
  id: string; owner_id: string; identity_link_id: string; organization_id: string; purchase_kind: PurchaseKind;
  plan_code: B5PlanCode; plan_version: string; offer_id: string; offer_contract_json: string; offer_contract_hash: string;
  client_request_key_hash: string; request_fingerprint: string; mkl_idempotency_key: string; buyer_phone: string; return_uri: string;
  mkl_order_id: string | null; mkl_order_number: string | null; checkout_url: string | null; order_status: string | null; status: IntentStatus;
  fulfillment_id: string | null; lot_id: string | null; purchase_revision: number; purchase_payload_hash: string | null;
  authorization_attempts: number; recovery_attempts: number; last_error_code: string | null; terminal_reason: string | null;
  created_at: number; updated_at: number; order_bound_at: number | null; reconciled_at: number | null; terminal_at: number | null;
};

export type PublicPurchaseIntent = {
  purchaseId: string; kind: PurchaseKind; planCode: B5PlanCode; planVersion: string; offerId: string; offeredPriceIdr: number;
  status: string; orderId: string | null; orderNumber: string | null; checkoutUrl: string | null; orderStatus: string | null;
  fulfillmentId: string | null; purchaseRevision: number; lastErrorCode: string | null; terminalReason: string | null; createdAt: number; updatedAt: number;
  authorizationRequired: boolean;
};

export type RecoveryOutcome = "authorization_required" | "pending" | "terminal" | "reconciled" | "reconciliation_required" | "retry";

const intentById = (id: string) => runtime().DB.prepare("SELECT * FROM mkl_purchase_intents WHERE id=?").bind(id).first<PurchaseIntentRow>();
const intentByRequest = (ownerId: string, keyHash: string) => runtime().DB.prepare("SELECT * FROM mkl_purchase_intents WHERE owner_id=? AND client_request_key_hash=?").bind(ownerId, keyHash).first<PurchaseIntentRow>();

type Column = "order_status" | "last_error_code" | "terminal_reason" | "terminal_at" | "reconciled_at" | "mkl_order_id" | "mkl_order_number" | "checkout_url" |
  "order_bound_at" | "fulfillment_id" | "lot_id" | "purchase_revision" | "purchase_payload_hash";

/**
 * Move an intent only along an allowed edge. The guard is evaluated in the
 * UPDATE itself, so a concurrent writer that already finalized the intent wins
 * and this call becomes a no-op instead of a regression.
 */
async function transition(row: PurchaseIntentRow, to: IntentStatus, now: number, set: Partial<Record<Column, string | number | null>> = {}, extraWhere = ""): Promise<boolean> {
  const sources = allowedSources(row.purchase_kind, to);
  if (sources.length === 0) return false;
  const columns = Object.keys(set) as Column[];
  const assignments = ["status=?", "updated_at=?", ...columns.map((column) => `${column}=?`)].join(",");
  const result = await runtime().DB.prepare(`UPDATE mkl_purchase_intents SET ${assignments}
    WHERE id=? AND owner_id=? AND status IN (${sources.map(() => "?").join(",")})${extraWhere}`)
    .bind(to, now, ...columns.map((column) => set[column] ?? null), row.id, row.owner_id, ...sources).run();
  return (result.meta.changes ?? 0) === 1;
}

/** Record evidence without changing lifecycle state. */
async function noteError(row: PurchaseIntentRow, code: string, now: number, orderStatus?: string) {
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET last_error_code=?,order_status=COALESCE(?,order_status),updated_at=? WHERE id=? AND owner_id=?")
    .bind(code.slice(0, 100), orderStatus ?? null, now, row.id, row.owner_id).run();
}

function parseStoredOffer(row: PurchaseIntentRow): MklOffer {
  try {
    const value = JSON.parse(row.offer_contract_json) as ReturnType<typeof canonicalOffer>;
    return { offerId: value.offer_id, name: value.name, type: value.type, priceIdr: value.price_idr, catalogItemId: value.catalog_item_id,
      catalogTitle: value.catalog_title, planCode: value.plan_code, planVersion: value.plan_version, commercialKind: value.commercial_kind,
      termUnit: value.term_unit, termCount: value.term_count, consumableValidityUnit: value.consumable_validity_unit,
      consumableValidityCount: value.consumable_validity_count, requiresActiveAccess: value.requires_active_access };
  } catch { throw new CommerceError("LOCAL_INTENT_CORRUPT", "The stored purchase intent is invalid.", 503); }
}

export function publicPurchaseIntent(row: PurchaseIntentRow): PublicPurchaseIntent {
  const offer = parseStoredOffer(row);
  return { purchaseId: row.id, kind: row.purchase_kind, planCode: row.plan_code, planVersion: row.plan_version, offerId: row.offer_id,
    offeredPriceIdr: offer.priceIdr, status: row.status, orderId: row.mkl_order_id, orderNumber: row.mkl_order_number,
    checkoutUrl: row.checkout_url, orderStatus: row.order_status, fulfillmentId: row.fulfillment_id,
    purchaseRevision: row.purchase_revision, lastErrorCode: row.last_error_code, terminalReason: row.terminal_reason,
    createdAt: row.created_at, updatedAt: row.updated_at,
    authorizationRequired: row.status === "created" || row.status === "paid_awaiting_authority" };
}

function validClientKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new CommerceError("PURCHASE_IDEMPOTENCY_KEY_INVALID", "A stable purchase Idempotency-Key is required.", 400);
  return key;
}

function validPhone(value: string): string {
  const phone = value.trim();
  if (phone.length < 3 || phone.length > 32 || !/^[0-9+(). -]+$/.test(phone)) throw new CommerceError("BUYER_PHONE_INVALID", "A valid buyer phone is required.", 400);
  return phone;
}

type Projection = {
  identity_link_id: string; entitlement_id: string | null; plan_code: string | null; plan_version: string | null; access_deadline: string | null;
  server_time: string; fresh_until: number; invalidated_at: number | null; invalidation_reason: string | null; status: string | null;
};
async function projection(ownerId: string): Promise<Projection | null> {
  return await runtime().DB.prepare(`SELECT identity_link_id,entitlement_id,plan_code,plan_version,access_deadline,server_time,fresh_until,invalidated_at,invalidation_reason,status
    FROM mkl_entitlement_projection WHERE user_id=?`).bind(ownerId).first<Projection>() ?? null;
}
function isFreshActive(row: Projection | null, now = Date.now()): row is Projection {
  return Boolean(row && row.invalidated_at === null && row.status === "active" && row.entitlement_id && row.plan_version === B5_PLAN_VERSION &&
    ["plus", "pro", "max"].includes(row.plan_code ?? "") && row.fresh_until > now && row.access_deadline && Date.parse(row.access_deadline) > now);
}

/**
 * What B3 authority says about a paid access order. Only a fresh projection
 * observed by MKL at or after the order's payment instant can decide; anything
 * older, stale, or invalidated for a non-lifecycle reason is `unknown`.
 * Revoked/suspended invalidation is B3's authoritative "not active" fact.
 */
type AccessObservation = "active" | "superseded" | "inactive" | "unknown";
function observeAccess(current: Projection | null, row: PurchaseIntentRow, paidAt: string, now: number): AccessObservation {
  if (!current || current.identity_link_id !== row.identity_link_id || current.fresh_until <= now) return "unknown";
  // Strictly after payment: an observation in the same millisecond cannot
  // prove it saw the settlement write.
  if (!Number.isFinite(Date.parse(current.server_time)) || Date.parse(current.server_time) <= Date.parse(paidAt)) return "unknown";
  if (current.invalidated_at !== null && !["revoked", "suspended"].includes(current.invalidation_reason ?? "")) return "unknown";
  if (!isFreshActive(current, now)) return "inactive";
  return current.plan_code === row.plan_code && current.plan_version === row.plan_version ? "active" : "superseded";
}

async function assertEligibility(ownerId: string, kind: PurchaseKind, now = Date.now()): Promise<void> {
  const current = await projection(ownerId); const active = isFreshActive(current, now);
  if (kind === "access" && active) throw new CommerceError("ACTIVE_ACCESS_EXISTS", "Current paid access blocks another access purchase.", 409);
  if (kind === "consumable" && !active) throw new CommerceError("FRESH_PAID_ACCESS_REQUIRED", "Fresh Plus, Pro, or Max authority is required for a top-up.", 409);
}

async function requireLink(ownerId: string): Promise<ExternalIdentityLink> {
  const link = await getMklLinkByUserId(ownerId);
  if (!link?.organizationId) throw new CommerceError("MKL_IDENTITY_REQUIRED", "Link an MKL identity before purchasing.", 409);
  return link;
}

/**
 * Before a deliberate new purchase, settle older open intents of the same kind
 * that cannot hold a payable MKL order (unbound `created`) or whose MKL
 * authority can now be resolved without a new ceremony. Nothing is deleted.
 */
async function settleOpenIntents(ownerId: string, kind: PurchaseKind, now: number, fetcher: typeof fetch): Promise<void> {
  const rows = await runtime().DB.prepare(`SELECT * FROM mkl_purchase_intents WHERE owner_id=? AND purchase_kind=?
    AND status IN ('created','pending_payment','paid_awaiting_authority','reconciliation_required') ORDER BY created_at,id`).bind(ownerId, kind).all<PurchaseIntentRow>();
  for (const row of rows.results ?? []) {
    if (row.status === "created" && !row.mkl_order_id) {
      await transition(row, "terminal", now, { terminal_reason: "superseded_by_new_intent", terminal_at: now, last_error_code: null }, " AND mkl_order_id IS NULL");
    } else if (row.mkl_order_id) {
      try { await recoverPurchaseIntent({ ownerId, purchaseId: row.id, now }, fetcher); } catch { /* the insert below reports what still blocks */ }
    }
  }
}

export async function createPurchaseIntent(input: { ownerId: string; kind: PurchaseKind; planCode: string; planVersion: string; buyerPhone: string; clientRequestKey: string; now?: number }, fetcher: typeof fetch = fetch): Promise<{ intent: PublicPurchaseIntent; created: boolean }> {
  const now = input.now ?? Date.now(); const product = productContract(input.planCode, input.planVersion, input.kind);
  const phone = validPhone(input.buyerPhone); const key = validClientKey(input.clientRequestKey);
  const keyHash = await sha256Canonical({ ownerId: input.ownerId, key });
  const requestFingerprint = await sha256Canonical({ kind: input.kind, planCode: product.planCode, planVersion: product.planVersion, buyerPhone: phone });
  const replay = await intentByRequest(input.ownerId, keyHash);
  if (replay) {
    if (replay.request_fingerprint !== requestFingerprint) throw new CommerceError("PURCHASE_IDEMPOTENCY_CONFLICT", "The purchase Idempotency-Key was already used for another request.", 422);
    return { intent: publicPurchaseIntent(replay), created: false };
  }
  assertCheckoutOpen(runtime());
  const link = await requireLink(input.ownerId); await assertEligibility(input.ownerId, input.kind, now);
  const config = commerceConfig(runtime()); const offer = await discoverOffer(config, product.planCode, product.planVersion, fetcher);
  await settleOpenIntents(input.ownerId, input.kind, now, fetcher);
  const offerContract = canonicalOffer(offer); const offerContractJson = JSON.stringify(offerContract); const offerContractHash = await sha256Canonical(offerContract);
  const id = crypto.randomUUID(); const mklIdempotencyKey = `tulisai:${id}`;
  try {
    await runtime().DB.prepare(`INSERT INTO mkl_purchase_intents (id,owner_id,identity_link_id,organization_id,purchase_kind,plan_code,plan_version,
      offer_id,offer_contract_json,offer_contract_hash,client_request_key_hash,request_fingerprint,mkl_idempotency_key,buyer_phone,return_uri,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'created',?,?)`).bind(id, input.ownerId, link.id, link.organizationId, input.kind, product.planCode, product.planVersion,
      offer.offerId, offerContractJson, offerContractHash, keyHash, requestFingerprint, mklIdempotencyKey, phone, config.returnUri, now, now).run();
  } catch (error) {
    const raced = await intentByRequest(input.ownerId, keyHash);
    if (raced?.request_fingerprint === requestFingerprint) return { intent: publicPurchaseIntent(raced), created: false };
    const open = await runtime().DB.prepare(`SELECT id FROM mkl_purchase_intents WHERE owner_id=? AND purchase_kind=? AND
      (status IN ('created','checkout_pending','pending_payment','paid_awaiting_authority') OR
       (?='access' AND status IN ('reconciling','reconciliation_required'))) LIMIT 1`).bind(input.ownerId, input.kind, input.kind).first();
    if (open) throw new CommerceError("PURCHASE_ALREADY_OPEN", `Finish or recover the existing ${input.kind} purchase first.`, 409);
    throw error;
  }
  return { intent: publicPurchaseIntent((await intentById(id))!), created: true };
}

export async function getPurchaseIntent(ownerId: string, purchaseId: string): Promise<PurchaseIntentRow> {
  const row = await intentById(purchaseId);
  if (!row || row.owner_id !== ownerId) throw new CommerceError("PURCHASE_NOT_FOUND", "Purchase intent not found.", 404);
  return row;
}

export async function listPurchaseIntents(ownerId: string, limit = 20): Promise<PublicPurchaseIntent[]> {
  const size = Math.min(50, Math.max(1, Math.trunc(limit)));
  const rows = await runtime().DB.prepare("SELECT * FROM mkl_purchase_intents WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT ?").bind(ownerId, size).all<PurchaseIntentRow>();
  return (rows.results ?? []).map(publicPurchaseIntent);
}

export async function assertPurchaseAuthorizationStart(ownerId: string, purchaseId: string, now = Date.now()): Promise<PurchaseIntentRow> {
  const row = await getPurchaseIntent(ownerId, purchaseId); const link = await requireLink(ownerId);
  if (row.identity_link_id !== link.id || row.organization_id !== link.organizationId) throw new CommerceError("PURCHASE_IDENTITY_CHANGED", "The purchase belongs to another MKL identity.", 409);
  if (!OPEN_INTENT_STATUSES.has(row.status)) throw new CommerceError("PURCHASE_NOT_AUTHORIZABLE", "This purchase no longer needs MKL authorization.", 409);
  // Recovery of a bound order stays available while new checkout is closed.
  if (!row.mkl_order_id) assertCheckoutOpen(runtime());
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET authorization_attempts=authorization_attempts+1,updated_at=? WHERE id=? AND owner_id=?")
    .bind(now, purchaseId, ownerId).run();
  return (await intentById(purchaseId))!;
}

function identityMatches(link: ExternalIdentityLink, identity: MklIdentity, row: PurchaseIntentRow): boolean {
  return link.id === row.identity_link_id && link.issuer === identity.issuer && link.subject === identity.subject &&
    link.organizationId === identity.organizationId && row.organization_id === identity.organizationId;
}

const OFFER_CLOSING_CODES: Record<string, string> = {
  OFFER_NOT_AVAILABLE: "offer_unavailable", OFFER_AMBIGUOUS: "offer_contract_mismatch",
  OFFER_CONTRACT_MISMATCH: "offer_contract_mismatch", OFFER_PROVENANCE_MISMATCH: "offer_contract_mismatch",
};

/**
 * A checkout failure is definitive only when MKL answered with a 4xx refusal,
 * which creates no order. Anything else may have created an order under the
 * stable key, so the intent stays `checkout_pending` and only that key retries.
 */
function checkoutFailureIsDefinitive(error: unknown): boolean {
  if (!(error instanceof CommerceError)) return false;
  if (!error.transport || error.code === "MKL_UNAVAILABLE" || error.code === "MKL_RESPONSE_UNPARSEABLE") return false;
  return error.status >= 400 && error.status < 500 && error.status !== 429 && error.code !== "MKL_CHECKOUT_ALREADY_IN_PROGRESS";
}

export async function authorizePurchaseIntent(input: { ownerId: string; purchaseId: string; identity: MklIdentity; idToken: string; now?: number }, fetcher: typeof fetch = fetch): Promise<{ redirectUrl: string; intent: PublicPurchaseIntent }> {
  const now = input.now ?? Date.now(); const row = await getPurchaseIntent(input.ownerId, input.purchaseId); const link = await requireLink(input.ownerId);
  if (!identityMatches(link, input.identity, row)) {
    await noteError(row, "PURCHASE_IDENTITY_MISMATCH", now);
    throw new CommerceError("PURCHASE_IDENTITY_MISMATCH", "The verified MKL identity does not match this purchase.", 403);
  }
  if (!input.identity.email || !input.identity.emailVerified) throw new CommerceError("MKL_PROFILE_INCOMPLETE", "MKL must provide a verified buyer email.", 409);
  if (row.mkl_order_id) {
    // Recovery path: refresh B3 if MKL answers, then let recovery decide from
    // whatever authority is available. It never starts a new checkout.
    try { await refreshMklAuthority(input.ownerId, link, input.idToken, fetcher); }
    catch (error) { if (!(error instanceof AuthorityError)) throw error; await noteError(row, error.code, now); }
    const recovered = await recoverPurchaseIntent({ ownerId: input.ownerId, purchaseId: row.id, now }, fetcher);
    const openCheckout = recovered.intent.status === "pending_payment" ? recovered.intent.checkoutUrl : null;
    return { redirectUrl: openCheckout ?? new URL(`/app?purchase=${encodeURIComponent(row.id)}`, commerceConfig(runtime()).returnUri).toString(), intent: recovered.intent };
  }
  if (row.status !== "created" && row.status !== "checkout_pending") throw new CommerceError("PURCHASE_NOT_AUTHORIZABLE", "This purchase no longer needs MKL authorization.", 409);
  assertCheckoutOpen(runtime());
  await refreshMklAuthority(input.ownerId, link, input.idToken, fetcher);
  await assertEligibility(input.ownerId, row.purchase_kind, now);
  const config = commerceConfig(runtime());
  let liveOffer: MklOffer;
  try { liveOffer = await discoverOffer(config, row.plan_code, row.plan_version, fetcher); }
  catch (error) {
    const reason = error instanceof CommerceError && !error.transport ? OFFER_CLOSING_CODES[error.code] : undefined;
    if (reason) await transition(row, "terminal", now, { last_error_code: (error as CommerceError).code, terminal_reason: reason, terminal_at: now }, " AND mkl_order_id IS NULL");
    throw error;
  }
  const liveHash = await sha256Canonical(canonicalOffer(liveOffer));
  if (liveOffer.offerId !== row.offer_id || liveHash !== row.offer_contract_hash) {
    await transition(row, "terminal", now, { last_error_code: "OFFER_CHANGED", terminal_reason: "offer_changed", terminal_at: now }, " AND mkl_order_id IS NULL");
    throw new CommerceError("OFFER_CHANGED", "The MKL offer changed after this purchase intent was created. Start a deliberate new intent.", 409);
  }
  if (!await transition(row, "checkout_pending", now, { last_error_code: null }, " AND mkl_order_id IS NULL")) {
    throw new CommerceError("PURCHASE_NOT_AUTHORIZABLE", "This purchase was closed or is already bound to an MKL order.", 409);
  }
  const pending = { ...row, status: "checkout_pending" as const };
  let checkout: Awaited<ReturnType<typeof startCheckout>>;
  try {
    checkout = await startCheckout(config, { idToken: input.idToken, offerId: row.offer_id, buyerName: input.identity.name || input.identity.email.split("@")[0] || "MKL user",
      buyerEmail: input.identity.email, buyerPhone: row.buyer_phone, idempotencyKey: row.mkl_idempotency_key }, fetcher);
  } catch (error) {
    const code = error instanceof CommerceError ? error.code : "MKL_CHECKOUT_FAILED";
    if (checkoutFailureIsDefinitive(error)) await transition(pending, "created", now, { last_error_code: code }, " AND mkl_order_id IS NULL");
    else await noteError(pending, code, now);
    throw error;
  }
  await transition(pending, "pending_payment", now, { mkl_order_id: checkout.orderId, mkl_order_number: checkout.orderNumber, checkout_url: checkout.checkoutUrl,
    order_status: "pending_payment", order_bound_at: now, last_error_code: null }, " AND mkl_order_id IS NULL");
  const current = await getPurchaseIntent(row.owner_id, row.id);
  if (current.mkl_order_id !== checkout.orderId || current.mkl_order_number !== checkout.orderNumber || current.checkout_url !== checkout.checkoutUrl) {
    await transition(current, "reconciliation_required", now, { last_error_code: "ORDER_BINDING_CONFLICT" });
    throw new CommerceError("ORDER_BINDING_CONFLICT", "The stable MKL idempotency key returned conflicting orders.", 409);
  }
  return { redirectUrl: current.checkout_url!, intent: publicPurchaseIntent(current) };
}

function assertPurchaseBinding(row: PurchaseIntentRow, purchase: MklPurchase, link: ExternalIdentityLink) {
  const config = commerceConfig(runtime());
  if (purchase.application.clientId !== config.clientId || purchase.application.appKey !== config.appKey || purchase.application.catalogItemId !== config.catalogItemId ||
    purchase.holder.subject !== link.subject || purchase.holder.organizationId !== link.organizationId || purchase.offerId !== row.offer_id ||
    purchase.planCode !== row.plan_code || purchase.planVersion !== row.plan_version || purchase.commercialKind !== row.purchase_kind) {
    throw new CommerceError("PURCHASE_PROVENANCE_MISMATCH", "The MKL purchase does not match the local intent and identity.", 409);
  }
  productContract(purchase.planCode, purchase.planVersion, row.purchase_kind);
  if (purchase.priceIdrSnapshot !== parseStoredOffer(row).priceIdr) throw new CommerceError("PURCHASE_PRICE_MISMATCH", "The MKL purchase price does not match the verified intent offer.", 409);
}

/**
 * Access is decided by B3 authority observed after payment; no ID token is
 * needed here. The intent becomes final (`reconciled` or `terminal`) as soon as
 * that authority exists, so it can never keep blocking a later purchase.
 */
async function reconcileAccess(row: PurchaseIntentRow, link: ExternalIdentityLink, purchase: MklPurchase, now: number): Promise<void> {
  assertPurchaseBinding(row, purchase, link);
  if (!purchase.paidAt) throw new CommerceError("PURCHASE_NOT_PAID", "MKL has not confirmed payment.", 409);
  if (purchase.status === "charged_back") {
    await transition(row, "terminal", now, { order_status: purchase.status, terminal_reason: "order_charged_back", terminal_at: now, last_error_code: null });
    return;
  }
  const observation = observeAccess(await projection(row.owner_id), row, purchase.paidAt, now);
  if (observation === "active") {
    await transition(row, "reconciled", now, { order_status: purchase.status, reconciled_at: now, last_error_code: null });
  } else if (observation === "superseded" || observation === "inactive") {
    await transition(row, "terminal", now, { order_status: purchase.status, terminal_at: now, last_error_code: null,
      terminal_reason: observation === "superseded" ? "access_superseded" : "access_not_active_after_payment" });
  } else if (row.status === "reconciliation_required") {
    await noteError(row, "ACCESS_AUTHORITY_NOT_OBSERVED", now, purchase.status);
  } else {
    await transition(row, "paid_awaiting_authority", now, { order_status: purchase.status, last_error_code: "ACCESS_AUTHORITY_NOT_OBSERVED" });
  }
}

function completeConsumable(row: PurchaseIntentRow, purchase: MklPurchase, link: ExternalIdentityLink) {
  assertPurchaseBinding(row, purchase, link);
  if (!purchase.paidAt || !purchase.fulfillmentId || !purchase.fulfilledAt || !purchase.consumableExpiresAt || purchase.purchaseRevision < 1 ||
    purchase.consumableValidityUnit !== "month" || purchase.consumableValidityCount !== 12 || !purchase.requiresActiveAccess) {
    throw new CommerceError("PURCHASE_AUTHORITY_INCOMPLETE", "MKL did not return complete authoritative top-up fulfillment facts.", 409);
  }
  if (Date.parse(purchase.fulfilledAt) < Date.parse(purchase.paidAt)) throw new CommerceError("PURCHASE_AUTHORITY_INVALID", "MKL fulfillment predates payment authority.", 409);
  if (Date.parse(purchase.consumableExpiresAt) <= Date.parse(purchase.fulfilledAt)) throw new CommerceError("PURCHASE_AUTHORITY_INVALID", "MKL returned an invalid top-up expiry.", 409);
}

function canonicalPurchase(purchase: MklPurchase) {
  return { order_id: purchase.orderId, status: purchase.status, paid_at: purchase.paidAt, plan_code: purchase.planCode, plan_version: purchase.planVersion,
    commercial_kind: purchase.commercialKind, price_idr_snapshot: purchase.priceIdrSnapshot, offer_id: purchase.offerId, application: purchase.application,
    holder: purchase.holder, fulfillment_id: purchase.fulfillmentId, fulfilled_at: purchase.fulfilledAt, consumable_expires_at: purchase.consumableExpiresAt,
    consumable_validity_unit: purchase.consumableValidityUnit, consumable_validity_count: purchase.consumableValidityCount,
    requires_active_access: purchase.requiresActiveAccess, purchase_revision: purchase.purchaseRevision,
    corrections_complete: purchase.correctionsComplete, corrections: purchase.corrections };
}

/** Fence spend on a fulfilled lot because received MKL authority is unsafe. */
async function fenceConsumable(row: PurchaseIntentRow, code: string, now: number, orderStatus?: string) {
  if (row.lot_id) await markPurchasedLotReconciliationRequired(row.owner_id, row.lot_id, code.toLowerCase(), now);
  await transition(row, "reconciliation_required", now, { last_error_code: code.slice(0, 100), ...(orderStatus ? { order_status: orderStatus } : {}) });
}

async function reconcileConsumable(row: PurchaseIntentRow, link: ExternalIdentityLink, purchase: MklPurchase, now: number): Promise<void> {
  assertPurchaseBinding(row, purchase, link);
  if (!purchase.correctionsComplete) {
    // MKL explicitly reports unresolved authority (e.g. chargeback_pending or a
    // provider-only refund). That is received authority, so spend is fenced.
    await fenceConsumable(row, "PURCHASE_CORRECTIONS_INCOMPLETE", now, purchase.status);
    return;
  }
  completeConsumable(row, purchase, link);
  const product = productContract(row.plan_code, row.plan_version, "consumable");
  if (!("quantity" in product)) throw new CommerceError("PURCHASE_PRODUCT_MISMATCH", "The verified purchase is not a top-up.", 409);
  const purchaseHash = await sha256Canonical(canonicalPurchase(purchase));
  if (purchase.purchaseRevision < row.purchase_revision) throw new CommerceError("PURCHASE_REVISION_STALE", "An older MKL purchase revision was rejected.", 409);
  if (purchase.purchaseRevision === row.purchase_revision && row.purchase_payload_hash && row.purchase_payload_hash !== purchaseHash) {
    throw new CommerceError("PURCHASE_REVISION_CONFLICT", "The same MKL purchase revision contained different facts.", 409);
  }
  await transition(row, "reconciling", now, { last_error_code: null }, ` AND purchase_revision<=${Number(purchase.purchaseRevision)}`);
  const fulfillment = { order_id: purchase.orderId, offer_id: purchase.offerId, application: purchase.application, holder: purchase.holder,
    fulfillment_id: purchase.fulfillmentId, fulfilled_at: purchase.fulfilledAt, expires_at: purchase.consumableExpiresAt,
    plan_code: purchase.planCode, plan_version: purchase.planVersion, commercial_kind: purchase.commercialKind };
  const fulfillmentHash = await sha256Canonical(fulfillment);
  const customerBindingHash = await sha256Canonical({ issuer: link.issuer, subject: link.subject, organization_id: link.organizationId,
    owner_id: row.owner_id, application: purchase.application });
  const lotId = await acceptVerifiedPurchasedLot({ ownerId: row.owner_id, identityLinkId: row.identity_link_id, fulfillmentId: purchase.fulfillmentId!,
    customerBindingHash, applicationAppKey: purchase.application.appKey!, catalogItemId: purchase.application.catalogItemId!,
    offerId: purchase.offerId, offerVersion: purchase.planVersion, quantity: product.quantity, fulfilledAt: purchase.fulfilledAt!,
    expiresAt: purchase.consumableExpiresAt!, verificationRevision: "1", verificationPayloadHash: fulfillmentHash }, now);
  for (const correction of purchase.corrections) {
    const correctionHash = await sha256Canonical(correction);
    await applyVerifiedLotCorrection({ ownerId: row.owner_id, lotId, correctionId: correction.correctionId, revision: correction.revision,
      kind: correction.finalState === "reversed" ? "reversal" : "refund", payloadHash: correctionHash,
      reasonCode: `mkl_${correction.kind}_${correction.finalState}` }, now);
  }
  if (purchase.corrections.length === 0) await restoreVerifiedPurchasedLot(row.owner_id, lotId, purchaseHash, now);
  const reconciling = { ...row, status: "reconciling" as const };
  const updated = await transition(reconciling, "reconciled", now, { order_status: purchase.status, fulfillment_id: purchase.fulfillmentId, lot_id: lotId,
    purchase_revision: purchase.purchaseRevision, purchase_payload_hash: purchaseHash, last_error_code: null, reconciled_at: now },
    ` AND purchase_revision<=${Number(purchase.purchaseRevision)}`);
  if (!updated) {
    const current = (await intentById(row.id))!;
    if (current.purchase_revision > purchase.purchaseRevision) return;
    if (current.purchase_revision === purchase.purchaseRevision && current.purchase_payload_hash === purchaseHash) return;
    throw new CommerceError("PURCHASE_REVISION_CONFLICT", "Concurrent MKL reconciliation produced conflicting facts.", 409);
  }
}

function outcomeOf(row: PurchaseIntentRow): RecoveryOutcome {
  if (row.status === "reconciled") return "reconciled";
  if (row.status === "terminal") return "terminal";
  if (row.status === "reconciliation_required") return "reconciliation_required";
  if (row.status === "pending_payment") return "pending";
  return "authorization_required";
}

/** True when a failure is evidence about the purchase rather than about reaching MKL. */
function isAuthorityEvidence(error: unknown): boolean {
  if (error instanceof WalletError) return true;
  return error instanceof CommerceError && !error.transport && error.code !== "PURCHASE_REVISION_STALE";
}

/**
 * Handle an order whose MKL status contradicts local post-payment state (for
 * example pending or expired after payment was already verified). The intent
 * never moves backwards; received contradictory authority fences a lot.
 */
async function orderContradiction(row: PurchaseIntentRow, order: MklOrder, now: number) {
  const code = "ORDER_STATUS_CONTRADICTS_PAYMENT";
  if (row.purchase_kind === "consumable") await fenceConsumable(row, code, now, order.status);
  else await transition(row, "reconciliation_required", now, { last_error_code: code, order_status: order.status });
}

export async function recoverPurchaseIntent(input: { ownerId: string; purchaseId: string; now?: number }, fetcher: typeof fetch = fetch): Promise<{ intent: PublicPurchaseIntent; outcome: RecoveryOutcome }> {
  const now = input.now ?? Date.now(); let row = await getPurchaseIntent(input.ownerId, input.purchaseId);
  const done = async () => { row = (await intentById(row.id))!; return { intent: publicPurchaseIntent(row), outcome: outcomeOf(row) }; };
  if (!row.mkl_order_id) return { intent: publicPurchaseIntent(row), outcome: row.status === "terminal" ? "terminal" : "authorization_required" };
  // Final intents are history. They are never re-read into a lower state.
  if (row.status === "terminal" || (row.purchase_kind === "access" && row.status === "reconciled")) return { intent: publicPurchaseIntent(row), outcome: outcomeOf(row) };
  const config = commerceConfig(runtime()); const link = await requireLink(row.owner_id);
  if (link.id !== row.identity_link_id || link.organizationId !== row.organization_id) throw new CommerceError("PURCHASE_IDENTITY_CHANGED", "The purchase belongs to another MKL identity.", 409);
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET recovery_attempts=recovery_attempts+1,updated_at=? WHERE id=?").bind(now, row.id).run();
  const postPayment = !["checkout_pending", "pending_payment"].includes(row.status);
  try {
    const order = await readOrder(config, row.mkl_order_id, fetcher);
    if (order.orderNumber !== row.mkl_order_number) throw new CommerceError("ORDER_BINDING_CONFLICT", "MKL returned an order number inconsistent with the local intent.", 409);
    if (PENDING_ORDER_STATUSES.has(order.status)) {
      if (postPayment) await orderContradiction(row, order, now);
      else await transition(row, "pending_payment", now, { order_status: order.status, last_error_code: null });
      return await done();
    }
    if (UNPAID_FINAL_ORDER_STATUSES.has(order.status)) {
      if (postPayment) await orderContradiction(row, order, now);
      else await transition(row, "terminal", now, { order_status: order.status, terminal_reason: order.status, terminal_at: now, last_error_code: null });
      return await done();
    }
    if (!POST_PAYMENT_ORDER_STATUSES.has(order.status)) {
      // A status this release does not understand proves nothing: keep state,
      // keep the wallet, and leave evidence for retry after a TulisAI release.
      await noteError(row, "MKL_ORDER_STATUS_UNSUPPORTED", now, order.status);
      return { intent: publicPurchaseIntent((await intentById(row.id))!), outcome: "retry" };
    }
    const purchase = await readPurchase(config, row.mkl_order_id, fetcher);
    if (purchase.status !== order.status || purchase.paidAt !== order.paidAt || purchase.priceIdrSnapshot !== order.grossIdr) {
      throw new CommerceError("PURCHASE_ORDER_CONFLICT", "MKL order and purchase authority disagree.", 409);
    }
    if (row.purchase_kind === "access") await reconcileAccess(row, link, purchase, now);
    else await reconcileConsumable(row, link, purchase, now);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : "PURCHASE_RECONCILIATION_FAILED";
    if (error instanceof CommerceError && error.transport) {
      // No authority was received. Wallet and lifecycle stay exactly as they were.
      await noteError(row, code, now);
      return { intent: publicPurchaseIntent((await intentById(row.id))!), outcome: "retry" };
    }
    if (isAuthorityEvidence(error)) {
      const current = (await intentById(row.id))!;
      if (current.purchase_kind === "consumable") await fenceConsumable(current, code, now);
      else await transition(current, "reconciliation_required", now, { last_error_code: code.slice(0, 100) });
    }
    throw error;
  }
  return await done();
}
