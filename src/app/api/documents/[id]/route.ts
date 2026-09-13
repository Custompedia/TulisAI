import { DocumentPatchSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { deleteDocument, getDocument, saveDocument } from "@/server/documents/service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { try { const user = await requireUser(request); return jsonData(await getDocument(user.id, (await params).id)); } catch (error) { return handleRouteError(error); } }
export async function PATCH(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, DocumentPatchSchema); return jsonData(await saveDocument(user.id, (await params).id, input.expectedRevision, input, "checkpoint", "Manual checkpoint")); } catch (error) { return handleRouteError(error); } }
export async function DELETE(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); await deleteDocument(user.id, (await params).id); return jsonData({ deleted: true }); } catch (error) { return handleRouteError(error); } }
