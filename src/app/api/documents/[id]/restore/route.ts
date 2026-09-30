import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey } from "@/server/http";
import { restoreDocument } from "@/server/documents/service";

// Pulihkan: takes a notebook out of the trash, unchanged.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); return jsonData(await restoreDocument(user.id, (await params).id)); } catch (error) { return handleRouteError(error); } }
