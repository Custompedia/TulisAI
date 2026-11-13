import { z } from "zod";
import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, readJson } from "@/server/http";
import { claimWithLink } from "@/server/payments/lynk";

// The link in the "activate your purchase" email: the signed-in account receives the purchase.
const ClaimSchema = z.object({ ref: z.string().min(1).max(100), token: z.string().regex(/^[0-9a-f]{64}$/i) }).strict();

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = await readJson(request, ClaimSchema);
    return jsonData(await claimWithLink(user.id, input.ref, input.token), { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
