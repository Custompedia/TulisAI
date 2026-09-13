import { CheckpointSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { createCheckpoint, listVersions } from "@/server/documents/service";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); const url = new URL(request.url); return jsonData(await listVersions(user.id, (await params).id, url.searchParams.get("cursor") ?? undefined, Number(url.searchParams.get("limit") ?? 20))); } catch (error) { return handleRouteError(error); } }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, CheckpointSchema); return jsonData(await createCheckpoint(user.id, (await params).id, input.expectedRevision, input.label ?? null), { status: 201 }); } catch (error) { return handleRouteError(error); } }
