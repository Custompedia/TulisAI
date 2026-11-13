import { handleLynkWebhook } from "@/server/payments/lynk";

// Lynk's payment.received, forwarded unchanged by the custompedia store's webhook (Ruang KOL). No session: the Lynk
// signature over the body proves the sender, checked again here with the merchant key (docs/lynk-payments.md).
const MAX_BODY = 64 * 1024;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  try {
    const result = await handleLynkWebhook(await request.text(), request.headers.get("x-lynk-signature"));
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("lynk webhook", error instanceof Error ? error.message : "unknown");
    // Transient failures answer 500 so the payment is sent again.
    return Response.json({ error: "retry" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
