import { EditorDocumentSchema } from '../contracts';
import { documentText, type EditorDocument, type EditorNode } from '../editor/document';
import { documentSchema } from '../editor/extensions';
import { defaultPageSize, formatMargins, pageGeometry, type Orientation, type PageSize } from '../docx/office-defaults';
import { MAX_IMPORT_CHARACTERS } from '../docx/import';
import { blocksFromLines, dropRunningLines, linesFromRuns, type Line, type TextRun } from './layout';
import { MAX_PDF_PAGES, type PdfPages, type PdfWarning } from './constants';

export { MAX_PDF_BYTES, MAX_PDF_PAGES, PDF_CONTENT_TYPE, PDF_WARNINGS, type PdfWarning } from './constants';

// Text PDFs only: the text layer is read with PDF.js (the serverless build from unpdf, which runs in a Worker
// without Node APIs). Scans have no text layer and are refused with their own code instead of importing nothing.

export type PdfErrorCode = 'PDF_ENCRYPTED' | 'PDF_SCANNED' | 'PDF_UNREADABLE';
export class PdfError extends Error {
  constructor(readonly code: PdfErrorCode, message: string) { super(message); this.name = 'PdfError'; }
}

export type PdfImport = {
  content: EditorDocument; title: string; pageSize: PageSize; pageMargins: string; orientation: Orientation;
  warnings: PdfWarning[]; pages: PdfPages;
};

// pdf.js accepts a header anywhere in the first kilobyte, as some writers put junk before it.
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

// A text layer this thin is a scan, or a scan with a stamped page number.
const MIN_LETTERS = 20;
const MIN_LETTERS_PER_PAGE = 12;
const letters = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

// Office writers fill /Title with the file they printed from ("Microsoft Word - Bab 1.docx"); that is not a title.
export function cleanPdfTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const title = value.replace(/^Microsoft (?:Word|PowerPoint|Excel) - /iu, '').replace(/\.(?:docx?|pdf|odt|rtf|pptx?|xlsx?|tex|indd|pages)$/iu, '').replace(/\s+/gu, ' ').trim();
  if (!title || /^(?:untitled|tanpa judul|document\d*|dokumen\d*)$/iu.test(title) || /[\\/]/u.test(title)) return '';
  return title.slice(0, 180);
}

const textOf = (node: EditorNode): string => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(textOf).join('');

// Within a few points of A4 or Letter is that sheet; anything else (slides, A5, legal) falls back to the language default.
function pageSizeOf(width: number, height: number, language: string): { pageSize: PageSize; orientation: Orientation } {
  const short = Math.min(width, height); const long = Math.max(width, height);
  const near = (w: number, h: number) => Math.abs(short - w) <= 6 && Math.abs(long - h) <= 6;
  const pageSize: PageSize = near(595.28, 841.89) ? 'a4' : near(612, 792) ? 'letter' : defaultPageSize(language);
  return { pageSize, orientation: width > height ? 'landscape' : 'portrait' };
}

type TextItem = { str?: string; transform?: number[]; width?: number; hasEOL?: boolean };

export async function pdfToEditorDocument(bytes: Uint8Array, options: { language?: string } = {}): Promise<PdfImport> {
  if (!looksLikePdf(bytes)) throw new PdfError('PDF_UNREADABLE', 'This file is not a PDF document.');
  const language = options.language ?? 'id';
  const { getDocumentProxy } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // No font loading, no WebAssembly and no fetching of font or CMap files: only the text layer is wanted.
    pdf = await getDocumentProxy(bytes.slice(), {
      disableFontFace: true, useSystemFonts: false, standardFontDataUrl: undefined, cMapUrl: undefined, useWasm: false,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      disableAutoFetch: true, disableStream: true, disableRange: true, enableXfa: false, verbosity: 0,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new PdfError('PDF_ENCRYPTED', 'This PDF is password-protected.');
    throw new PdfError('PDF_UNREADABLE', 'This PDF could not be read.');
  }

  try {
    const total = pdf.numPages;
    const warnings = new Set<PdfWarning>(['pdfLayout']);
    const limit = Math.min(total, MAX_PDF_PAGES);
    if (total > MAX_PDF_PAGES) warnings.add('pdfPagesCapped');
    const pages: Line[][] = []; const heights: number[] = [];
    let raw = 0; let found = 0; let empty = 0; let first: { width: number; height: number } | null = null;
    for (let number = 1; number <= limit; number++) {
      let runs: TextRun[] = []; let height = 0;
      try {
        const page = await pdf.getPage(number);
        const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
        height = Math.abs(y1 - y0);
        first ??= { width: Math.abs(x1 - x0), height };
        const content = await page.getTextContent();
        runs = (content.items as TextItem[]).filter((item) => typeof item.str === 'string' && Array.isArray(item.transform)).map((item) => {
          const [, , c = 0, d = 0, e = 0, f = 0] = item.transform!;
          // Positions are taken relative to the visible box, whose origin is not always 0,0.
          return { str: item.str!, x: e - Math.min(x0, x1), y: f - Math.min(y0, y1), width: item.width ?? 0, size: Math.hypot(c, d), eol: !!item.hasEOL };
        });
        page.cleanup();
      } catch (error) {
        if (error instanceof Error && error.name === 'PasswordException') throw new PdfError('PDF_ENCRYPTED', 'This PDF is password-protected.');
        // One damaged page should not sink the rest; it simply has no text.
        runs = [];
      }
      const lines = linesFromRuns(runs, number);
      const count = letters(lines.map((line) => line.text).join(''));
      if (count < 3) empty++;
      found += count;
      raw += lines.reduce((sum, line) => sum + line.text.length + 1, 0);
      pages.push(lines); heights.push(height);
      // Past the import limit the rest would be cut anyway; stopping here also bounds the CPU spent.
      if (raw > MAX_IMPORT_CHARACTERS && number < total) { warnings.add('pdfTruncated'); break; }
    }

    if (found < MIN_LETTERS || (pages.length >= 3 && found / pages.length < MIN_LETTERS_PER_PAGE)) {
      throw new PdfError('PDF_SCANNED', 'This PDF contains scanned images; its text cannot be read yet.');
    }
    if (empty) warnings.add('pdfEmptyPages');

    const kept = dropRunningLines(pages, heights).pages.flat();
    let blocks = blocksFromLines(kept);
    // The stored notebook counts block separators too; trailing blocks go until the result fits.
    const measure = (nodes: EditorNode[]) => documentText({ type: 'doc', content: nodes }).length;
    if (blocks.length > 12_000) { blocks = blocks.slice(0, 12_000); warnings.add('pdfTruncated'); }
    if (measure(blocks) > MAX_IMPORT_CHARACTERS) {
      // The longest run of leading blocks that fits.
      let low = 0; let high = blocks.length;
      while (low < high) { const middle = Math.ceil((low + high) / 2); if (measure(blocks.slice(0, middle)) <= MAX_IMPORT_CHARACTERS) low = middle; else high = middle - 1; }
      blocks = blocks.slice(0, low);
      warnings.add('pdfTruncated');
    }
    if (!blocks.length) throw new PdfError('PDF_SCANNED', 'This PDF contains scanned images; its text cannot be read yet.');

    const content = EditorDocumentSchema.parse({ type: 'doc', content: blocks });
    documentSchema.nodeFromJSON(content).check();

    let metaTitle = '';
    try {
      const meta = await pdf.getMetadata();
      metaTitle = cleanPdfTitle((meta.info as Record<string, unknown> | undefined)?.Title) || cleanPdfTitle(meta.metadata?.get('dc:title'));
    } catch { metaTitle = ''; }
    const heading = content.content.find((node) => node.type === 'heading' && textOf(node).trim());
    const title = metaTitle || (heading ? textOf(heading).replace(/\s+/gu, ' ').trim().slice(0, 180) : '');

    const { pageSize, orientation } = pageSizeOf(first?.width ?? 0, first?.height ?? 0, language);
    return {
      content, title, pageSize, orientation, pageMargins: formatMargins(pageGeometry(pageSize, orientation).margin),
      warnings: [...warnings], pages: { total, read: pages.length, empty },
    };
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError('PDF_UNREADABLE', 'This PDF could not be read.');
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
