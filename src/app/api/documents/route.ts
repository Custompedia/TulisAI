import { DocumentCreateSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { createDocument, listDocuments } from "@/server/documents/service";

export async function GET(request: Request) { try { const user = await requireUser(request); const url = new URL(request.url); return jsonData(await listDocuments(user.id, url.searchParams.get("cursor") ?? undefined, Number(url.searchParams.get("limit") ?? 20))); } catch (error) { return handleRouteError(error); } }
export async function POST(request: Request) { try { const user = await requireUser(request); idempotencyKey(request); return jsonData(await createDocument(user.id, await readJson(request, DocumentCreateSchema)), { status: 201 }); } catch (error) { return handleRouteError(error); } }
