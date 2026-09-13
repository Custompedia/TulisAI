import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { runtime } from "@/server/runtime";
export async function GET(request: Request) { try { const user = await requireUser(request); const period = new Date().toISOString().slice(0, 7); const row = await runtime().DB.prepare("SELECT COUNT(1) AS total FROM usage_ledger WHERE owner_id=? AND period_key=? AND status IN ('reserved','completed','failed')").bind(user.id, period).first<{ total: number }>(); const limit = Number(runtime().AI_MONTHLY_REQUEST_LIMIT ?? "100"); return jsonData({ period, requestsUsed: row?.total ?? 0, requestLimit: limit, requestsRemaining: Math.max(0, limit - (row?.total ?? 0)) }); } catch (error) { return handleRouteError(error); } }
