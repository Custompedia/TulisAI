// Shared by the import route and the import dialog; kept apart from the reader so the browser bundle never pulls in PDF.js.

export const PDF_CONTENT_TYPE = 'application/pdf';
export const MAX_PDF_BYTES = 10_000_000;
// Each page costs CPU to parse; past this the import stops and says so, which keeps one request inside the Worker budget.
export const MAX_PDF_PAGES = 300;

// pdfLayout is always given: a PDF has no tables, columns or images as such, only positioned text.
export const PDF_WARNINGS = ['pdfLayout', 'pdfPagesCapped', 'pdfTruncated', 'pdfEmptyPages'] as const;
export type PdfWarning = (typeof PDF_WARNINGS)[number];
export type PdfPages = { total: number; read: number; empty: number };
