import { lynkProduct, lynkProductOf, type LynkProduct, type LynkProductKey } from "@/lib/lynk-products";
import { PLAN_LIMITS, TOP_UPS } from "@/lib/plans";
import { writeAudit } from "../audit";
import { RequestError } from "../http";
import { ConfigurationError, runtime } from "../runtime";
import { planState } from "../access/periods";
import { emailConfigured, renderEmail, sendEmail, EmailError, type EmailTemplate } from "../email/send";
import { fulfillOrder, orderById, ORDER_EXPIRY_HOURS, type OrderRow } from "./orders";

// Buying through Lynk (docs/lynk-payments.md; owner 2026-11-13). Lynk posts `payment.received` after each successful
// payment in the custompedia store to the store's one webhook, which Ruang KOL owns; Ruang KOL forwards the payments
// that are not its own here, body and X-Lynk-Signature unchanged. The signature (sha256 hex of grandTotal + refId +
// message_id + merchant key) is checked again here with the same merchant key, so the forwarder is not trusted.
//
// Each payment counts once (lynk_payments, by refId). A payment whose email belongs to a verified Tulis Lab account is
// granted at once through a payment_orders row 'LY-<refId>' and the same fulfilment as Midtrans. Otherwise it waits for
// the buyer: the emailed claim link, a sign-in with that verified email, or an admin attaching it to an account.

export const LYNK_WEBHOOK_PATH = "/api/lynk/webhook";
const MAX_BODY = 64 * 1024;
/** A row still "processing" this long after its last touch was cut short (the Worker stopped): a retry takes it over. */
const STALE_MS = 2 * 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LynkStatus = "processing" | "granted" | "needs_operator" | "waiting_account" | "ignored" | "failed";
export type ClaimedBy = "email" | "link" | "sign_in" | "admin";
export type LynkRow = {
  ref_id: string; message_id: string; received_at: number; updated_at: number; email: string; customer_name: string; amount_idr: number | null;
  product: string; status: LynkStatus; user_id: string | null; order_id: string | null; claimed_by: ClaimedBy | null; detail_json: string;
};
export type WebhookResult = { status: number; body: Record<string, unknown> };

/** Lynk sales are open once the merchant key is on the Worker. */
export const lynkConfigured = () => Boolean(runtime().LYNK_MERCHANT_KEY?.trim());

const text = (value: unknown, max: number) => (typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "");
export const normalizeEmail = (value: unknown) => text(value, 254).toLowerCase();

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/** Lynk's signature over a payment: sha256 hex of grandTotal, refId, message_id and the merchant key, joined. */
export const lynkSignature = (grandTotal: unknown, refId: string, messageId: string, key: string) => sha256Hex(`${grandTotal}${refId}${messageId}${key}`);

const appUrl = () => (runtime().BETTER_AUTH_URL ?? "").replace(/\/+$/, "");

/** The secret part of a claim link: only the mailbox the link was sent to holds it. */
export async function claimToken(refId: string): Promise<string> {
  const secret = runtime().BETTER_AUTH_SECRET;
  if (!secret) throw new ConfigurationError("BETTER_AUTH_SECRET is not configured.");
  return hmacHex(secret, `lynk-claim:v1:${refId}`);
}
export const claimUrl = async (refId: string) => `${appUrl()}/billing/lynk?ref=${encodeURIComponent(refId)}&t=${await claimToken(refId)}`;

const rowByRef = (refId: string) => runtime().DB.prepare("SELECT * FROM lynk_payments WHERE ref_id=?").bind(refId).first<LynkRow>();
const detailOf = (row: LynkRow | null): Record<string, unknown> => { try { return JSON.parse(row?.detail_json ?? "{}") as Record<string, unknown>; } catch { return {}; } };

async function finish(refId: string, status: LynkStatus, fields: { userId?: string | null; orderId?: string | null; claimedBy?: ClaimedBy | null; detail?: Record<string, unknown> }, now: number) {
  const detail = { ...detailOf(await rowByRef(refId)), ...(fields.detail ?? {}) };
  await runtime().DB.prepare(`UPDATE lynk_payments SET status=?,user_id=COALESCE(?,user_id),order_id=COALESCE(?,order_id),claimed_by=COALESCE(?,claimed_by),
    detail_json=?,updated_at=? WHERE ref_id=?`).bind(status, fields.userId ?? null, fields.orderId ?? null, fields.claimedBy ?? null, JSON.stringify(detail), now, refId).run();
}

/** Puts a row taken for processing back where a retry or another claim takes it over at once. */
const release = (refId: string, status: "processing" | "waiting_account") =>
  runtime().DB.prepare("UPDATE lynk_payments SET status=?,updated_at=0 WHERE ref_id=? AND status='processing'").bind(status, refId).run().catch(() => undefined);

export type Grant = { outcome: "granted" | "needs_operator"; order: OrderRow; product: LynkProduct };

/**
 * Turns a taken payment into a paid order for `userId` and grants it once. The order id is fixed by the refId, so a
 * repeat finds the same order, and fulfilment itself grants only an unfulfilled order.
 */
async function grantTo(row: LynkRow, userId: string, claimedBy: ClaimedBy, now: number): Promise<Grant> {
  const product = lynkProduct(row.product as LynkProductKey);
  const orderId = `LY-${row.ref_id}`;
  const characters = product.kind === "plan" ? PLAN_LIMITS[product.plan].includedCharacters : TOP_UPS.find((pack) => pack.id === product.pack)!.characters;
  // An unfulfilled order left by an earlier attempt for another account (a claim that failed half-way) is dropped, so
  // the order always goes to the account claiming it now. A fulfilled order is never touched.
  await runtime().DB.prepare("DELETE FROM payment_orders WHERE id=? AND fulfilled_at IS NULL AND user_id<>?").bind(orderId, userId).run();
  await runtime().DB.prepare(`INSERT INTO payment_orders (id,user_id,kind,plan_code,pack_code,characters,amount_idr,provider_mode,status,created_at,updated_at,expires_at,provider,months)
    VALUES (?,?,?,?,?,?,?,'production','pending',?,?,?,'lynk',?) ON CONFLICT(id) DO NOTHING`)
    .bind(orderId, userId, product.kind, product.kind === "plan" ? product.plan : null, product.kind === "topup" ? product.pack : null, characters, row.amount_idr,
      row.received_at, now, row.received_at + ORDER_EXPIRY_HOURS * 3_600_000, product.kind === "plan" ? product.months : 1).run();
  let order = (await orderById(orderId))!;
  if (order.fulfilled_at === null) { await fulfillOrder(order, now); order = (await orderById(orderId))!; }
  // Blocked by a plan change at the same moment: nothing was granted, and the caller lets a retry try again.
  if (order.fulfilled_at === null) throw new Error("LYNK_GRANT_NOT_APPLIED");
  const outcome = order.fulfillment_outcome === "needs_operator" ? "needs_operator" : "granted";
  await finish(row.ref_id, outcome, { userId: order.user_id, orderId, claimedBy }, now);
  return { outcome, order, product };
}

const capitalized = (plan: string) => `${plan[0]!.toUpperCase()}${plan.slice(1)}`;
const idDate = (iso: string) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const enDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(iso));
/** "Tulis Lab Pro 1 bulan" / "Tulis Lab Pro (1 month)", or the top-up's characters. */
export function productName(product: LynkProduct, english = false): string {
  if (product.kind === "topup") {
    const characters = TOP_UPS.find((pack) => pack.id === product.pack)!.characters;
    return english ? `a ${characters.toLocaleString("en")}-character Tulis Lab top-up` : `tambahan ${characters.toLocaleString("id-ID")} karakter Tulis Lab`;
  }
  const plan = capitalized(product.plan);
  return english ? `Tulis Lab ${plan} (${product.months === 12 ? "1 year" : "1 month"})` : `Tulis Lab ${plan} ${product.months === 12 ? "1 tahun" : "1 bulan"}`;
}

/** The email for a payment's outcome. Every template is bilingual (renderEmail). */
async function emailFor(kind: "granted" | "needs_operator" | "waiting_account", row: LynkRow, product: LynkProduct, grant: Grant | null): Promise<EmailTemplate> {
  const name = row.customer_name || row.email.split("@")[0]!;
  const idName = productName(product); const enName = productName(product, true);
  if (kind === "waiting_account") {
    return {
      subject: `Aktifkan ${idName}`, url: await claimUrl(row.ref_id),
      heading: { id: "Pembayaranmu sudah kami terima", en: "We received your payment" },
      body: {
        id: `Halo ${name}, terima kasih sudah membeli ${idName} di Lynk. Klik tombol di bawah, lalu masuk atau daftar di Tulis Lab. Pembelianmu langsung aktif di akun yang kamu pakai.`,
        en: `Hi ${name}, thank you for buying ${enName} on Lynk. Click the button below, then sign in or sign up at Tulis Lab. Your purchase becomes active on the account you use.`,
      },
      action: { id: "Aktifkan sekarang", en: "Activate now" },
      footnote: { id: "Link ini khusus untukmu, jangan dibagikan. Masuk dengan Google memakai email ini juga langsung mengaktifkannya.", en: "This link is yours alone; do not share it. Signing in with Google using this email activates it too." },
    };
  }
  if (kind === "needs_operator") {
    return {
      subject: "Pembayaran Tulis Lab diterima", url: `${appUrl()}/app`,
      heading: { id: "Pembayaranmu sudah kami terima", en: "We received your payment" },
      body: {
        id: `Halo ${name}, pembayaran ${idName} sudah kami terima. Akunmu sedang memakai paket lain, jadi paket ini belum kami pasang otomatis. Tim kami akan menyesuaikannya dan menghubungimu.`,
        en: `Hi ${name}, we received your payment for ${enName}. Your account is on another plan, so this one was not applied automatically. Our team will sort it out and contact you.`,
      },
      action: { id: "Buka Tulis Lab", en: "Open Tulis Lab" },
      footnote: { id: "Balas email ini kalau ada pertanyaan.", en: "Reply to this email if you have any questions." },
    };
  }
  if (product.kind === "plan") {
    const until = (await planState(grant!.order.user_id)).paidThrough ?? new Date().toISOString();
    return {
      subject: `Paket Tulis Lab ${capitalized(product.plan)} aktif`, url: `${appUrl()}/app`,
      heading: { id: `Paket ${capitalized(product.plan)} aktif`, en: `${capitalized(product.plan)} plan active` },
      body: {
        id: `Halo ${name}, terima kasih sudah membeli ${idName} di Lynk. Paket ${capitalized(product.plan)} aktif di akun Tulis Lab-mu sampai ${idDate(until)}. Kuota karakternya terisi ulang setiap bulan.`,
        en: `Hi ${name}, thank you for buying ${enName} on Lynk. The ${capitalized(product.plan)} plan is active on your Tulis Lab account until ${enDate(until)}. Its character allowance refills every month.`,
      },
      action: { id: "Mulai menulis", en: "Start writing" },
      footnote: { id: "Balas email ini kalau ada pertanyaan.", en: "Reply to this email if you have any questions." },
    };
  }
  const running = (await planState(grant!.order.user_id)).current;
  return {
    subject: `Tambahan ${TOP_UPS.find((pack) => pack.id === (product as { pack: string }).pack)!.characters.toLocaleString("id-ID")} karakter masuk · Tulis Lab`, url: `${appUrl()}/app`,
    heading: { id: "Tambahan karakter masuk", en: "Top-up added" },
    body: {
      id: `Halo ${name}, ${idName} sudah masuk ke akun Tulis Lab-mu dan berlaku 12 bulan. Karakter tambahan dipakai setelah kuota bulanan habis${running ? "" : ", dan baru bisa dipakai saat paket Plus, Pro, atau Max aktif"}.`,
      en: `Hi ${name}, ${enName} has been added to your Tulis Lab account and stays valid for 12 months. Top-up characters are used after the monthly allowance${running ? "" : ", and only while a Plus, Pro or Max plan is active"}.`,
    },
    action: { id: "Buka Tulis Lab", en: "Open Tulis Lab" },
    footnote: { id: "Balas email ini kalau ada pertanyaan.", en: "Reply to this email if you have any questions." },
  };
}

/** Sends one outcome email and records the result on the payment. Never throws: a failed email never undoes a grant. */
async function notify(kind: "granted" | "needs_operator" | "waiting_account", refId: string, grant: Grant | null, now: number): Promise<void> {
  const row = await rowByRef(refId);
  if (!row || !row.email) return;
  let result = "sent";
  try {
    if (!emailConfigured()) result = "not_configured";
    else {
      const product = lynkProduct(row.product as LynkProductKey);
      await sendEmail({ to: row.email, ...renderEmail(await emailFor(kind, row, product, grant)) }, { idempotencyKey: `tulis-lynk/${refId}/${kind}` });
    }
  } catch (error) {
    result = error instanceof EmailError ? error.code : "failed";
    console.error("lynk email", result);
  }
  await finish(refId, row.status, { detail: { email: { [kind]: result } } }, now).catch(() => undefined);
}

/** The verified account an email belongs to, or null. */
async function verifiedAccount(email: string): Promise<{ id: string } | null> {
  return await runtime().DB.prepare("SELECT id FROM user WHERE lower(email)=? AND email_verified=1 LIMIT 1").bind(email).first<{ id: string }>() ?? null;
}

/** POST /api/lynk/webhook. `body` is the raw request text; nothing is trusted before its signature passes. */
export async function handleLynkWebhook(body: string, signatureHeader: string | null, now = Date.now()): Promise<WebhookResult> {
  const key = runtime().LYNK_MERCHANT_KEY?.trim();
  // Not set up yet: Lynk (through Ruang KOL) tries again later.
  if (!key) return { status: 503, body: { error: "not_configured" } };
  if (body.length > MAX_BODY) return { status: 413, body: { error: "too_large" } };
  let payload: { event?: unknown; data?: Record<string, unknown> } | null;
  try { payload = JSON.parse(body) as typeof payload; } catch { return { status: 400, body: { error: "invalid_json" } }; }
  // Only a payment makes anything. Anything else (Lynk's "Test URL" sends a small unsigned message) is answered and left alone.
  if (payload?.event !== "payment.received") return { status: 200, body: { ignored: "event" } };
  const data = payload.data ?? {}; const message = (data.message_data ?? {}) as Record<string, unknown>;
  const refId = text(message.refId, 100); const messageId = text(data.message_id, 200);
  const grandTotal = (message.totals as { grandTotal?: unknown } | undefined)?.grandTotal;
  const signature = (signatureHeader ?? "").trim().toLowerCase();
  // grandTotal as Lynk writes it, and as a whole number (72000 and 72000.0 are the same payment).
  let valid = false;
  for (const total of new Set([String(grandTotal), String(Math.round(Number(grandTotal)))])) {
    if (refId && signature && same(signature, await lynkSignature(total, refId, messageId, key))) valid = true;
  }
  if (!valid) return { status: 401, body: { error: "invalid_signature" } };
  if (data.message_action !== "SUCCESS") return { status: 200, body: { ignored: "event" } };

  const items = (Array.isArray(message.items) ? message.items.slice(0, 20) : []) as Array<{ uuid?: unknown; title?: unknown; qty?: unknown; price?: unknown }>;
  const ours = items.map((item) => (item && typeof item === "object" ? lynkProductOf(item) : null)).filter((product): product is LynkProduct => product !== null);
  const customer = (message.customer ?? {}) as { email?: unknown; name?: unknown };
  const email = normalizeEmail(customer.email); const name = text(customer.name, 120);
  // What was paid for our product: the order total when it is the only item (discounts included), else its own price
  // (Lynk has a cart, so one payment can hold other products of the store too).
  const total = Number.isFinite(Number(grandTotal)) ? Math.round(Number(grandTotal)) : null;
  const ourItem = ours[0] ? items.find((item) => item && typeof item === "object" && lynkProductOf(item) === ours[0]) : undefined;
  const itemPrice = Math.round(Number(ourItem?.price));
  const amount = items.length > 1 && Number.isFinite(itemPrice) && itemPrice > 0 ? itemPrice : total;

  // Once per payment: the row is the lock. A row left "processing" by a cut-short run is taken over after a while.
  const taken = await runtime().DB.prepare(`INSERT INTO lynk_payments (ref_id,message_id,received_at,updated_at,email,customer_name,amount_idr,product,status)
    VALUES (?,?,?,?,?,?,?,?,'processing') ON CONFLICT(ref_id) DO UPDATE SET updated_at=excluded.updated_at,message_id=excluded.message_id,
      email=excluded.email,customer_name=excluded.customer_name,amount_idr=excluded.amount_idr,product=excluded.product
    WHERE lynk_payments.status='processing' AND lynk_payments.updated_at<=?`)
    .bind(refId, messageId, now, now, email, name, amount, ours[0]?.key ?? "", now - STALE_MS).run();
  if ((taken.meta.changes ?? 0) === 0) {
    const status = (await rowByRef(refId))?.status ?? null;
    // Still being processed by another delivery: ask for a retry, so a run that dies half-way is picked up later.
    if (status === "processing") return { status: 503, body: { retry: true } };
    return { status: 200, body: { duplicate: true, status } };
  }

  try {
    if (!ours.length) {
      await finish(refId, "ignored", { detail: { titles: items.map((item) => text(item?.title, 100)).slice(0, 5) } }, now);
      return { status: 200, body: { ignored: "product" } };
    }
    const product = ours[0]!;
    // One product per payment (each Tulis Lab product on Lynk allows one per checkout); anything more is for an operator.
    const extra = ours.length - 1 + Math.max(0, Math.round(Number(items.find((item) => lynkProductOf(item) === product)?.qty ?? 1)) - 1);
    const detail = { product: product.key, ...(extra > 0 ? { extra } : {}) };
    if (!EMAIL_PATTERN.test(email)) {
      await finish(refId, "failed", { detail: { ...detail, reason: "EMAIL_INVALID" } }, now);
      return { status: 200, body: { failed: "email" } };
    }
    if (!amount || amount <= 0) {
      // A zero total (a 100% coupon) is not revenue the order table can hold; the owner grants it from Admin -> Paket.
      await finish(refId, "needs_operator", { detail: { ...detail, reason: "ZERO_TOTAL" } }, now);
      return { status: 200, body: { status: "needs_operator" } };
    }
    const account = await verifiedAccount(email);
    if (!account) {
      await finish(refId, "waiting_account", { detail }, now);
      await notify("waiting_account", refId, null, now);
      return { status: 200, body: { status: "waiting_account" } };
    }
    const row = (await rowByRef(refId))!;
    const grant = await grantTo(row, account.id, "email", now);
    await finish(refId, grant.outcome, { detail }, now);
    await notify(grant.outcome, refId, grant, now);
    return { status: 200, body: { status: grant.outcome, orderId: grant.order.id } };
  } catch (error) {
    // Back to a state a retry takes over at once (Lynk sends again after a failure).
    await release(refId, "processing");
    throw error;
  }
}

export type ClaimResult = { status: "granted" | "needs_operator"; product: LynkProductKey; orderId: string; paidThrough: string | null };

async function claimResult(row: LynkRow): Promise<ClaimResult> {
  return { status: row.status === "needs_operator" ? "needs_operator" : "granted", product: row.product as LynkProductKey, orderId: row.order_id ?? "", paidThrough: row.user_id ? (await planState(row.user_id)).paidThrough : null };
}

/** Takes a waiting payment for `userId` and grants it; a failure puts it back to waiting. */
async function takeAndGrant(row: LynkRow, userId: string, claimedBy: ClaimedBy, now: number): Promise<Grant | null> {
  const taken = await runtime().DB.prepare("UPDATE lynk_payments SET status='processing',updated_at=? WHERE ref_id=? AND status='waiting_account'").bind(now, row.ref_id).run();
  if ((taken.meta.changes ?? 0) !== 1) return null;
  try { return await grantTo(row, userId, claimedBy, now); }
  catch (error) { await release(row.ref_id, "waiting_account"); throw error; }
}

/** The emailed claim link, opened by a signed-in user: the purchase goes to that account, whatever its email. */
export async function claimWithLink(userId: string, refId: string, token: string, now = Date.now()): Promise<ClaimResult> {
  if (!refId || !token || !same(token.toLowerCase(), await claimToken(refId))) throw new RequestError("LYNK_CLAIM_INVALID", "Link aktivasi tidak valid.", 403);
  const row = await rowByRef(refId);
  if (!row || !row.product) throw new RequestError("NOT_FOUND", "Pembelian tidak ditemukan.", 404);
  if (row.status === "waiting_account") {
    const grant = await takeAndGrant(row, userId, "link", now);
    if (grant) {
      await writeAudit(userId, userId, "payment.lynk.claimed", { refId, product: row.product, orderId: grant.order.id, outcome: grant.outcome });
      return claimResult((await rowByRef(refId))!);
    }
  }
  const fresh = (await rowByRef(refId))!;
  if ((fresh.status === "granted" || fresh.status === "needs_operator") && fresh.user_id === userId) return claimResult(fresh);
  if (fresh.status === "granted" || fresh.status === "needs_operator") throw new RequestError("LYNK_ALREADY_CLAIMED", "Pembelian ini sudah aktif di akun lain.", 409);
  if (fresh.status === "processing") throw new RequestError("LYNK_PROCESSING", "Pembelian ini sedang diproses. Coba lagi sebentar lagi.", 409);
  throw new RequestError("LYNK_NOT_CLAIMABLE", "Pembelian ini perlu ditangani admin. Balas email dari Tulis Lab, ya.", 409);
}

/**
 * Grants every waiting payment made with this account's email, once the email is verified (Google, or a verified
 * password account). Called on the usage and billing reads, so a buyer who signs in later gets the plan without the link.
 */
export async function claimForVerifiedEmail(userId: string, now = Date.now()): Promise<number> {
  const rows = await runtime().DB.prepare(`SELECT l.* FROM lynk_payments l JOIN user u ON l.email=lower(u.email)
    WHERE u.id=? AND u.email_verified=1 AND l.status='waiting_account' ORDER BY l.received_at LIMIT 5`).bind(userId).all<LynkRow>();
  let granted = 0;
  for (const row of rows.results ?? []) {
    const grant = await takeAndGrant(row, userId, "sign_in", now);
    if (!grant) continue;
    granted++;
    await writeAudit(userId, userId, "payment.lynk.claimed", { refId: row.ref_id, product: row.product, orderId: grant.order.id, outcome: grant.outcome, by: "sign_in" });
  }
  return granted;
}

/** The read paths call this; a claim problem never breaks the page that asked. */
export async function claimQuietly(userId: string): Promise<void> {
  try { await claimForVerifiedEmail(userId); } catch (error) { console.error("lynk claim", error instanceof Error ? error.message : "unknown"); }
}

/** Admin -> Pembayaran: attach a waiting payment to the account with this email (a typo at checkout, another address). */
export async function adminAttachLynk(actorId: string, refId: string, email: string, now = Date.now()): Promise<ClaimResult> {
  const row = await rowByRef(refId);
  if (!row || !row.product) throw new RequestError("NOT_FOUND", "Pembelian tidak ditemukan.", 404);
  if (row.status !== "waiting_account") throw new RequestError("LYNK_NOT_CLAIMABLE", "Pembelian ini tidak sedang menunggu akun.", 409);
  const user = await runtime().DB.prepare("SELECT id FROM user WHERE lower(email)=? LIMIT 1").bind(normalizeEmail(email)).first<{ id: string }>();
  if (!user) throw new RequestError("USER_NOT_FOUND", "Tidak ada akun dengan email ini.", 404);
  const grant = await takeAndGrant(row, user.id, "admin", now);
  if (!grant) throw new RequestError("LYNK_PROCESSING", "Pembelian ini baru saja berubah. Muat ulang.", 409);
  await writeAudit(actorId, user.id, "payment.lynk.attached", { refId, product: row.product, orderId: grant.order.id, outcome: grant.outcome, buyerEmail: row.email });
  return claimResult((await rowByRef(refId))!);
}

export type LynkAttention = { refId: string; email: string; name: string; product: string; amountIdr: number | null; status: LynkStatus; reason: string | null; extra: number; receivedAt: string; orderId: string | null };

/** Lynk payments an admin may need to act on: waiting for an account, unusable, or more than one product. */
export async function lynkAttention(): Promise<LynkAttention[]> {
  const rows = await runtime().DB.prepare(`SELECT * FROM lynk_payments WHERE status IN ('waiting_account','failed','processing')
    OR (status='needs_operator' AND order_id IS NULL) OR (product<>'' AND detail_json LIKE '%"extra"%') ORDER BY received_at DESC LIMIT 50`).all<LynkRow>();
  return (rows.results ?? []).map((row) => {
    const detail = detailOf(row);
    return { refId: row.ref_id, email: row.email, name: row.customer_name, product: row.product, amountIdr: row.amount_idr, status: row.status,
      reason: typeof detail.reason === "string" ? detail.reason : null, extra: typeof detail.extra === "number" ? detail.extra : 0, receivedAt: new Date(row.received_at).toISOString(), orderId: row.order_id };
  });
}
