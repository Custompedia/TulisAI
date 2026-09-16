import { jsonData } from "@/lib/contracts";
import { requireAdmin } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { listAudit, pageOf } from "@/server/admin/service";
export async function GET(request: Request) {
  try {
    await requireAdmin(request); const url = new URL(request.url);
    return jsonData(await listAudit({ action: url.searchParams.get("action"), q: url.searchParams.get("q") ?? "" }, pageOf(url.searchParams.get("page"))));
  } catch (error) { return handleRouteError(error); }
}
