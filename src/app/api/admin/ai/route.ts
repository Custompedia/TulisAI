import { jsonData } from "@/lib/contracts";
import { requireAdmin } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { aiMetrics } from "@/server/admin/service";
export async function GET(request: Request) {
  try { await requireAdmin(request); const url = new URL(request.url); return jsonData(await aiMetrics(url.searchParams.get("from"), url.searchParams.get("to"))); } catch (error) { return handleRouteError(error); }
}
