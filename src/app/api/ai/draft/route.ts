import { DraftSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { generateDraft } from "@/server/ai/service";

// UX 3, Draf dari brief: drafts one section into a preview; applying it goes through /api/ai/previews/{id}/apply.
export async function POST(request: Request) { try { const user = await requireUser(request); const key = idempotencyKey(request); return jsonData(await generateDraft(user.id, key, await readJson(request, DraftSchema)), { status: 201 }); } catch (error) { return handleRouteError(error); } }
