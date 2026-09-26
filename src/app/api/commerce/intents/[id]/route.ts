import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { recoverPurchaseIntent } from "@/server/commerce/intents";
import { handleRouteError } from "@/server/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request); const { id } = await context.params;
    return jsonData(await recoverPurchaseIntent({ ownerId: user.id, purchaseId: id }), { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
