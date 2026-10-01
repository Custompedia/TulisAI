import { describe, expect, it } from 'vitest';
import { cleanPdfTitle, looksLikePdf, MAX_PDF_PAGES, pdfToEditorDocument, PdfError } from '../../src/lib/pdf/import';
import { blocksFromLines, dropRunningLines, linesFromRuns, type Line } from '../../src/lib/pdf/layout';
import { EditorDocumentSchema } from '../../src/lib/contracts';
import type { EditorNode } from '../../src/lib/editor/document';
import { buildPdf, type PdfText } from '../helpers/pdf';

const textOf = (node: EditorNode): string => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(textOf).join('');
// Lines of body text from the top margin down, 14 pt apart, the way a word processor sets 11 pt type.
const body = (lines: string[], top = 770, x = 72): PdfText[] => lines.map((text, index) => ({ x, y: top - index * 14, text }));
const errorCode = async (bytes: Uint8Array) => pdfToEditorDocument(bytes).then(() => 'ok', (error: unknown) => (error instanceof PdfError ? error.code : 'other'));

describe('PDF import: paragraphs', () => {
  it('rebuilds paragraphs from line gaps and joins the lines of one paragraph with spaces', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ texts: [
      ...body(['Paragraf pertama ini cukup panjang sehingga', 'terbagi menjadi dua baris di halaman.']),
      ...body(['Paragraf kedua dipisahkan oleh jarak yang', 'lebih lebar dari jarak antarbaris biasa.'], 730),
    ] }]));
    expect(result.content.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf pertama ini cukup panjang sehingga terbagi menjadi dua baris di halaman.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraf kedua dipisahkan oleh jarak yang lebih lebar dari jarak antarbaris biasa.' }] },
    ]);
    expect(EditorDocumentSchema.safeParse(result.content).success).toBe(true);
    expect(result.warnings).toContain('pdfLayout');
    expect(result.pages).toEqual({ total: 1, read: 1, empty: 0 });
  });

  it('starts a new paragraph at a first-line indent even without a wider gap', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ texts: [
      { x: 90, y: 770, text: 'Alinea pertama dimulai dengan menjorok' }, { x: 72, y: 756, text: 'dan berlanjut di baris berikutnya.' },
      { x: 90, y: 742, text: 'Alinea kedua juga menjorok ke dalam' }, { x: 72, y: 728, text: 'pada baris pertamanya.' },
    ] }]));
    expect(result.content.content.map(textOf)).toEqual([
      'Alinea pertama dimulai dengan menjorok dan berlanjut di baris berikutnya.',
      'Alinea kedua juga menjorok ke dalam pada baris pertamanya.',
    ]);
  });

  it('keeps a hard hyphen at a line break, so Indonesian reduplication and English compounds survive', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ texts: body(['Di halaman sekolah anak-', 'anak bermain bola, sementara pemerintah', 'daerah meninjau well-', 'known programs.']) }]));
    expect(result.content.content.map(textOf)).toEqual(['Di halaman sekolah anak-anak bermain bola, sementara pemerintah daerah meninjau well-known programs.']);
  });

  it('drops a soft hyphen at a line break, which only ever marks a split word', () => {
    const line = (text: string, y: number): Line => ({ text, x: 72, right: 400, y, size: 11, page: 1 });
    expect(blocksFromLines([line('sementara peme\u00AD', 700), line('rintah daerah.', 686)]).map(textOf)).toEqual(['sementara pemerintah daerah.']);
  });

  it('carries a paragraph over a page break only when the sentence runs on', async () => {
    const result = await pdfToEditorDocument(buildPdf([
      { texts: body(['Kalimat ini belum selesai di akhir halaman', 'pertama dan']) },
      { texts: body(['berlanjut di halaman kedua sampai titik.']) },
      { texts: body(['Halaman ketiga dimulai dengan kalimat baru.']) },
    ]));
    expect(result.content.content.map(textOf)).toEqual([
      'Kalimat ini belum selesai di akhir halaman pertama dan berlanjut di halaman kedua sampai titik.',
      'Halaman ketiga dimulai dengan kalimat baru.',
    ]);
  });
});

describe('PDF import: headings and lists', () => {
  it('maps noticeably larger type to headings, largest first', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ texts: [
      { x: 72, y: 780, text: 'Laporan Penelitian', size: 22 },
      { x: 72, y: 750, text: 'Pendahuluan', size: 16 },
      ...body(['Latar belakang penelitian ini dijelaskan', 'secara singkat di bagian awal.'], 726),
      { x: 72, y: 690, text: 'Rumusan masalah', size: 13 },
      ...body(['Pertanyaan utamanya adalah bagaimana', 'teks PDF dibaca kembali.'], 668),
    ] }]));
    expect(result.content.content.map((node) => [node.type, node.attrs?.level ?? null, textOf(node)])).toEqual([
      ['heading', 1, 'Laporan Penelitian'],
      ['heading', 2, 'Pendahuluan'],
      ['paragraph', null, 'Latar belakang penelitian ini dijelaskan secara singkat di bagian awal.'],
      ['heading', 3, 'Rumusan masalah'],
      ['paragraph', null, 'Pertanyaan utamanya adalah bagaimana teks PDF dibaca kembali.'],
    ]);
    // With no title in the metadata the first heading names the notebook.
    expect(result.title).toBe('Laporan Penelitian');
  });

  it('merges a heading set over two lines', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ texts: [
      { x: 72, y: 780, text: 'Analisis Dampak Kebijakan Publik', size: 18 }, { x: 72, y: 758, text: 'terhadap Usaha Kecil', size: 18 },
      ...body(['Isi bab ini menjelaskan dampaknya secara', 'rinci dengan data lapangan.'], 730),
    ] }]));
    expect(result.content.content[0]).toEqual({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Analisis Dampak Kebijakan Publik terhadap Usaha Kecil' }] });
  });

  it('turns bullet and numbered lines into lists, with wrapped item lines kept in their item', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ texts: [
      ...body(['Bahan yang perlu disiapkan sebelum mulai:']),
      { x: 72, y: 750, text: '• Tepung terigu dua cangkir' },
      { x: 72, y: 736, text: '• Gula pasir secukupnya sesuai' }, { x: 82, y: 722, text: 'selera keluarga' },
      { x: 72, y: 708, text: '- Telur ayam tiga butir' },
      ...body(['Langkah membuatnya sebagai berikut:'], 680),
      { x: 72, y: 660, text: '3. Kocok telur dan gula' },
      { x: 72, y: 646, text: '4) Masukkan tepung perlahan' },
    ] }]));
    expect(result.content.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Bahan yang perlu disiapkan sebelum mulai:' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tepung terigu dua cangkir' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Gula pasir secukupnya sesuai selera keluarga' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Telur ayam tiga butir' }] }] },
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Langkah membuatnya sebagai berikut:' }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kocok telur dan gula' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Masukkan tepung perlahan' }] }] },
      ] },
    ]);
  });
});

describe('PDF import: running headers, footers and page numbers', () => {
  it('drops a header and a page-number footer repeated on both pages and keeps the body', async () => {
    const page = (number: number, lines: string[]) => ({ texts: [
      { x: 72, y: 810, text: 'Jurnal Ilmu Tulis — Vol. 3', size: 9 },
      ...body(lines, 760),
      { x: 280, y: 36, text: `Halaman ${number} dari 2`, size: 9 },
    ] });
    const result = await pdfToEditorDocument(buildPdf([
      page(1, ['Isi halaman pertama berakhir di sini.']),
      page(2, ['Isi halaman kedua juga berakhir.']),
    ]));
    expect(result.content.content.map(textOf)).toEqual(['Isi halaman pertama berakhir di sini.', 'Isi halaman kedua juga berakhir.']);
  });

  it('keeps an edge line that appears on one page only', () => {
    const line = (text: string, y: number, page: number): Line => ({ text, x: 72, right: 300, y, size: 11, page });
    const pages = [[line('Judul sampul', 810, 1), line('Isi satu.', 700, 1)], [line('Isi dua.', 700, 2), line('7', 30, 2)]];
    expect(dropRunningLines(pages, [842, 842]).pages).toEqual(pages);
  });

  it('never drops the same body text sitting mid-page', () => {
    const line = (text: string, y: number, page: number): Line => ({ text, x: 72, right: 300, y, size: 11, page });
    const pages = [[line('Bagian A', 500, 1)], [line('Bagian A', 500, 2)]];
    expect(dropRunningLines(pages, [842, 842]).dropped).toBe(0);
  });
});

describe('PDF import: metadata and page size', () => {
  it('uses the document title, cleaned of the printing program, and detects Letter paper', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ width: 612, height: 792, texts: body(['Isi dokumen yang cukup untuk dibaca.']) }], { title: 'Microsoft Word - Proposal Akhir.docx' }));
    expect(result.title).toBe('Proposal Akhir');
    expect(result.pageSize).toBe('letter');
    expect(result.orientation).toBe('portrait');
  });

  it('falls back to an empty title (the dialog then uses the file name) and the language default size', async () => {
    const result = await pdfToEditorDocument(buildPdf([{ width: 400, height: 300, texts: body(['Isi slide tanpa judul besar apa pun di sini.'], 250) }], { title: 'untitled' }), { language: 'en' });
    expect(result.title).toBe('');
    expect(result.pageSize).toBe('letter');
    expect(result.orientation).toBe('landscape');
    expect(cleanPdfTitle('C:\\Users\\a\\bab1.pdf')).toBe('');
  });
});

describe('PDF import: refusals', () => {
  it('refuses an image-only PDF as a scan', async () => {
    expect(await errorCode(buildPdf([{ image: true }, { image: true }]))).toBe('PDF_SCANNED');
  });

  it('refuses a PDF whose only text is a page number on each page as a scan', async () => {
    expect(await errorCode(buildPdf([1, 2, 3].map((number) => ({ image: true, texts: [{ x: 290, y: 30, text: String(number) }] }))))).toBe('PDF_SCANNED');
  });

  it('refuses an empty PDF as having no readable text', async () => {
    expect(await errorCode(buildPdf([{}]))).toBe('PDF_SCANNED');
  });

  it('refuses a password-protected PDF with its own code', async () => {
    expect(await errorCode(buildPdf([{ texts: body(['Rahasia.']) }], { encrypted: true }))).toBe('PDF_ENCRYPTED');
  });

  it('refuses corrupt and non-PDF bytes as unreadable', async () => {
    const valid = buildPdf([{ texts: body(['Isi yang cukup panjang untuk dibaca.']) }]);
    expect(await errorCode(new TextEncoder().encode('bukan PDF sama sekali'))).toBe('PDF_UNREADABLE');
    expect(await errorCode(new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))).toBe('PDF_UNREADABLE');
    expect(await errorCode(valid.slice(0, 40))).toBe('PDF_UNREADABLE');
    expect(looksLikePdf(valid)).toBe(true);
  });

});

describe('PDF import: limits', () => {
  it(`reads at most ${MAX_PDF_PAGES} pages and says so`, async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 2 }, (_, index) => ({ texts: [{ x: 72, y: 500, text: `Halaman nomor ${index + 1} berisi kalimat pendek.` }] }));
    const result = await pdfToEditorDocument(buildPdf(pages));
    expect(result.pages).toMatchObject({ total: MAX_PDF_PAGES + 2, read: MAX_PDF_PAGES });
    expect(result.warnings).toContain('pdfPagesCapped');
  }, 30_000);

  it('stops at the character limit and keeps a valid document', async () => {
    const line = 'Kalimat panjang yang diulang terus untuk mengisi halaman demi halaman tanpa henti';
    const pages = Array.from({ length: 80 }, () => ({ texts: body(Array.from({ length: 48 }, () => line), 780) }));
    const result = await pdfToEditorDocument(buildPdf(pages));
    expect(result.warnings).toContain('pdfTruncated');
    expect(result.pages.read).toBeLessThan(80);
    expect(EditorDocumentSchema.safeParse(result.content).success).toBe(true);
  }, 30_000);
});

describe('PDF layout helpers', () => {
  it('inserts a space where the file positioned words apart instead of writing a space', () => {
    const lines = linesFromRuns([
      { str: 'Kata', x: 72, y: 700, width: 22, size: 11, eol: false },
      { str: 'berikut', x: 97, y: 700, width: 35, size: 11, eol: false },
      { str: 'ﬁnal', x: 133, y: 700, width: 20, size: 11, eol: true },
    ], 1);
    expect(lines.map((line) => line.text)).toEqual(['Kata berikutfinal']);
  });

  it('returns nothing for no lines', () => {
    expect(blocksFromLines([])).toEqual([]);
  });
});
