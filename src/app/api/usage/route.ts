import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { usageSummary } from "@/server/usage/quota";
export async function GET(request: Request) { try { const user = await requireUser(request); return jsonData(await usageSummary(user.id)); } catch (error) { return handleRouteError(error); } }
