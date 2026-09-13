import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey } from "@/server/http";
import { discardPreview } from "@/server/ai/service";
export async function POST(request: Request, { params }: { params: Promise<{ previewId: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); await discardPreview(user.id, (await params).previewId); return jsonData({ discarded: true }); } catch (error) { return handleRouteError(error); } }
