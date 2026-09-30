import { runtime } from "../runtime";
import { RequestError } from "../http";

// Admin → Pembayaran, after Mari Rekap's margin/payments view. Only production
// money counts as revenue; sandbox orders are shown as a count, never as
// revenue. Refunds count in the month they were handled (cash view).

const WIB_OFFSET_MS = 7 * 3_600_000;

export type PaymentReport = {
  month: string; currency: "IDR"; from: string; to: string;
  revenue: { plan: { grossIdr: number; orders: number }; topup: { grossIdr: number; orders: number };
    byItem: Array<{ kind: "plan" | "topup"; item: string; grossIdr: number; orders: number }>; refundedIdr: number; netIdr: number };
  sandboxOrders: number; aiCostUsd: number | null; aiRequests: number;
  attention: Array<{ id: string; userId: string; name: string | null; email: string | null; kind: string; item: string; amountIdr: number; mode: string; reason: "needs_operator" | "plan_refunded"; at: string }>;
  recent: Array<{ id: string; userId: string; name: string | null; email: string | null; kind: string; item: string; amountIdr: number; mode: string; status: string; granted: boolean; createdAt: string; paidAt: string | null }>;
};

/** "YYYY-MM" in Western Indonesia Time; defaults to the current month. */
export function monthRange(month: string | null, now = Date.now()): { month: string; start: number; end: number } {
  const value = month ?? new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 7);
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) throw new RequestError("INVALID_MONTH", "Month must be YYYY-MM.", 400);
  const year = Number(match[1]); const index = Number(match[2]) - 1;
  return { month: value, start: Date.UTC(year, index, 1) - WIB_OFFSET_MS, end: Date.UTC(year, index + 1, 1) - WIB_OFFSET_MS };
}

export async function paymentReport(month: string | null, now = Date.now()): Promise<PaymentReport> {
  const range = monthRange(month, now); const db = runtime().DB;
  const [sold, refunded, sandbox, cost, attention, recent] = await Promise.all([
    db.prepare(`SELECT kind, COALESCE(plan_code, pack_code) AS item, COUNT(1) AS orders, SUM(amount_idr) AS gross FROM payment_orders
      WHERE provider_mode='production' AND paid_at IS NOT NULL AND paid_at>=? AND paid_at<? AND status IN ('paid','refunded') GROUP BY kind, item ORDER BY kind, item`)
      .bind(range.start, range.end).all<{ kind: "plan" | "topup"; item: string; orders: number; gross: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount_idr),0) AS refunded FROM payment_orders WHERE provider_mode='production' AND status='refunded'
      AND refund_handled_at>=? AND refund_handled_at<?`).bind(range.start, range.end).first<{ refunded: number }>(),
    db.prepare(`SELECT COUNT(1) AS n FROM payment_orders WHERE provider_mode='sandbox' AND paid_at IS NOT NULL AND paid_at>=? AND paid_at<?`).bind(range.start, range.end).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(1) AS requests, SUM(cost_usd) AS cost FROM usage_ledger WHERE created_at>=? AND created_at<?`).bind(range.start, range.end).first<{ requests: number; cost: number | null }>(),
    db.prepare(`SELECT o.id, o.user_id, u.name, u.email, o.kind, COALESCE(o.plan_code, o.pack_code) AS item, o.amount_idr, o.provider_mode,
        CASE WHEN o.fulfillment_outcome='needs_operator' THEN 'needs_operator' ELSE 'plan_refunded' END AS reason, COALESCE(o.refund_handled_at, o.paid_at) AS at
      FROM payment_orders o LEFT JOIN user u ON u.id=o.user_id
      WHERE o.fulfillment_outcome='needs_operator' OR (o.kind='plan' AND o.status='refunded')
      ORDER BY at DESC LIMIT 50`).all<{ id: string; user_id: string; name: string | null; email: string | null; kind: string; item: string; amount_idr: number; provider_mode: string; reason: "needs_operator" | "plan_refunded"; at: number }>(),
    db.prepare(`SELECT o.id, o.user_id, u.name, u.email, o.kind, COALESCE(o.plan_code, o.pack_code) AS item, o.amount_idr, o.provider_mode, o.status,
        o.fulfillment_outcome, o.created_at, o.paid_at FROM payment_orders o LEFT JOIN user u ON u.id=o.user_id ORDER BY o.created_at DESC, o.id DESC LIMIT 25`)
      .all<{ id: string; user_id: string; name: string | null; email: string | null; kind: string; item: string; amount_idr: number; provider_mode: string; status: string; fulfillment_outcome: string | null; created_at: number; paid_at: number | null }>(),
  ]);
  const byItem = (sold.results ?? []).map((row) => ({ kind: row.kind, item: row.item, grossIdr: row.gross, orders: row.orders }));
  const bucket = (kind: "plan" | "topup") => byItem.filter((row) => row.kind === kind).reduce((sum, row) => ({ grossIdr: sum.grossIdr + row.grossIdr, orders: sum.orders + row.orders }), { grossIdr: 0, orders: 0 });
  const plan = bucket("plan"); const topup = bucket("topup"); const refundedIdr = refunded?.refunded ?? 0;
  return {
    month: range.month, currency: "IDR", from: new Date(range.start).toISOString(), to: new Date(range.end).toISOString(),
    revenue: { plan, topup, byItem, refundedIdr, netIdr: plan.grossIdr + topup.grossIdr - refundedIdr },
    sandboxOrders: sandbox?.n ?? 0,
    // A missing cost is unknown, never zero.
    aiCostUsd: cost?.cost ?? null, aiRequests: cost?.requests ?? 0,
    attention: (attention.results ?? []).map((row) => ({ id: row.id, userId: row.user_id, name: row.name, email: row.email, kind: row.kind, item: row.item, amountIdr: row.amount_idr, mode: row.provider_mode, reason: row.reason, at: new Date(row.at).toISOString() })),
    recent: (recent.results ?? []).map((row) => ({ id: row.id, userId: row.user_id, name: row.name, email: row.email, kind: row.kind, item: row.item, amountIdr: row.amount_idr, mode: row.provider_mode, status: row.status,
      granted: row.fulfillment_outcome === "granted", createdAt: new Date(row.created_at).toISOString(), paidAt: row.paid_at === null ? null : new Date(row.paid_at).toISOString() })),
  };
}
