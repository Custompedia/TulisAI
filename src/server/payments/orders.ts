import { PLAN_LIMITS, TOP_UPS, TOP_UP_VALIDITY_MONTHS, type TopUp } from "@/lib/plans";
import { writeAudit } from "../audit";
import { RequestError } from "../http";
import { runtime, type RuntimeEnv } from "../runtime";
import { addCalendarMonths, LOCAL_APP_KEY, LOCAL_PLAN_VERSION, periodInsertStatement, planState, type PaidPlan } from "../access/periods";
import { applyVerifiedLotCorrection } from "../usage/wallet";
import { CHARACTER_MEASUREMENT_VERSION } from "../usage/measurement";
import {
  createSnapTransaction, getTransactionStatus, midtransConfig, MidtransError, paymentOutcome, verifyNotificationSignature,
  type MidtransConfig, type MidtransStatus,
} from "./midtrans";

// Direct payments after Mari Rekap (src/lib/payments/orders.ts). The browser
// only ever names what to buy; price, quantity and grant come from the server,
// and a grant only follows a status read back from Midtrans itself.

export const ORDER_EXPIRY_HOURS = 24;
// A renewal may be bought ahead, but never more than a year ahead.
const MAX_PAID_AHEAD_MS = 366 * 86_400_000;
export type PackCode = TopUp["id"];
export type OrderKind = "plan" | "topup";
export type OrderStatus = "pending" | "paid" | "failed" | "expired" | "cancelled" | "refunded";

export type OrderRow = {
  id: string; user_id: string; kind: OrderKind; plan_code: PaidPlan | null; pack_code: PackCode | null; characters: number; amount_idr: number;
  provider_mode: "sandbox" | "production"; status: OrderStatus; snap_token: string | null; redirect_url: string | null;
  transaction_id: string | null; payment_type: string | null; provider_status: string | null; created_at: number; updated_at: number;
  expires_at: number; paid_at: number | null; fulfilled_at: number | null; fulfillment_token: string | null;
  fulfillment_outcome: "granted" | "needs_operator" | null; access_period_id: string | null; lot_id: string | null; refund_handled_at: number | null;
};

export type PublicOrder = {
  id: string; kind: OrderKind; plan: PaidPlan | null; pack: PackCode | null; characters: number; amountIdr: number;
  mode: "sandbox" | "production"; status: OrderStatus; granted: boolean; needsOperator: boolean;
  payUrl: string | null; createdAt: string; expiresAt: string; paidAt: string | null;
};

export function publicOrder(row: OrderRow, now = Date.now()): PublicOrder {
  return {
    id: row.id, kind: row.kind, plan: row.plan_code, pack: row.pack_code, characters: row.characters, amountIdr: row.amount_idr,
    mode: row.provider_mode, status: row.status, granted: row.fulfillment_outcome === "granted", needsOperator: row.fulfillment_outcome === "needs_operator",
    payUrl: row.status === "pending" && row.expires_at > now ? row.redirect_url : null,
    createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), paidAt: row.paid_at === null ? null : new Date(row.paid_at).toISOString(),
  };
}

/** Tulis Lab's own switch for new checkouts. Status refresh, notifications and refund handling ignore it. */
export function checkoutEnabled(env: RuntimeEnv): boolean {
  return env.TULISAI_COMMERCE_CHECKOUT_ENABLED?.trim() === "true";
}

const PAYMENTS_CLOSED = () => new RequestError("PAYMENTS_CLOSED", "Pembayaran belum dibuka. Paket dan kuota yang sudah kamu punya tetap berlaku.", 409);

function requireConfig(): MidtransConfig {
  const config = midtransConfig(runtime());
  if (!config) throw PAYMENTS_CLOSED();
  return config;
}

function newOrderId(now: number): string {
  const day = new Date(now).toISOString().slice(0, 10).replaceAll("-", "");
  return `TA-${day}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

const orderById = (id: string) => runtime().DB.prepare("SELECT * FROM payment_orders WHERE id=?").bind(id).first<OrderRow>();

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runBatch(statements: D1PreparedStatement[]) {
  const db = runtime().DB;
  if (typeof db.batch === "function") return db.batch(statements);
  const results = [];
  for (const statement of statements) results.push(await statement.run());
  return results;
}

export type CheckoutInput = { kind: "plan"; plan: PaidPlan } | { kind: "topup"; pack: PackCode };
export type Buyer = { id: string; name: string; email: string };

export async function createCheckout(buyer: Buyer, input: CheckoutInput, now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ order: PublicOrder; reused: boolean }> {
  if (!checkoutEnabled(runtime())) throw PAYMENTS_CLOSED();
  const config = requireConfig();
  const state = await planState(buyer.id, now);
  let item: { kind: OrderKind; plan: PaidPlan | null; pack: PackCode | null; characters: number; amount: number; name: string };
  if (input.kind === "plan") {
    if (state.current && state.current.plan_code !== input.plan) {
      throw new RequestError("PLAN_ACTIVE", "Paket lain masih berjalan. Paket bisa diganti setelah periodenya berakhir.", 409, { current: state.current.plan_code, until: state.paidThrough });
    }
    if (state.paidThrough && Date.parse(state.paidThrough) - now > MAX_PAID_AHEAD_MS) throw new RequestError("RENEWAL_LIMIT", "Paket sudah dibayar lebih dari setahun ke depan.", 409);
    const limits = PLAN_LIMITS[input.plan];
    item = { kind: "plan", plan: input.plan, pack: null, characters: limits.includedCharacters, amount: limits.priceIdr, name: `Tulis Lab ${input.plan[0]!.toUpperCase()}${input.plan.slice(1)} 1 bulan` };
  } else {
    // Top-ups only extend a paid plan (B0): they never grant features or a tier.
    if (!state.current) throw new RequestError("PAID_PLAN_REQUIRED", "Tambahan karakter hanya untuk paket Plus, Pro, atau Max yang sedang aktif.", 409);
    const pack = TOP_UPS.find((candidate) => candidate.id === input.pack);
    if (!pack) throw new RequestError("PACK_UNAVAILABLE", "Paket tambahan ini tidak tersedia.", 400);
    item = { kind: "topup", plan: null, pack: pack.id, characters: pack.characters, amount: pack.priceIdr, name: `Tulis Lab tambahan ${pack.characters.toLocaleString("id-ID")} karakter` };
  }

  // Reuse an unpaid order for the same thing instead of creating a second payable one.
  const reusable = await runtime().DB.prepare(`SELECT * FROM payment_orders WHERE user_id=? AND status='pending' AND kind=? AND provider_mode=?
    AND COALESCE(plan_code,'')=? AND COALESCE(pack_code,'')=? AND amount_idr=? AND expires_at>? AND redirect_url IS NOT NULL
    ORDER BY created_at DESC LIMIT 1`).bind(buyer.id, item.kind, config.mode, item.plan ?? "", item.pack ?? "", item.amount, now + 60_000).first<OrderRow>();
  if (reusable) return { order: publicOrder(reusable, now), reused: true };

  const id = newOrderId(now); const expiresAt = now + ORDER_EXPIRY_HOURS * 3_600_000;
  await runtime().DB.prepare(`INSERT INTO payment_orders (id,user_id,kind,plan_code,pack_code,characters,amount_idr,provider_mode,status,created_at,updated_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`).bind(id, buyer.id, item.kind, item.plan, item.pack, item.characters, item.amount, config.mode, now, now, expiresAt).run();
  let snap: { token: string; redirectUrl: string };
  try {
    snap = await createSnapTransaction(config, {
      orderId: id, amountIdr: item.amount, itemId: item.plan ?? item.pack!, itemName: item.name, customer: { name: buyer.name, email: buyer.email },
      finishUrl: `${config.appUrl}/billing/return?order=${encodeURIComponent(id)}`, expiryHours: ORDER_EXPIRY_HOURS,
    }, fetcher);
  } catch {
    await runtime().DB.prepare("UPDATE payment_orders SET status='failed',provider_status='snap_unavailable',updated_at=? WHERE id=? AND status='pending'").bind(now, id).run();
    throw new RequestError("PAYMENT_PAGE_UNAVAILABLE", "Halaman pembayaran belum bisa dibuka. Coba lagi sebentar lagi.", 502);
  }
  await runtime().DB.prepare("UPDATE payment_orders SET snap_token=?,redirect_url=?,updated_at=? WHERE id=?").bind(snap.token, snap.redirectUrl, now, id).run();
  return { order: publicOrder((await orderById(id))!, now), reused: false };
}

/** Grant the paid order exactly once. Every statement is conditioned on this order not yet being fulfilled. */
async function fulfill(row: OrderRow, now: number): Promise<void> {
  const token = crypto.randomUUID();
  const notFulfilled = { sql: "NOT EXISTS (SELECT 1 FROM payment_orders WHERE id=? AND fulfilled_at IS NOT NULL)", values: [row.id] as unknown[] };
  const markPaid = (outcome: "granted" | "needs_operator", proof: { sql: string; values: unknown[] } | null, links: { period?: string; lot?: string }) =>
    runtime().DB.prepare(`UPDATE payment_orders SET status='paid',paid_at=COALESCE(paid_at,?),fulfilled_at=?,fulfillment_token=?,fulfillment_outcome=?,
      access_period_id=COALESCE(?,access_period_id),lot_id=COALESCE(?,lot_id),updated_at=? WHERE id=? AND fulfilled_at IS NULL${proof ? ` AND ${proof.sql}` : ""}`)
      .bind(now, now, token, outcome, links.period ?? null, links.lot ?? null, now, row.id, ...(proof?.values ?? []));
  const statements: D1PreparedStatement[] = [];
  let audit: { action: string; details: Record<string, unknown> };

  if (row.kind === "plan") {
    const plan = row.plan_code!; const state = await planState(row.user_id, now);
    if (state.current && state.current.plan_code !== plan) {
      // Paid while another plan started (for example an admin grant). Take the money into account, never guess a swap.
      statements.push(markPaid("needs_operator", null, {}));
      audit = { action: "payment.needs_operator", details: { orderId: row.id, reason: "plan_already_active", paid: plan, current: state.current.plan_code, amountIdr: row.amount_idr } };
    } else {
      const startMs = state.current ? Date.parse(state.paidThrough!) : now; const endMs = addCalendarMonths(startMs, 1); const periodId = crypto.randomUUID();
      statements.push(periodInsertStatement({ id: periodId, ownerId: row.user_id, plan, source: "payment", paymentOrderId: row.id, startMs, endMs, now, extraGuard: notFulfilled }));
      statements.push(markPaid("granted", { sql: "EXISTS (SELECT 1 FROM access_periods WHERE id=?)", values: [periodId] }, { period: periodId }));
      audit = { action: state.current ? "payment.plan.renewed" : "payment.plan.activated", details: { orderId: row.id, plan, periodStart: new Date(startMs).toISOString(), periodEnd: new Date(endMs).toISOString(), amountIdr: row.amount_idr, mode: row.provider_mode } };
    }
  } else {
    const lotId = crypto.randomUUID(); const expiresMs = addCalendarMonths(now, TOP_UP_VALIDITY_MONTHS);
    const payloadHash = await sha256Hex(JSON.stringify({ order: row.id, pack: row.pack_code, characters: row.characters, amountIdr: row.amount_idr, mode: row.provider_mode }));
    const bindingHash = await sha256Hex(JSON.stringify({ owner: row.user_id, order: row.id }));
    // Frozen until the wallet sees a running paid plan; it never grants a feature or a tier.
    statements.push(runtime().DB.prepare(`INSERT INTO character_purchased_lots (id,owner_id,identity_link_id,fulfillment_id,customer_binding_hash,application_app_key,
        catalog_item_id,offer_id,offer_version,original_amount,reserved_amount,settled_amount,fulfilled_at,expires_at,fulfilled_at_ms,expires_at_ms,
        verification_revision,verification_payload_hash,state,reversal_state,measurement_version,created_at,updated_at)
      SELECT ?,?,NULL,?,?,?,'direct',?,?,?,0,0,?,?,?,?,'1',?,'frozen','none',?,?,? WHERE ${notFulfilled.sql}`)
      .bind(lotId, row.user_id, row.id, bindingHash, LOCAL_APP_KEY, row.pack_code, LOCAL_PLAN_VERSION, row.characters, new Date(now).toISOString(), new Date(expiresMs).toISOString(),
        now, expiresMs, payloadHash, CHARACTER_MEASUREMENT_VERSION, now, now, ...notFulfilled.values));
    statements.push(runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,lot_id,quantity,causal_reference,metadata_json,created_at)
      SELECT ?,?,'purchased_lot_accepted',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM character_purchased_lots WHERE id=?) AND ${notFulfilled.sql}`)
      .bind(crypto.randomUUID(), row.user_id, lotId, row.characters, row.id, JSON.stringify({ source: "midtrans", pack: row.pack_code }), now, lotId, ...notFulfilled.values));
    statements.push(markPaid("granted", { sql: "EXISTS (SELECT 1 FROM character_purchased_lots WHERE id=?)", values: [lotId] }, { lot: lotId }));
    audit = { action: "payment.topup.credited", details: { orderId: row.id, pack: row.pack_code, characters: row.characters, expiresAt: new Date(expiresMs).toISOString(), amountIdr: row.amount_idr, mode: row.provider_mode } };
  }
  // The audit row commits with the grant or not at all.
  statements.push(runtime().DB.prepare(`INSERT INTO admin_audit_log (id,actor_id,target_user_id,action,details_json,created_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM payment_orders WHERE id=? AND fulfillment_token=?)`)
    .bind(crypto.randomUUID(), row.user_id, row.user_id, audit.action, JSON.stringify(audit.details), now, row.id, token));
  await runBatch(statements);
}

/** A paid order that Midtrans now reports refunded or charged back. */
async function handleRefund(row: OrderRow, status: MidtransStatus, now: number): Promise<void> {
  const claimed = await runtime().DB.prepare(`UPDATE payment_orders SET status='refunded',refund_handled_at=?,provider_status=?,updated_at=?
    WHERE id=? AND status='paid' AND refund_handled_at IS NULL`).bind(now, status.transaction_status, now, row.id).run();
  if ((claimed.meta.changes ?? 0) !== 1) return;
  if (row.kind === "topup" && row.lot_id) {
    // B4 reversal: remaining characters are revoked, spent ones stay spent, no debt, open holds released.
    await applyVerifiedLotCorrection({ ownerId: row.user_id, lotId: row.lot_id, correctionId: `midtrans:${row.id}`, revision: 2, kind: "reversal",
      payloadHash: await sha256Hex(JSON.stringify({ order: row.id, status: status.transaction_status })), reasonCode: `midtrans_${status.transaction_status}` }, now);
    await writeAudit(row.user_id, row.user_id, "payment.refund.topup_reversed", { orderId: row.id, status: status.transaction_status });
  } else {
    // A refunded plan is an operator decision (Admin → Paket → Akhiri paket), as in Mari Rekap.
    await writeAudit(row.user_id, row.user_id, "payment.refund.needs_operator", { orderId: row.id, kind: row.kind, plan: row.plan_code, status: status.transaction_status });
  }
}

export async function applyStatus(config: MidtransConfig, row: OrderRow, status: MidtransStatus | null, now = Date.now()): Promise<OrderRow> {
  if (!status) {
    if (row.status === "pending" && now > row.expires_at) {
      await runtime().DB.prepare("UPDATE payment_orders SET status='expired',updated_at=? WHERE id=? AND status='pending'").bind(now, row.id).run();
    }
    return (await orderById(row.id))!;
  }
  if (row.provider_mode !== config.mode) {
    // A sandbox order never grants under a production key, and the other way round.
    await writeAudit(row.user_id, row.user_id, "payment.mode_mismatch", { orderId: row.id, orderMode: row.provider_mode, keyMode: config.mode });
    return row;
  }
  await runtime().DB.prepare("UPDATE payment_orders SET transaction_id=COALESCE(?,transaction_id),payment_type=COALESCE(?,payment_type),provider_status=?,updated_at=? WHERE id=?")
    .bind(status.transaction_id ?? null, status.payment_type ?? null, status.transaction_status, now, row.id).run();
  const outcome = paymentOutcome(status);
  if (outcome === "paid") {
    const gross = Math.round(Number(status.gross_amount));
    if (gross !== row.amount_idr || (status.currency && status.currency !== "IDR")) {
      await writeAudit(row.user_id, row.user_id, "payment.amount_mismatch", { orderId: row.id, expectedIdr: row.amount_idr, gross: status.gross_amount ?? null, currency: status.currency ?? null });
      return (await orderById(row.id))!;
    }
    if (row.fulfilled_at === null) await fulfill(row, now);
  } else if (outcome === "refunded") {
    const fresh = (await orderById(row.id))!;
    if (fresh.status === "paid") await handleRefund(fresh, status, now);
  } else if (outcome !== "pending") {
    // A later answer never unpays an order: only a pending order can fail, expire or be cancelled.
    await runtime().DB.prepare("UPDATE payment_orders SET status=?,updated_at=? WHERE id=? AND status='pending'").bind(outcome, now, row.id).run();
  }
  return (await orderById(row.id))!;
}

export async function refreshOrder(ownerId: string, orderId: string, now = Date.now(), fetcher: typeof fetch = fetch): Promise<PublicOrder> {
  const row = await orderById(orderId);
  if (!row || row.user_id !== ownerId) throw new RequestError("NOT_FOUND", "Pesanan tidak ditemukan.", 404);
  if (row.status !== "pending" && row.status !== "paid") return publicOrder(row, now);
  const config = requireConfig();
  let status: MidtransStatus | null;
  try { status = await getTransactionStatus(config, orderId, fetcher); }
  catch (error) {
    if (error instanceof MidtransError) throw new RequestError("PAYMENT_STATUS_UNAVAILABLE", "Status pembayaran belum bisa dicek. Coba lagi sebentar lagi.", 503);
    throw error;
  }
  return publicOrder(await applyStatus(config, row, status, now), now);
}

export type NotificationResult = { status: number; body: Record<string, unknown> };

/** The notification body is only a hint: after its signature passes, the status is read back from Midtrans. */
export async function handleNotification(body: unknown, now = Date.now(), fetcher: typeof fetch = fetch): Promise<NotificationResult> {
  const config = midtransConfig(runtime());
  if (!config) return { status: 503, body: { error: "payments_closed" } };
  if (!body || typeof body !== "object") return { status: 400, body: { error: "invalid_body" } };
  if (!await verifyNotificationSignature(config, body as Record<string, unknown>)) return { status: 401, body: { error: "invalid_signature" } };
  const orderId = String((body as { order_id: string }).order_id);
  const row = await orderById(orderId);
  // Answer 200 when nothing can ever change, so Midtrans stops retrying.
  if (!row) return { status: 200, body: { ok: false, reason: "unknown_order" } };
  const status = await getTransactionStatus(config, orderId, fetcher);
  if (!status) return { status: 200, body: { ok: false, reason: "no_transaction" } };
  const next = await applyStatus(config, row, status, now);
  return { status: 200, body: { ok: true, status: next.status } };
}

export async function listOrders(ownerId: string, limit = 20): Promise<PublicOrder[]> {
  const rows = await runtime().DB.prepare("SELECT * FROM payment_orders WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?").bind(ownerId, Math.min(50, Math.max(1, limit))).all<OrderRow>();
  const now = Date.now();
  return (rows.results ?? []).map((row) => publicOrder(row, now));
}

