import { jsonData } from "@/lib/contracts";
import { requireAdmin } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { listUserUsage } from "@/server/admin/service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try { await requireAdmin(request); return jsonData(await listUserUsage((await params).id, new URL(request.url).searchParams.get("cursor"))); } catch (error) { return handleRouteError(error); }
}
