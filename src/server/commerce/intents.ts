import type { MklIdentity } from "../auth/mkl-oidc";
import { getMklLinkByUserId, type ExternalIdentityLink } from "../identity/links";
import { refreshMklAuthority } from "../entitlements/authority";
import { runtime } from "../runtime";
import {
  acceptVerifiedPurchasedLot, applyVerifiedLotCorrection, markPurchasedLotReconciliationRequired, restoreVerifiedPurchasedLot,
} from "../usage/wallet";
import {
  B5_PLAN_VERSION, CommerceError, canonicalOffer, commerceConfig, discoverOffer, productContract, readOrder, readPurchase,
  sha256Canonical, startCheckout, type B5PlanCode, type MklOffer, type MklPurchase, type PurchaseKind,
} from "./mkl-client";

const TERMINAL_ORDER_STATUSES = new Set(["expired", "cancelled", "failed"]);
const SETTLEMENT_ORDER_STATUSES = new Set(["paid", "charged_back"]);
const OPEN_INTENT_STATUSES = new Set(["created", "checkout_pending", "pending_payment", "paid_awaiting_authority", "reconciling", "reconciliation_required"]);

export type PurchaseIntentRow = {
  id: string; owner_id: string; identity_link_id: string; organization_id: string; purchase_kind: PurchaseKind;
  plan_code: B5PlanCode; plan_version: string; offer_id: string; offer_contract_json: string; offer_contract_hash: string;
  client_request_key_hash: string; request_fingerprint: string; mkl_idempotency_key: string; buyer_phone: string; return_uri: string;
  mkl_order_id: string | null; mkl_order_number: string | null; checkout_url: string | null; order_status: string | null; status: string;
  fulfillment_id: string | null; lot_id: string | null; purchase_revision: number; purchase_payload_hash: string | null;
  authorization_attempts: number; recovery_attempts: number; last_error_code: string | null; terminal_reason: string | null;
  created_at: number; updated_at: number; order_bound_at: number | null; reconciled_at: number | null; terminal_at: number | null;
};

export type PublicPurchaseIntent = {
  purchaseId: string; kind: PurchaseKind; planCode: B5PlanCode; planVersion: string; offerId: string; offeredPriceIdr: number;
  status: string; orderId: string | null; orderNumber: string | null; checkoutUrl: string | null; orderStatus: string | null;
  fulfillmentId: string | null; purchaseRevision: number; lastErrorCode: string | null; createdAt: number; updatedAt: number;
  authorizationRequired: boolean;
};

const intentById = (id: string) => runtime().DB.prepare("SELECT * FROM mkl_purchase_intents WHERE id=?").bind(id).first<PurchaseIntentRow>();
const intentByRequest = (ownerId: string, keyHash: string) => runtime().DB.prepare("SELECT * FROM mkl_purchase_intents WHERE owner_id=? AND client_request_key_hash=?").bind(ownerId, keyHash).first<PurchaseIntentRow>();

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
    purchaseRevision: row.purchase_revision, lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at,
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

type Projection = { identity_link_id: string; entitlement_id: string | null; plan_code: string | null; plan_version: string | null; access_deadline: string | null; fresh_until: number; invalidated_at: number | null; status: string | null };
async function projection(ownerId: string): Promise<Projection | null> {
  return await runtime().DB.prepare(`SELECT identity_link_id,entitlement_id,plan_code,plan_version,access_deadline,fresh_until,invalidated_at,status
    FROM mkl_entitlement_projection WHERE user_id=?`).bind(ownerId).first<Projection>() ?? null;
}
function isFreshActive(row: Projection | null, now = Date.now()): row is Projection {
  return Boolean(row && row.invalidated_at === null && row.status === "active" && row.entitlement_id && row.plan_version === B5_PLAN_VERSION &&
    ["plus", "pro", "max"].includes(row.plan_code ?? "") && row.fresh_until > now && row.access_deadline && Date.parse(row.access_deadline) > now);
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
  const link = await requireLink(input.ownerId); await assertEligibility(input.ownerId, input.kind, now);
  const config = commerceConfig(runtime()); const offer = await discoverOffer(config, product.planCode, product.planVersion, fetcher);
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
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET authorization_attempts=authorization_attempts+1,updated_at=? WHERE id=? AND owner_id=?")
    .bind(now, purchaseId, ownerId).run();
  return (await intentById(purchaseId))!;
}

function identityMatches(link: ExternalIdentityLink, identity: MklIdentity, row: PurchaseIntentRow): boolean {
  return link.id === row.identity_link_id && link.issuer === identity.issuer && link.subject === identity.subject &&
    link.organizationId === identity.organizationId && row.organization_id === identity.organizationId;
}

async function recordError(row: PurchaseIntentRow, code: string, status = row.status, now = Date.now()) {
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET status=?,last_error_code=?,updated_at=? WHERE id=? AND owner_id=?")
    .bind(status, code.slice(0, 100), now, row.id, row.owner_id).run();
}

export async function authorizePurchaseIntent(input: { ownerId: string; purchaseId: string; identity: MklIdentity; idToken: string; now?: number }, fetcher: typeof fetch = fetch): Promise<{ redirectUrl: string; intent: PublicPurchaseIntent }> {
  const now = input.now ?? Date.now(); let row = await getPurchaseIntent(input.ownerId, input.purchaseId); const link = await requireLink(input.ownerId);
  if (!identityMatches(link, input.identity, row)) {
    await recordError(row, "PURCHASE_IDENTITY_MISMATCH", row.status, now);
    throw new CommerceError("PURCHASE_IDENTITY_MISMATCH", "The verified MKL identity does not match this purchase.", 403);
  }
  if (!input.identity.email || !input.identity.emailVerified) throw new CommerceError("MKL_PROFILE_INCOMPLETE", "MKL must provide a verified buyer email.", 409);
  await refreshMklAuthority(input.ownerId, link, input.idToken, fetcher);
  if (row.mkl_order_id) {
    const recovered = await recoverPurchaseIntent({ ownerId: input.ownerId, purchaseId: row.id, idToken: input.idToken, now }, fetcher);
    row = await getPurchaseIntent(input.ownerId, row.id);
    return { redirectUrl: recovered.intent.checkoutUrl ?? new URL(`/app?purchase=${encodeURIComponent(row.id)}`, commerceConfig(runtime()).returnUri).toString(), intent: recovered.intent };
  }
  await assertEligibility(input.ownerId, row.purchase_kind, now);
  const config = commerceConfig(runtime()); const liveOffer = await discoverOffer(config, row.plan_code, row.plan_version, fetcher);
  const liveHash = await sha256Canonical(canonicalOffer(liveOffer));
  if (liveOffer.offerId !== row.offer_id || liveHash !== row.offer_contract_hash) {
    await runtime().DB.prepare(`UPDATE mkl_purchase_intents SET status='terminal',last_error_code='OFFER_CHANGED',terminal_reason='offer_changed',terminal_at=?,updated_at=?
      WHERE id=? AND owner_id=? AND mkl_order_id IS NULL`).bind(now, now, row.id, row.owner_id).run();
    throw new CommerceError("OFFER_CHANGED", "The MKL offer changed after this purchase intent was created. Start a deliberate new intent.", 409);
  }
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET status='checkout_pending',last_error_code=NULL,updated_at=? WHERE id=? AND owner_id=? AND mkl_order_id IS NULL")
    .bind(now, row.id, row.owner_id).run();
  let checkout: Awaited<ReturnType<typeof startCheckout>>;
  try {
    checkout = await startCheckout(config, { idToken: input.idToken, offerId: row.offer_id, buyerName: input.identity.name || input.identity.email.split("@")[0] || "MKL user",
      buyerEmail: input.identity.email, buyerPhone: row.buyer_phone, idempotencyKey: row.mkl_idempotency_key }, fetcher);
  } catch (error) {
    await recordError(row, error instanceof CommerceError ? error.code : "MKL_CHECKOUT_FAILED", "created", now);
    throw error;
  }
  await runtime().DB.prepare(`UPDATE mkl_purchase_intents SET mkl_order_id=?,mkl_order_number=?,checkout_url=?,order_status='pending_payment',
    status='pending_payment',order_bound_at=?,last_error_code=NULL,updated_at=? WHERE id=? AND owner_id=? AND mkl_order_id IS NULL`)
    .bind(checkout.orderId, checkout.orderNumber, checkout.checkoutUrl, now, now, row.id, row.owner_id).run();
  const bound = await getPurchaseIntent(row.owner_id, row.id);
  if (bound.mkl_order_id !== checkout.orderId || bound.mkl_order_number !== checkout.orderNumber || bound.checkout_url !== checkout.checkoutUrl) {
    await recordError(bound, "ORDER_BINDING_CONFLICT", "reconciliation_required", now);
    throw new CommerceError("ORDER_BINDING_CONFLICT", "The stable MKL idempotency key returned conflicting orders.", 409);
  }
  return { redirectUrl: bound.checkout_url!, intent: publicPurchaseIntent(bound) };
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

async function reconcileAccess(row: PurchaseIntentRow, link: ExternalIdentityLink, purchase: MklPurchase, idToken: string | undefined, now: number, fetcher: typeof fetch) {
  assertPurchaseBinding(row, purchase, link);
  if (!purchase.paidAt) throw new CommerceError("PURCHASE_NOT_PAID", "MKL has not confirmed payment.", 409);
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET status='paid_awaiting_authority',order_status=?,last_error_code=NULL,updated_at=? WHERE id=?")
    .bind(purchase.status, now, row.id).run();
  if (!idToken) return;
  await refreshMklAuthority(row.owner_id, link, idToken, fetcher);
  const current = await projection(row.owner_id);
  if (!isFreshActive(current, now) || current.plan_code !== row.plan_code || current.plan_version !== row.plan_version) {
    await recordError(row, "ACCESS_AUTHORITY_NOT_OBSERVED", "reconciliation_required", now);
    throw new CommerceError("ACCESS_AUTHORITY_NOT_OBSERVED", "The paid order is not yet present in MKL entitlement authority.", 409);
  }
  await runtime().DB.prepare(`UPDATE mkl_purchase_intents SET status='reconciled',order_status=?,last_error_code=NULL,reconciled_at=?,updated_at=? WHERE id=?`)
    .bind(purchase.status, now, now, row.id).run();
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

async function reconcileConsumable(row: PurchaseIntentRow, link: ExternalIdentityLink, purchase: MklPurchase, now: number): Promise<void> {
  assertPurchaseBinding(row, purchase, link);
  if (!purchase.correctionsComplete) {
    if (row.lot_id) await markPurchasedLotReconciliationRequired(row.owner_id, row.lot_id, "mkl_corrections_incomplete", now);
    await recordError(row, "PURCHASE_CORRECTIONS_INCOMPLETE", "reconciliation_required", now);
    return;
  }
  completeConsumable(row, purchase, link);
  const product = productContract(row.plan_code, row.plan_version, "consumable");
  if (!("quantity" in product)) throw new CommerceError("PURCHASE_PRODUCT_MISMATCH", "The verified purchase is not a top-up.", 409);
  const purchaseHash = await sha256Canonical(canonicalPurchase(purchase));
  if (purchase.purchaseRevision < row.purchase_revision) throw new CommerceError("PURCHASE_REVISION_STALE", "An older MKL purchase revision was rejected.", 409);
  if (purchase.purchaseRevision === row.purchase_revision && row.purchase_payload_hash && row.purchase_payload_hash !== purchaseHash) {
    await recordError(row, "PURCHASE_REVISION_CONFLICT", "reconciliation_required", now);
    throw new CommerceError("PURCHASE_REVISION_CONFLICT", "The same MKL purchase revision contained different facts.", 409);
  }
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET status='reconciling',last_error_code=NULL,updated_at=? WHERE id=? AND purchase_revision<=?")
    .bind(now, row.id, purchase.purchaseRevision).run();
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
  const updated = await runtime().DB.prepare(`UPDATE mkl_purchase_intents SET status='reconciled',order_status=?,fulfillment_id=?,lot_id=?,
    purchase_revision=?,purchase_payload_hash=?,last_error_code=NULL,reconciled_at=?,updated_at=?
    WHERE id=? AND purchase_revision<=?`).bind(purchase.status, purchase.fulfillmentId, lotId, purchase.purchaseRevision, purchaseHash, now, now, row.id, purchase.purchaseRevision).run();
  if ((updated.meta.changes ?? 0) !== 1) {
    const current = (await intentById(row.id))!;
    if (current.purchase_revision > purchase.purchaseRevision) return;
    if (current.purchase_revision === purchase.purchaseRevision && current.purchase_payload_hash === purchaseHash) return;
    throw new CommerceError("PURCHASE_REVISION_CONFLICT", "Concurrent MKL reconciliation produced conflicting facts.", 409);
  }
}

export async function recoverPurchaseIntent(input: { ownerId: string; purchaseId: string; idToken?: string; now?: number }, fetcher: typeof fetch = fetch): Promise<{ intent: PublicPurchaseIntent; outcome: "authorization_required" | "pending" | "terminal" | "reconciled" | "reconciliation_required" }> {
  const now = input.now ?? Date.now(); let row = await getPurchaseIntent(input.ownerId, input.purchaseId);
  if (!row.mkl_order_id) return { intent: publicPurchaseIntent(row), outcome: "authorization_required" };
  const config = commerceConfig(runtime()); const link = await requireLink(row.owner_id);
  if (link.id !== row.identity_link_id || link.organizationId !== row.organization_id) throw new CommerceError("PURCHASE_IDENTITY_CHANGED", "The purchase belongs to another MKL identity.", 409);
  await runtime().DB.prepare("UPDATE mkl_purchase_intents SET recovery_attempts=recovery_attempts+1,updated_at=? WHERE id=?").bind(now, row.id).run();
  const order = await readOrder(config, row.mkl_order_id, fetcher);
  if (order.orderNumber !== row.mkl_order_number) throw new CommerceError("ORDER_BINDING_CONFLICT", "MKL returned an order number inconsistent with the local intent.", 409);
  if (TERMINAL_ORDER_STATUSES.has(order.status)) {
    await runtime().DB.prepare(`UPDATE mkl_purchase_intents SET status='terminal',order_status=?,terminal_reason=?,terminal_at=?,updated_at=?,last_error_code=NULL WHERE id=?`)
      .bind(order.status, order.status, now, now, row.id).run();
    row = (await intentById(row.id))!; return { intent: publicPurchaseIntent(row), outcome: "terminal" };
  }
  if (!SETTLEMENT_ORDER_STATUSES.has(order.status)) {
    await runtime().DB.prepare("UPDATE mkl_purchase_intents SET status='pending_payment',order_status=?,updated_at=?,last_error_code=NULL WHERE id=?")
      .bind(order.status, now, row.id).run();
    row = (await intentById(row.id))!; return { intent: publicPurchaseIntent(row), outcome: "pending" };
  }
  try {
    const purchase = await readPurchase(config, row.mkl_order_id, fetcher);
    if (purchase.status !== order.status || purchase.paidAt !== order.paidAt || purchase.priceIdrSnapshot !== order.grossIdr) {
      throw new CommerceError("PURCHASE_ORDER_CONFLICT", "MKL order and purchase authority disagree.", 409);
    }
    if (row.purchase_kind === "access") await reconcileAccess(row, link, purchase, input.idToken, now, fetcher);
    else await reconcileConsumable(row, link, purchase, now);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : "PURCHASE_RECONCILIATION_FAILED";
    const mustFence = code !== "MKL_UNAVAILABLE" && code !== "PURCHASE_REVISION_STALE" && code !== "ACCESS_AUTHORITY_NOT_OBSERVED";
    if (row.purchase_kind === "consumable" && row.lot_id && mustFence) {
      await markPurchasedLotReconciliationRequired(row.owner_id, row.lot_id, code.toLowerCase(), now);
      await recordError(row, code, "reconciliation_required", now);
    }
    throw error;
  }
  row = (await intentById(row.id))!;
  const outcome = row.status === "reconciled" ? "reconciled" : row.status === "reconciliation_required" ? "reconciliation_required" : "authorization_required";
  return { intent: publicPurchaseIntent(row), outcome };
}
