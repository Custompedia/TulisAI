import type { RuntimeEnv } from "../runtime";

// Direct Midtrans Snap client, after Mari Rekap (src/lib/payments/midtrans.ts).
// The server key only ever lives in the MIDTRANS_SERVER_KEY secret.

export type MidtransMode = "sandbox" | "production";
export type MidtransConfig = { serverKey: string; mode: MidtransMode; appUrl: string };

// Origins that real customers use. A sandbox key is only accepted there when
// MIDTRANS_MODE says "sandbox" out loud, so a forgotten test key can't take real orders silently.
export const PRODUCTION_ORIGINS = new Set(["https://tulis.marikitalembur.com"]);

export class MidtransError extends Error {
  constructor(message: string, public transient = true) { super(message); this.name = "MidtransError"; }
}

/**
 * Null means payments are closed. Newer sandbox keys have no "SB-" prefix, so
 * MIDTRANS_MODE should always be declared.
 */
export function midtransConfig(env: RuntimeEnv): MidtransConfig | null {
  const serverKey = env.MIDTRANS_SERVER_KEY?.trim(); const appUrl = env.BETTER_AUTH_URL?.trim().replace(/\/+$/, "");
  if (!serverKey || !appUrl) return null;
  const declared = env.MIDTRANS_MODE?.trim();
  if (declared && declared !== "sandbox" && declared !== "production") return null;
  const prefixed = serverKey.startsWith("SB-");
  if (declared === "production" && prefixed) return null;
  const mode: MidtransMode = declared === "sandbox" || declared === "production" ? declared : prefixed ? "sandbox" : "production";
  if (!declared && mode === "sandbox" && PRODUCTION_ORIGINS.has(appUrl)) return null;
  return { serverKey, mode, appUrl };
}

const snapBase = (mode: MidtransMode) => (mode === "production" ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com");
const apiBase = (mode: MidtransMode) => (mode === "production" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com");
const authorization = (config: MidtransConfig) => `Basic ${btoa(`${config.serverKey}:`)}`;
export const notificationUrl = (config: MidtransConfig) => `${config.appUrl}/api/payments/midtrans/notification`;

export type SnapInput = {
  orderId: string; amountIdr: number; itemId: string; itemName: string;
  customer: { name: string; email: string }; finishUrl: string; expiryHours: number;
};

export async function createSnapTransaction(config: MidtransConfig, input: SnapInput, fetcher: typeof fetch = fetch): Promise<{ token: string; redirectUrl: string }> {
  let response: Response;
  try {
    response = await fetcher(`${snapBase(config.mode)}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        accept: "application/json", "content-type": "application/json", authorization: authorization(config),
        // Every environment receives its own notifications, whatever the dashboard default says.
        "X-Override-Notification": notificationUrl(config),
      },
      body: JSON.stringify({
        transaction_details: { order_id: input.orderId, gross_amount: input.amountIdr },
        item_details: [{ id: input.itemId, price: input.amountIdr, quantity: 1, name: input.itemName.slice(0, 50) }],
        customer_details: { first_name: input.customer.name.trim().slice(0, 50) || "Pelanggan", email: input.customer.email },
        callbacks: { finish: input.finishUrl },
        expiry: { unit: "hour", duration: input.expiryHours },
      }),
    });
  } catch { throw new MidtransError("Midtrans could not be reached."); }
  const body = await response.json().catch(() => null) as { token?: unknown; redirect_url?: unknown } | null;
  if (!response.ok || typeof body?.token !== "string" || typeof body.redirect_url !== "string") throw new MidtransError(`Midtrans refused the payment page (${response.status}).`, response.status >= 500);
  return { token: body.token, redirectUrl: body.redirect_url };
}

export type MidtransStatus = {
  order_id: string; transaction_status: string; status_code?: string; gross_amount?: string; currency?: string;
  fraud_status?: string; transaction_id?: string; payment_type?: string; signature_key?: string;
};

/** Null when Midtrans has no transaction yet (the buyer has not picked a payment method). */
export async function getTransactionStatus(config: MidtransConfig, orderId: string, fetcher: typeof fetch = fetch): Promise<MidtransStatus | null> {
  let response: Response;
  try {
    response = await fetcher(`${apiBase(config.mode)}/v2/${encodeURIComponent(orderId)}/status`, { headers: { accept: "application/json", authorization: authorization(config) } });
  } catch { throw new MidtransError("Midtrans could not be reached."); }
  const body = await response.json().catch(() => null) as (MidtransStatus & { status_message?: string }) | null;
  if (body?.status_code === "404") return null;
  if (!response.ok || !body || typeof body.transaction_status !== "string") throw new MidtransError(`Midtrans status is unavailable (${response.status}).`);
  return body;
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-512(order_id + status_code + gross_amount + server key), compared in constant time. */
export async function verifyNotificationSignature(config: MidtransConfig, body: { order_id?: unknown; status_code?: unknown; gross_amount?: unknown; signature_key?: unknown }): Promise<boolean> {
  if (typeof body.order_id !== "string" || typeof body.status_code !== "string" || typeof body.gross_amount !== "string" || typeof body.signature_key !== "string") return false;
  const expected = hex(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(`${body.order_id}${body.status_code}${body.gross_amount}${config.serverKey}`)));
  const actual = body.signature_key.toLowerCase();
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return difference === 0;
}

export type PaymentOutcome = "paid" | "pending" | "failed" | "expired" | "cancelled" | "refunded";

export function paymentOutcome(status: Pick<MidtransStatus, "transaction_status" | "fraud_status">): PaymentOutcome {
  switch (status.transaction_status) {
    case "settlement": return "paid";
    // A card capture under fraud review stays pending until Midtrans accepts it.
    case "capture": return !status.fraud_status || status.fraud_status === "accept" ? "paid" : "pending";
    case "deny": case "failure": return "failed";
    case "expire": return "expired";
    case "cancel": return "cancelled";
    case "refund": case "partial_refund": case "chargeback": case "partial_chargeback": return "refunded";
    default: return "pending";
  }
}
