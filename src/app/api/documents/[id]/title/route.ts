import { DocumentTitleSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { renameDocument } from "@/server/documents/service";

// Title only: no content round trip and no "Manual checkpoint" version, unlike PATCH /api/documents/[id].
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, DocumentTitleSchema); return jsonData(await renameDocument(user.id, (await params).id, input.expectedRevision, input.title)); } catch (error) { return handleRouteError(error); } }
