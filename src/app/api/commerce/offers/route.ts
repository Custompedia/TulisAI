import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { commerceCatalog } from "@/server/commerce/catalog";
import { handleRouteError } from "@/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return jsonData(await commerceCatalog(user.id), { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
