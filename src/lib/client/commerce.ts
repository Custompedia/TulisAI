import { authRequest, request } from './api';

// Mirrors of the server's public shapes (src/server/commerce/catalog.ts and
// intents.ts). Client code never imports server modules; the B6 review test
// pins these to the server types so they cannot drift.
export type OfferState = 'available' | 'checkout_closed' | 'not_configured' | 'mkl_unavailable' | 'unavailable' |
  'link_required' | 'purchase_open' | 'active_access' | 'paid_access_required';
export type PlanCode = 'plus' | 'pro' | 'max' | 'topup_15k' | 'topup_45k' | 'topup_100k';
export type PurchaseKind = 'access' | 'consumable';
export type CatalogProduct = { planCode: PlanCode; planVersion: 'pricing-v1'; kind: PurchaseKind; characters: number; priceIdr: number; state: OfferState; openPurchaseId: string | null };
export type CommerceCatalog = { checkoutOpen: boolean; products: CatalogProduct[] };
export type PurchaseIntent = {
  purchaseId: string; kind: PurchaseKind; planCode: PlanCode; planVersion: string; offerId: string; offeredPriceIdr: number;
  status: string; orderId: string | null; orderNumber: string | null; checkoutUrl: string | null; orderStatus: string | null;
  fulfillmentId: string | null; purchaseRevision: number; lastErrorCode: string | null; terminalReason: string | null; createdAt: number; updatedAt: number;
  authorizationRequired: boolean;
};
export type RecoveryOutcome = 'authorization_required' | 'pending' | 'terminal' | 'reconciled' | 'reconciliation_required' | 'retry';

type T = (id: string, en: string) => string;
export type Tone = 'info' | 'success' | 'warning' | 'error';

export const loadCatalog = () => request<CommerceCatalog>('/api/commerce/offers');
export const listPurchases = () => request<PurchaseIntent[]>('/api/commerce/intents');
/** Asks MKL again through the owner-scoped recovery route; the only source of a purchase's status. */
export const recoverPurchase = (purchaseId: string) => request<{ intent: PurchaseIntent; outcome: RecoveryOutcome }>(`/api/commerce/intents/${encodeURIComponent(purchaseId)}`);

/**
 * Starts the MKL sign-in that binds a purchase to the buyer and opens MKL's
 * checkout. Resolves to the MKL authorization URL the browser must visit.
 */
export async function authorizePurchase(purchaseId: string): Promise<string> {
  const { url } = await authRequest<{ url: string }>('/mkl/commerce/start', { purchaseId, returnTo: '/app' });
  return url;
}

/**
 * Creates (or, for the same key, replays) the purchase intent and returns the
 * MKL URL to continue at. The key must stay the same across retries of one
 * deliberate purchase, so a double click or a retry never opens two orders.
 */
export async function beginPurchase(product: Pick<CatalogProduct, 'kind' | 'planCode' | 'planVersion'>, buyerPhone: string, idempotencyKey: string): Promise<string> {
  const { intent } = await request<{ intent: PurchaseIntent; created: boolean }>('/api/commerce/intents', 'POST',
    { kind: product.kind, planCode: product.planCode, planVersion: product.planVersion, buyerPhone: buyerPhone.trim() }, idempotencyKey);
  return authorizePurchase(intent.purchaseId);
}

/** The same shape the server accepts; a friendlier early message, never the authority. */
export const phoneLooksValid = (value: string) => { const phone = value.trim(); return phone.replace(/\D/g, '').length >= 8 && phone.length <= 32 && /^[0-9+(). -]+$/.test(phone); };

const PLAN_NAMES: Record<PlanCode, string> = { plus: 'Plus', pro: 'Pro', max: 'Max', topup_15k: '15.000', topup_45k: '45.000', topup_100k: '100.000' };
export const productName = (planCode: PlanCode, t: T) => planCode.startsWith('topup_')
  ? t(`Tambahan ${PLAN_NAMES[planCode]} karakter`, `${PLAN_NAMES[planCode].replace('.', ',')} character top-up`) : `TulisAI ${PLAN_NAMES[planCode]}`;

/** What the buy control says when it cannot buy. `null` means the product can be bought now. */
export function blockedLabel(state: OfferState, t: T): string | null {
  switch (state) {
    case 'available': return null;
    case 'checkout_closed': return t('Pembelian belum dibuka', 'Purchases are not open yet');
    case 'not_configured': case 'unavailable': return t('Belum tersedia', 'Not available yet');
    case 'mkl_unavailable': return t('MKL sedang tidak terjangkau', 'MKL is unreachable right now');
    case 'link_required': return t('Tautkan akun MKL untuk membeli', 'Link your MKL account to buy');
    case 'purchase_open': return t('Ada pembelian yang belum selesai', 'A purchase is still in progress');
    case 'active_access': return t('Bisa dibeli setelah paket aktif berakhir', 'Available after your current plan ends');
    case 'paid_access_required': return t('Butuh paket Plus, Pro, atau Max aktif', 'Needs an active Plus, Pro, or Max plan');
  }
}

/** A purchase's status in the buyer's words. Only MKL-verified states ever read as done. */
export function purchaseStatus(intent: Pick<PurchaseIntent, 'kind' | 'status' | 'terminalReason' | 'orderStatus'>, t: T): { label: string; tone: Tone } {
  switch (intent.status) {
    case 'created': return { label: t('Menunggu masuk ke MKL', 'Waiting for MKL sign-in'), tone: 'info' };
    case 'checkout_pending': return { label: t('Menyiapkan pembayaran', 'Preparing payment'), tone: 'info' };
    case 'pending_payment': return { label: t('Menunggu pembayaran', 'Waiting for payment'), tone: 'info' };
    case 'paid_awaiting_authority': return { label: t('Dibayar — menunggu konfirmasi MKL', 'Paid — waiting for MKL confirmation'), tone: 'info' };
    case 'reconciling': return { label: t('Dibayar — sedang diproses', 'Paid — being applied'), tone: 'info' };
    case 'reconciled': return intent.kind === 'access'
      ? { label: t('Paket aktif', 'Plan active'), tone: 'success' } : { label: t('Karakter ditambahkan', 'Characters added'), tone: 'success' };
    case 'reconciliation_required': return { label: t('Perlu dicocokkan ulang dengan MKL', 'Needs another check with MKL'), tone: 'warning' };
    case 'terminal':
      if (intent.terminalReason === 'superseded_by_new_intent') return { label: t('Digantikan pembelian baru', 'Replaced by a newer purchase'), tone: 'info' };
      if (intent.terminalReason === 'offer_changed') return { label: t('Ditutup: penawaran berubah', 'Closed: the offer changed'), tone: 'warning' };
      if (intent.terminalReason === 'order_charged_back') return { label: t('Ditutup: pembayaran ditarik kembali', 'Closed: the payment was reversed'), tone: 'warning' };
      return { label: t('Tidak selesai', 'Not completed'), tone: 'warning' };
    default: return { label: t('Status belum dikenal', 'Unknown status'), tone: 'warning' };
  }
}

/** The notice after MKL sends the buyer back, from the server's re-read outcome, never from the URL. */
export function outcomeNotice(outcome: RecoveryOutcome, kind: PurchaseKind, t: T): { tone: Tone; title: string; message: string } {
  switch (outcome) {
    case 'reconciled': return kind === 'access'
      ? { tone: 'success', title: t('Pembayaran berhasil', 'Payment complete'), message: t('Paketmu sudah aktif untuk periode yang dicatat MKL.', 'Your plan is active for the period MKL recorded.') }
      : { tone: 'success', title: t('Pembayaran berhasil', 'Payment complete'), message: t('Karakter tambahan sudah masuk ke saldo AI-mu.', 'The extra characters are now in your AI balance.') };
    case 'pending': return { tone: 'info', title: t('Menunggu konfirmasi pembayaran', 'Waiting for payment confirmation'), message: t('MKL belum mencatat pembayaran ini sebagai lunas. Paket dan kuotamu berubah hanya setelah MKL mengonfirmasi.', 'MKL has not recorded this payment as paid yet. Your plan and allowance change only after MKL confirms it.') };
    case 'authorization_required': return { tone: 'info', title: t('Masuk ke MKL untuk melanjutkan', 'Sign in to MKL to continue'), message: t('Pembelian ini perlu kamu lanjutkan lewat MKL sebelum bisa dibayar atau diterapkan.', 'Continue this purchase through MKL before it can be paid for or applied.') };
    case 'reconciliation_required': return { tone: 'warning', title: t('Perlu dicocokkan ulang', 'Needs another check'), message: t('Pembayaran tercatat, tetapi datanya belum cocok dengan MKL. Paket dan kuotamu belum diubah; periksa lagi nanti.', 'The payment is recorded but does not match MKL yet. Your plan and allowance are unchanged; check again later.') };
    case 'terminal': return { tone: 'warning', title: t('Pembelian tidak selesai', 'Purchase not completed'), message: t('Pembelian ini sudah ditutup dan tidak mengubah paket atau kuotamu.', 'This purchase is closed and did not change your plan or allowance.') };
    case 'retry': return { tone: 'warning', title: t('Status belum terbaca', 'Status not read yet'), message: t('MKL belum bisa dibaca sekarang. Tidak ada yang berubah; periksa lagi sebentar lagi.', 'MKL could not be read right now. Nothing changed; check again shortly.') };
  }
}

/** Polling after a return stops on anything MKL has already decided. */
export const isSettledOutcome = (outcome: RecoveryOutcome) => outcome === 'reconciled' || outcome === 'terminal' || outcome === 'reconciliation_required';
