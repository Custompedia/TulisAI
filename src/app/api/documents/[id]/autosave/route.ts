import { AutosaveSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { autosaveDocument } from "@/server/documents/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, AutosaveSchema); return jsonData(await autosaveDocument(user.id, (await params).id, input.expectedRevision, input.content, { title: input.title, language: input.language, preferences: input.preferences })); } catch (error) { return handleRouteError(error); } }
export const PATCH = POST;
