import { AnalyzeQualitySchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { analyzeQuality } from "@/server/ai/service";
export async function POST(request: Request) { try { const user = await requireUser(request); const key = idempotencyKey(request); return jsonData(await analyzeQuality(user.id, key, await readJson(request, AnalyzeQualitySchema))); } catch (error) { return handleRouteError(error); } }
