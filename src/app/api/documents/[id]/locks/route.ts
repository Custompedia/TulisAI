import { LockCreateSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { createLock, listLocks } from "@/server/documents/locks";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); return jsonData(await listLocks(user.id, (await params).id)); } catch (error) { return handleRouteError(error); } }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, LockCreateSchema); return jsonData(await createLock(user.id, (await params).id, input.term), { status: 201 }); } catch (error) { return handleRouteError(error); } }
