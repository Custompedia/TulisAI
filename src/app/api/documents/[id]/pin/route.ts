import { jsonData, PinSchema } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { setPinned } from "@/server/documents/service";

// Sematkan / Lepas sematan. Cosmetic: no revision and no version.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, PinSchema); return jsonData(await setPinned(user.id, (await params).id, input.pinned)); } catch (error) { return handleRouteError(error); } }
