import { DocumentPatchSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { deleteDocument, getDocument, saveDocument, trashDocument } from "@/server/documents/service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { try { const user = await requireUser(request); return jsonData(await getDocument(user.id, (await params).id)); } catch (error) { return handleRouteError(error); } }
export async function PATCH(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, DocumentPatchSchema); return jsonData(await saveDocument(user.id, (await params).id, input.expectedRevision, input, "checkpoint", "Manual checkpoint")); } catch (error) { return handleRouteError(error); } }
// Hapus moves the notebook to the trash; ?permanent=1 deletes it for good (Hapus permanen, and the auto-discard of an
// untouched outline, which is not user content).
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request); idempotencyKey(request); const id = (await params).id;
    if (new URL(request.url).searchParams.get("permanent") === "1") { await deleteDocument(user.id, id); return jsonData({ deleted: true, permanent: true }); }
    return jsonData({ deleted: true, permanent: false, ...(await trashDocument(user.id, id)) });
  } catch (error) { return handleRouteError(error); }
}
