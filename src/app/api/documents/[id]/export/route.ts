import { requireUser } from "@/server/auth/auth";
import { handleRouteError, RequestError } from "@/server/http";
import { requireFeature } from "@/server/usage/features";
import { getDocument } from "@/server/documents/service";
import { DOCX_CONTENT_TYPE, docxFilename, editorDocumentToDocx } from "@/lib/docx/export";
import { pageGeometry, parseMargins } from "@/lib/docx/office-defaults";
import { readLayout } from "@/components/workspace/page-layout";

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
    // The notebook's stored page setup wins, so an exported file matches what the paged preview showed.
    const layout = readLayout(document.preferences, language);
    const requested = url.searchParams.get("pageSize");
    const pageSize = requested === "a4" || requested === "letter" ? requested : layout.size;
    const margins = pageSize === layout.size ? layout.margins : parseMargins(null, pageSize, layout.orientation) ?? pageGeometry(pageSize, layout.orientation).margin;
    const bytes = await editorDocumentToDocx(document.content, {
      title: document.title,
      language,
      pageSize,
      margins,
      orientation: layout.orientation,
      columns: layout.columns,
      header: layout.header,
      footer: layout.footer,
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
