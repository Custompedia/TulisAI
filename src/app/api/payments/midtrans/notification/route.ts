import { handleNotification } from "@/server/payments/orders";

// Midtrans server-to-server notification. No session: the signature proves the sender,
// and the grant still waits for a status read back from Midtrans.
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  try {
    const result = await handleNotification(body);
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch {
    // Transient failures answer 500 so Midtrans retries the notification.
    return Response.json({ error: "retry" }, { status: 500 });
  }
}
