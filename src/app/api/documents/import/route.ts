import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, readBinary, RequestError } from "@/server/http";
import { docxToEditorDocument, DocxError } from "@/lib/docx/import";
import { formatMargins } from "@/lib/docx/office-defaults";
import { looksLikePdf, MAX_PDF_BYTES, PDF_CONTENT_TYPE, pdfToEditorDocument, PdfError } from "@/lib/pdf/import";
import { entitlement } from "@/server/usage/quota";
import { createDocxImportReceipt } from "@/server/documents/portability";
import { assertFeature } from "@/server/usage/features";

// 5 MB covers a long thesis chapter of text; images are dropped on import, so nothing bigger is useful.
const MAX_DOCX_BYTES = 5_000_000;

// Extraction only: the notebook is created by the existing POST /api/documents once the user confirms
// the preview, so a cancelled import leaves nothing behind. One route for both formats: the PDF branch is
// chosen by the declared type or by the file's own header, and every unreadable file is a 422, never a 500.
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const rights = await entitlement(user.id);
    // PDF import is the same Pro feature as DOCX import.
    assertFeature(rights, "docx_import");
    const declaredPdf = (request.headers.get("content-type") ?? "").toLowerCase().startsWith(PDF_CONTENT_TYPE);
    const bytes = await readBinary(request, declaredPdf ? MAX_PDF_BYTES : MAX_DOCX_BYTES);
    const language = new URL(request.url).searchParams.get("language") ?? "id";
    if (declaredPdf || looksLikePdf(bytes)) {
      const result = await pdfToEditorDocument(bytes, { language });
      // No DOCX import receipt: that evidence keeps DOCX export open after a downgrade, and a PDF never earns it.
      return jsonData({
        format: "pdf", title: result.title, content: result.content, pageSize: result.pageSize, pageMargins: result.pageMargins,
        orientation: result.orientation, columns: 1, header: null, footer: null, warnings: result.warnings, pages: result.pages,
      });
    }
    const result = await docxToEditorDocument(bytes, { language });
    const docxImportReceipt = await createDocxImportReceipt(user.id, result.content, rights);
    return jsonData({
      format: "docx", title: result.title, content: result.content, pageSize: result.pageSize, pageMargins: formatMargins(result.pageMargins),
      orientation: result.orientation, columns: result.columns,
      header: result.header, footer: result.footer, warnings: result.warnings, docxImportReceipt,
    });
  } catch (error) {
    if (error instanceof PdfError) return handleRouteError(new RequestError(error.code, error.message, 422));
    if (error instanceof DocxError) return handleRouteError(new RequestError("DOCX_UNREADABLE", error.message, 422));
    return handleRouteError(error);
  }
}
