import { DocumentPatchSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson, RequestError } from "@/server/http";
import { getDocument, permanentlyDeleteDocument, saveDocument, trashDocument } from "@/server/documents/service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { try { const user = await requireUser(request); return jsonData(await getDocument(user.id, (await params).id)); } catch (error) { return handleRouteError(error); } }
export async function PATCH(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, DocumentPatchSchema); return jsonData(await saveDocument(user.id, (await params).id, input.expectedRevision, input, "checkpoint", "Manual checkpoint")); } catch (error) { return handleRouteError(error); } }
// Hapus moves the notebook to the trash; ?permanent=1 deletes it for good (Hapus permanen, and the auto-discard of an
// untouched outline, which is not user content). Outside the trash the client must send ?expectedRevision=, and the
// server refuses unless the notebook is still an untouched revision-0 outline or blank notebook.
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request); idempotencyKey(request); const id = (await params).id;
    const query = new URL(request.url).searchParams;
    if (query.get("permanent") === "1") {
      const raw = query.get("expectedRevision");
      if (raw !== null && !/^\d{1,9}$/.test(raw)) throw new RequestError("INVALID_REQUEST", "expectedRevision must be a whole number.");
      await permanentlyDeleteDocument(user.id, id, raw === null ? undefined : Number(raw));
      return jsonData({ deleted: true, permanent: true });
    }
    return jsonData({ deleted: true, permanent: false, ...(await trashDocument(user.id, id)) });
  } catch (error) { return handleRouteError(error); }
}
