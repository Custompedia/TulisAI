'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { MAX_DOCX_BYTES } from '@/lib/limits';
import { FileText, TriangleAlert, Upload } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { guardedPush } from '@/lib/client/navigation-guard';
import { documentText } from '@/lib/editor/document';
import { defaults, modeFromPrompt } from '@/lib/writing/settings';
import { DOCX_CONTENT_TYPE } from '@/lib/docx/export';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, PDF_CONTENT_TYPE, type PdfPages, type PdfWarning } from '@/lib/pdf/constants';
import { ADVANCED_PREFERENCE } from '@/lib/plans';
import { layoutPreferences } from '@/components/workspace/page-layout';
import type { ImportWarning } from '@/lib/docx/runs';
import type { RunningText } from '@/lib/docx/running';
import { PAGES, parseMargins, type Orientation } from '@/lib/docx/office-defaults';
import type { EditorDocument } from '@/lib/editor/document';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Toast } from '@/components/ui/Toast';
import { Alert } from '@/components/ui/Alert';
import { useSessionGuard, useShell } from './AppShell';

// A long thesis with its figures: pictures are never read, so the upload cap is about the file, not the text.
type Format = 'docx' | 'pdf';
// The extension decides what the file is meant to be; the server checks the bytes themselves.
const formatOf = (name: string): Format | null => (/\.docx$/iu.test(name) ? 'docx' : /\.pdf$/iu.test(name) ? 'pdf' : null);
const PREVIEW_CHARACTERS = 1_200;

type Extraction = {
  format: Format; title: string; content: EditorDocument; pageSize: 'a4' | 'letter'; pageMargins: string;
  orientation: Orientation; columns: number; header: RunningText | null; footer: RunningText | null; warnings: Array<ImportWarning | PdfWarning>;
  // Only a DOCX import carries the receipt; a PDF never earns DOCX portability evidence.
  docxImportReceipt?: string; pages?: PdfPages;
};

// What each warning means to the writer; the file is still imported, these parts simply do not come with it.
const WARNING_TEXT: Record<ImportWarning | 'pdfLayout', [string, string]> = {
  images: ['Gambar tidak diimpor; tempatnya dibiarkan kosong seukuran aslinya, jadi letak dan gaya teks tetap sama.', 'Images are not imported; their place is kept as an empty space of the same size, so the text keeps its position and style.'],
  imageWrap: ['Sebagian gambar berada di tengah teks; ruangnya dibuat selebar baris, jadi letak teks di sekitarnya bisa sedikit bergeser.', 'Some images sat in the middle of the text; their space takes the full line, so the text around them may shift slightly.'],
  sectionsDiffer: ['Bagian dokumen memakai ukuran atau margin halaman yang berbeda; notebook memakai pengaturan halaman bagian pertama.', 'The document’s sections use different page sizes or margins; the notebook uses the first section’s page setup.'],
  textboxes: ['Isi kotak teks dipindahkan menjadi paragraf biasa.', 'Text box contents were moved into ordinary paragraphs.'],
  revisions: ['Perubahan terlacak yang dihapus tidak dibawa; teks final yang dipakai.', 'Tracked deletions were dropped; the final text is used.'],
  comments: ['Komentar tidak ikut diimpor.', 'Comments are not imported.'],
  endnotes: ['Catatan akhir menjadi catatan kaki.', 'Endnotes became footnotes.'],
  runningRich: ['Header/footer disederhanakan menjadi satu baris teks.', 'The header and footer were reduced to a single line of text.'],
  shapes: ['Bentuk dan diagram tidak ikut diimpor.', 'Shapes and diagrams are not imported.'],
  pdfLayout: ['Tabel dan kolom dari PDF dibuat sebagai teks biasa, dan gambar tidak ikut. Periksa sebelum membuat notebook.', 'Tables and columns from the PDF come across as plain text, and images are left out. Check before creating the notebook.'],
};

// The PDF warnings that name a page count.
function warningText(warning: ImportWarning | PdfWarning, pages: PdfPages | undefined, format: (value: number) => string): [string, string] {
  const read = format(pages?.read ?? 0); const total = format(pages?.total ?? 0); const empty = format(pages?.empty ?? 0);
  switch (warning) {
    case 'pdfPagesCapped': return [`PDF ini ${total} halaman; hanya ${format(MAX_PDF_PAGES)} halaman pertama yang dibaca. Pisahkan PDF-nya untuk sisanya.`, `This PDF has ${total} pages; only the first ${format(MAX_PDF_PAGES)} are read. Split the PDF for the rest.`];
    case 'pdfTruncated': return [`Teksnya melebihi batas 200.000 karakter, jadi hanya bagian awal (sekitar ${read} dari ${total} halaman) yang dibawa. Pisahkan PDF-nya untuk sisanya.`, `The text is over the 200,000-character limit, so only the beginning (about ${read} of ${total} pages) comes across. Split the PDF for the rest.`];
    case 'pdfEmptyPages': return [`${empty} halaman tidak berisi teks yang terbaca (kosong atau gambar hasil scan) dan dilewati.`, `${empty} pages have no readable text (blank or scanned) and were skipped.`];
    default: return WARNING_TEXT[warning] ?? [warning, warning];
  }
}

// Two steps on purpose: the file is extracted and shown first, and only a confirmed preview creates a notebook.
export function ImportDocumentDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { settings: prefs } = useShell();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const format = file ? formatOf(file.name) : null;
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'creating'>('');
  const [error, setError] = useState('');

  async function extract(chosen: File) {
    setFile(chosen); setExtraction(null); setError('');
    const kind = formatOf(chosen.name);
    if (!kind) { setError(t('Pilih berkas .docx atau .pdf. Format lain belum didukung.', 'Choose a .docx or .pdf file. Other formats are not supported yet.')); return; }
    if (kind === 'docx' && chosen.size > MAX_DOCX_BYTES) { setError(t('Berkas DOCX lebih dari 50 MB. Pisahkan dokumennya lebih dulu.', 'The DOCX file is over 50 MB. Split the document first.')); return; }
    if (kind === 'pdf' && chosen.size > MAX_PDF_BYTES) { setError(t('Berkas PDF lebih dari 10 MB. Pisahkan PDF-nya lebih dulu.', 'The PDF is over 10 MB. Split the PDF first.')); return; }
    setBusy('reading');
    try {
      const result = await request<Extraction>(`/api/documents/import?language=${prefs.writingLanguage === 'en' ? 'en' : 'id'}`, 'POST', await chosen.arrayBuffer(), newKey(), kind === 'pdf' ? PDF_CONTENT_TYPE : DOCX_CONTENT_TYPE);
      setExtraction(result);
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { setBusy(''); }
  }

  async function create() {
    if (!extraction || busy) return;
    setBusy('creating'); setError('');
    try {
      const mode = modeFromPrompt(prefs.defaultMode) ?? 'humanize';
      // Advanced mode on and the file's own page size and margins stored, so the notebook opens looking like the document.
      const preferences = {
        ...defaults, mode, language: prefs.writingLanguage, context: prefs.humanizerContext, [ADVANCED_PREFERENCE]: true,
        ...layoutPreferences({
          size: extraction.pageSize, margins: parseMargins(extraction.pageMargins, extraction.pageSize, extraction.orientation) ?? PAGES[extraction.pageSize].margin,
          orientation: extraction.orientation, columns: extraction.columns, header: extraction.header, footer: extraction.footer,
        }),
      };
      // A PDF has no title of its own more often than not; the file name stands in.
      const title = extraction.title.trim() || file?.name.replace(/\.(?:docx|pdf)$/iu, '').trim().slice(0, 180) || t('Dokumen impor', 'Imported document');
      const doc = await request<{ id: string }>('/api/documents?lean=1', 'POST', { title, language: prefs.writingLanguage, content: extraction.content, preferences, ...(extraction.docxImportReceipt ? { docxImportReceipt: extraction.docxImportReceipt } : {}) }, newKey());
      if (!guardedPush(router, `/notebooks/${doc.id}`)) onClose();
    } catch (caught) {
      if (!guard(caught)) setError(errorText(caught, locale === 'en'));
      setBusy('');
    }
  }

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  // Once per extraction: a 2,000-page import is not flattened again on every render of the dialog.
  const plain = useMemo(() => (extraction ? documentText(extraction.content) : ''), [extraction]);
  const characters = plain.length;
  const locked = error && extraction === null && busy === '';

  return (
    <Modal size="lg" busy={busy !== ''} onClose={onClose}
      title={t('Impor dokumen', 'Import document')}
      description={t('Word (.docx) dibawa lengkap dengan formatnya; dari PDF berteks dibawa teks, judul dan daftarnya. Periksa hasilnya sebelum notebook dibuat.', 'Word (.docx) comes across with its formatting; from a text PDF come its text, headings and lists. Check the result before the notebook is created.')}
      footer={<>
        <Button onClick={onClose} disabled={busy !== ''}>{t('Batal', 'Cancel')}</Button>
        {extraction && <Button onClick={() => { setExtraction(null); setFile(null); input.current?.click(); }} disabled={busy !== ''}>{t('Ganti berkas', 'Choose another file')}</Button>}
        <Button variant="primary" onClick={() => void create()} loading={busy === 'creating'} disabled={!extraction || busy !== '' || !characters}>
          {t('Buat notebook', 'Create notebook')}
        </Button>
      </>}>
      <div className="space-y-4">
        <input ref={input} type="file" accept={`.docx,.pdf,${DOCX_CONTENT_TYPE},${PDF_CONTENT_TYPE}`} className="sr-only"
          onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void extract(chosen); }} />

        {!extraction && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy !== ''}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-paper px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60">
            <Upload size={22} aria-hidden="true" className="text-ink-500" />
            <span className="text-[14px] font-semibold text-ink-900">{busy === 'reading' ? (format === 'pdf' ? t('Membaca PDF…', 'Reading the PDF…') : t('Membaca berkas…', 'Reading the file…')) : t('Pilih berkas .docx atau .pdf', 'Choose a .docx or .pdf file')}</span>
            <span className="text-[12.5px] text-ink-500">{t('DOCX maksimal 50 MB, PDF maksimal 10 MB. PDF hasil scan belum bisa dibaca.', 'DOCX up to 50 MB, PDF up to 10 MB. Scanned PDFs cannot be read yet.')}</span>
          </button>
        )}

        {locked && <Alert tone="error">{error}</Alert>}

        {extraction && (
          <>
            <div className="flex items-start gap-3 rounded-xl border border-line bg-white p-3">
              <FileText size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-500" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-900">
                  <span className="min-w-0 truncate">{extraction.title || file?.name}</span>
                  <span className="shrink-0 rounded bg-ink-100 px-1.5 py-px text-[11px] font-semibold text-ink-600">{extraction.format === 'pdf' ? 'PDF' : 'Word · DOCX'}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {file?.name} · {number(characters)} {t('karakter', 'characters')}
                  {extraction.format === 'pdf' && extraction.pages ? <> · {number(extraction.pages.read)} {t('halaman', 'pages')}</> : null} · {extraction.pageSize === 'letter' ? 'Letter' : 'A4'}
                </p>
              </div>
            </div>

            {!!extraction.warnings?.length && (
              <Alert tone="warning" title={t('Yang tidak ikut terbawa', 'What does not come across')}>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {extraction.warnings.map((warning) => {
                    const [id, en] = warningText(warning, extraction.pages, number);
                    return <li key={warning}>{t(id, en)}</li>;
                  })}
                </ul>
              </Alert>
            )}

            {!characters ? (
              <Alert tone="error" title={t('Tidak ada teks yang terbaca', 'No readable text')}>
                {t('Dokumen ini kosong atau isinya berupa gambar. Coba berkas lain.', 'This document is empty or its content is an image. Try another file.')}
              </Alert>
            ) : (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                  {t('Pratinjau teks', 'Text preview')}
                </p>
                <div className="scrollbar-thin max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-3 text-[13px] leading-relaxed text-ink-800">
                  {plain.slice(0, PREVIEW_CHARACTERS)}
                  {characters > PREVIEW_CHARACTERS && <span className="text-ink-400">… </span>}
                </div>
                {characters > PREVIEW_CHARACTERS && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-500">
                    <TriangleAlert size={13} aria-hidden="true" className="text-ink-400" />
                    {t('Pratinjau dipotong; seluruh isi tetap dibawa masuk.', 'The preview is cut short; the whole document is still imported.')}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {error && !locked && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Impor gagal', 'Import failed')}>{error}</Toast>}
    </Modal>
  );
}
