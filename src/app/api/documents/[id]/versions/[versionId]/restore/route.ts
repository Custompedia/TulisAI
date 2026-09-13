import { RestoreVersionSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { restoreVersion } from "@/server/documents/service";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, RestoreVersionSchema); const value = await params; return jsonData(await restoreVersion(user.id, value.id, value.versionId, input.expectedRevision)); } catch (error) { return handleRouteError(error); } }
