import { ApplyPreviewSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { applyPreview } from "@/server/ai/service";
export async function POST(request: Request, { params }: { params: Promise<{ previewId: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, ApplyPreviewSchema); return jsonData(await applyPreview(user.id, (await params).previewId, input.expectedRevision, input.selectedAlternative)); } catch (error) { return handleRouteError(error); } }
