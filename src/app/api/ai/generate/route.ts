import { GenerateSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { generatePreview } from "@/server/ai/service";
export async function POST(request: Request) { try { const user = await requireUser(request); const key = idempotencyKey(request); return jsonData(await generatePreview(user.id, key, await readJson(request, GenerateSchema)), { status: 201 }); } catch (error) { return handleRouteError(error); } }
