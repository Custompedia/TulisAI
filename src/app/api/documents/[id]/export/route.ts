import { requireUser } from "@/server/auth/auth";
import { handleRouteError, RequestError } from "@/server/http";
import { getDocument } from "@/server/documents/service";
import { DOCX_CONTENT_TYPE, docxFilename, editorDocumentToDocx } from "@/lib/docx/export";
import { pageGeometry, parseMargins } from "@/lib/docx/office-defaults";
import { readLayout } from "@/components/workspace/page-layout";
import { assertDocxExport, recordDocxExportEvidence } from "@/server/documents/portability";
import { documentHtmlPieces } from "@/lib/editor/clipboard";

// Server-side so the paid gate is real: a client-side writer could simply be called directly.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "docx";
    if (format !== "docx" && format !== "html") throw new RequestError("UNSUPPORTED_FORMAT", "Choose DOCX or HTML export.", 400);
    const documentId = (await params).id; const document = await getDocument(user.id, documentId);
    if (format === "html") {
      // HTML is gated like DOCX (owner decision): Pro and up, or a notebook with DOCX evidence from before a
      // downgrade. It records no evidence of its own, so an HTML download never unlocks a later DOCX export.
      await assertDocxExport(user.id, documentId);
      const head = `<!doctype html><html lang="${document.language === "en" ? "en" : "id"}"><head><meta charset="utf-8"><title>${document.title.replace(/[&<>]/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[value]!)}</title></head><body>`;
      // Streamed block by block, so a 2,000-page notebook is never one HTML string in the Worker.
      const pieces = (function* () { yield head; yield* documentHtmlPieces(document.content); yield '</body></html>'; })();
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ pull(controller) { let batch = ''; for (let next = pieces.next(); !next.done; next = pieces.next()) { batch += next.value; if (batch.length >= 65_536) break; } if (batch) controller.enqueue(encoder.encode(batch)); else controller.close(); } });
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${encodeURIComponent(document.title || "document")}.html"`, "Cache-Control": "no-store" } });
    }
    const access = await assertDocxExport(user.id, documentId);
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
    if (!access.historical) await recordDocxExportEvidence(user.id, documentId, access.rights);
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
