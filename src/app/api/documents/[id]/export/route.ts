import { requireUser } from "@/server/auth/auth";
import { handleRouteError, RequestError } from "@/server/http";
import { requireFeature } from "@/server/usage/features";
import { getDocument } from "@/server/documents/service";
import { DOCX_CONTENT_TYPE, docxFilename, editorDocumentToDocx } from "@/lib/docx/export";
import { defaultPageSize, type PageSize } from "@/lib/docx/office-defaults";
import { PAGE_SIZE_PREFERENCE } from "@/lib/plans";

const asPageSize = (value: string | null, language: string): PageSize =>
  value === "a4" || value === "letter" ? value : defaultPageSize(language);

// Server-side so the paid gate is real: a client-side writer could simply be called directly.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    await requireFeature(user.id, "docx_export");
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "docx";
    if (format !== "docx") throw new RequestError("UNSUPPORTED_FORMAT", "Only DOCX export is available.", 400);
    const document = await getDocument(user.id, (await params).id);
    const language = document.language === "en" ? "en" : "id";
    // The notebook's stored page size wins, so an exported file matches what the paged preview showed.
    const stored = document.preferences?.[PAGE_SIZE_PREFERENCE];
    const requested = url.searchParams.get("pageSize") ?? (typeof stored === "string" ? stored : null);
    const bytes = await editorDocumentToDocx(document.content, {
      title: document.title,
      language,
      pageSize: asPageSize(requested, language),
    });
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": DOCX_CONTENT_TYPE,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${docxFilename(document.title)}"; filename*=UTF-8''${encodeURIComponent(docxFilename(document.title))}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) { return handleRouteError(error); }
}
