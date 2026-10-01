import { DocumentCreateSchema, DocumentListQuerySchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { DOCUMENT_JSON, handleRouteError, idempotencyKey, readJson, RequestError } from "@/server/http";
import { createDocument, libraryCounts, listDocuments } from "@/server/documents/service";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request); const url = new URL(request.url);
    const parsed = DocumentListQuerySchema.safeParse(Object.fromEntries([...url.searchParams].filter(([key]) => key !== "cursor" && key !== "limit")));
    if (!parsed.success) throw new RequestError("INVALID_REQUEST", "The list filters are invalid.", 400);
    const query = parsed.data;
    const page = await listDocuments(user.id, url.searchParams.get("cursor") ?? undefined, Number(url.searchParams.get("limit") ?? 20), { q: query.q, mode: query.mode, docType: query.docType, sort: query.sort, pinned: !!query.pinned, trash: !!query.trash });
    return jsonData(query.counts ? { ...page, counts: await libraryCounts(user.id) } : page);
  } catch (error) { return handleRouteError(error); }
}
// ?lean=1 answers with the notebook's metadata only: the client that just sent a long document does not need it back.
export async function POST(request: Request) {
  try {
    const user = await requireUser(request); idempotencyKey(request);
    const created = await createDocument(user.id, await readJson(request, DocumentCreateSchema, DOCUMENT_JSON));
    if (new URL(request.url).searchParams.get("lean") === "1") { const { content: _content, ...meta } = created; void _content; return jsonData(meta, { status: 201 }); }
    return jsonData(created, { status: 201 });
  } catch (error) { return handleRouteError(error); }
}
