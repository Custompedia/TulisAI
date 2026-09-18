import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, readBinary, RequestError } from "@/server/http";
import { requireFeature } from "@/server/usage/features";
import { docxToEditorDocument, DocxError } from "@/lib/docx/import";
import { formatMargins } from "@/lib/docx/office-defaults";

// 5 MB covers a long thesis chapter of text; images are dropped on import, so nothing bigger is useful.
const MAX_UPLOAD_BYTES = 5_000_000;

// Extraction only: the notebook is created by the existing POST /api/documents once the user confirms
// the preview, so a cancelled import leaves nothing behind.
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await requireFeature(user.id, "docx_import");
    const bytes = await readBinary(request, MAX_UPLOAD_BYTES);
    const language = new URL(request.url).searchParams.get("language") ?? "id";
    const result = await docxToEditorDocument(bytes, { language });
    return jsonData({ title: result.title, content: result.content, pageSize: result.pageSize, pageMargins: formatMargins(result.pageMargins) });
  } catch (error) {
    if (error instanceof DocxError) return handleRouteError(new RequestError("DOCX_UNREADABLE", error.message, 422));
    return handleRouteError(error);
  }
}
