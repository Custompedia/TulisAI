import { z } from "zod";
import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { createCheckout } from "@/server/payments/orders";

// The browser names only what to buy. Price, quantity and grant are decided on the server.
const CheckoutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), plan: z.enum(["plus", "pro", "max"]) }).strict(),
  z.object({ kind: z.literal("topup"), pack: z.enum(["small", "medium", "large"]) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const user = await requireUser(request); idempotencyKey(request);
    const input = await readJson(request, CheckoutSchema);
    const result = await createCheckout({ id: user.id, name: user.name, email: user.email }, input);
    return jsonData(result, { status: result.reused ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
