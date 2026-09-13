import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, RequestError } from "@/server/http";
import { compareVersions } from "@/server/documents/service";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); const url = new URL(request.url); const a = url.searchParams.get("a"); const b = url.searchParams.get("b"); if (!a || !b) throw new RequestError("INVALID_REQUEST", "Both a and b version IDs are required."); return jsonData(await compareVersions(user.id, (await params).id, a, b)); } catch (error) { return handleRouteError(error); } }
