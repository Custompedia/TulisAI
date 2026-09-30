import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey } from "@/server/http";
import { refreshOrder } from "@/server/payments/orders";

// Arriving back from Midtrans proves nothing: this asks Midtrans for the order's real status.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request); idempotencyKey(request); const { id } = await context.params;
    return jsonData(await refreshOrder(user.id, id), { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
