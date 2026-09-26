import { getMklLinkByUserId } from "../identity/links";
import { runtime } from "../runtime";
import { hasFreshPaidAccess } from "./intents";
import { B5_PLAN_CODES, B5_PLAN_VERSION, B5_PRODUCTS, CommerceError, checkoutEnabled, commerceConfig, discoverOffers,
  type B5PlanCode, type MklOffer, type PurchaseKind } from "./mkl-client";

/**
 * What the buyer may do with one product right now, in the order the purchase
 * path would refuse it. The UI renders this; it never decides it.
 *
 * - `checkout_closed`: TulisAI's own switch for new purchases is off.
 * - `not_configured`: this deployment has no MKL application credentials.
 * - `mkl_unavailable`: MKL's catalog could not be read; nothing is known.
 * - `unavailable`: MKL has no offer for it, or one that breaks the locked contract.
 * - `link_required`: purchases are bound to a linked MKL identity.
 * - `purchase_open`: a purchase of this kind is already in progress.
 * - `active_access`: paid access is active; there is no early renewal or switch.
 * - `paid_access_required`: top-ups need active Plus, Pro or Max.
 */
export type OfferState = "available" | "checkout_closed" | "not_configured" | "mkl_unavailable" | "unavailable" |
  "link_required" | "purchase_open" | "active_access" | "paid_access_required";

export type CatalogProduct = {
  planCode: B5PlanCode; planVersion: typeof B5_PLAN_VERSION; kind: PurchaseKind; characters: number;
  /** MKL's price once MKL has offered it; before that, the locked contract price. They are equal whenever an offer is valid. */
  priceIdr: number; state: OfferState; openPurchaseId: string | null;
};
export type CommerceCatalog = { checkoutOpen: boolean; products: CatalogProduct[] };

// Mirrors the partial unique indexes in 0014: while one of these exists, a new
// purchase of the same kind is refused. An unbound `created` intent is not
// listed because a deliberate new purchase supersedes it.
const OPEN_STATUSES: Record<PurchaseKind, readonly string[]> = {
  access: ["checkout_pending", "pending_payment", "paid_awaiting_authority", "reconciling", "reconciliation_required"],
  consumable: ["checkout_pending", "pending_payment", "paid_awaiting_authority"],
};

function baseProducts(): CatalogProduct[] {
  return B5_PLAN_CODES.map((planCode) => {
    const product = B5_PRODUCTS[planCode];
    return { planCode, planVersion: B5_PLAN_VERSION, kind: product.kind, characters: "quantity" in product ? product.quantity : product.includedCharacters,
      priceIdr: product.lockedPriceIdr, state: "available", openPurchaseId: null };
  });
}

async function openPurchases(ownerId: string): Promise<Array<{ id: string; purchase_kind: PurchaseKind; status: string }>> {
  const rows = await runtime().DB.prepare(`SELECT id,purchase_kind,status FROM mkl_purchase_intents WHERE owner_id=?
    AND status IN ('checkout_pending','pending_payment','paid_awaiting_authority','reconciling','reconciliation_required')
    ORDER BY created_at DESC,id DESC`).bind(ownerId).all<{ id: string; purchase_kind: PurchaseKind; status: string }>();
  return (rows.results ?? []).filter((row) => OPEN_STATUSES[row.purchase_kind].includes(row.status));
}

export async function commerceCatalog(ownerId: string, now = Date.now(), fetcher: typeof fetch = fetch): Promise<CommerceCatalog> {
  const env = runtime(); const products = baseProducts();
  const all = (state: OfferState): CommerceCatalog => ({ checkoutOpen: state !== "checkout_closed", products: products.map((product) => ({ ...product, state })) });
  if (!checkoutEnabled(env)) return all("checkout_closed");

  let offers: Record<B5PlanCode, MklOffer | CommerceError>;
  try { offers = await discoverOffers(commerceConfig(env), fetcher); }
  catch (error) {
    if (error instanceof CommerceError) return all(error.code === "MKL_COMMERCE_NOT_CONFIGURED" ? "not_configured" : "mkl_unavailable");
    throw error;
  }

  const link = await getMklLinkByUserId(ownerId); const linked = Boolean(link?.organizationId);
  const [active, open] = linked ? await Promise.all([hasFreshPaidAccess(ownerId, now), openPurchases(ownerId)]) : [false, []];
  return {
    checkoutOpen: true,
    products: products.map((product): CatalogProduct => {
      const offer = offers[product.planCode];
      if (offer instanceof CommerceError) return { ...product, state: "unavailable" };
      const priced = { ...product, priceIdr: offer.priceIdr };
      if (!linked) return { ...priced, state: "link_required" };
      const pending = open.find((row) => row.purchase_kind === product.kind);
      if (pending) return { ...priced, state: "purchase_open", openPurchaseId: pending.id };
      if (product.kind === "access" && active) return { ...priced, state: "active_access" };
      if (product.kind === "consumable" && !active) return { ...priced, state: "paid_access_required" };
      return { ...priced, state: "available" };
    }),
  };
}
