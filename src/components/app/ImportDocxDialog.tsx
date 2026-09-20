'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FileText, TriangleAlert, Upload } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { guardedPush } from '@/lib/client/navigation-guard';
import { documentText } from '@/lib/editor/document';
import { defaults, modeFromPrompt } from '@/lib/writing/settings';
import { DOCX_CONTENT_TYPE } from '@/lib/docx/export';
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

const MAX_BYTES = 5_000_000;
const PREVIEW_CHARACTERS = 1_200;

type Extraction = {
  title: string; content: EditorDocument; pageSize: 'a4' | 'letter'; pageMargins: string;
  orientation: Orientation; columns: number; header: RunningText | null; footer: RunningText | null; warnings: ImportWarning[];
  docxImportReceipt: string;
};

// What each warning means to the writer; the file is still imported, these parts simply do not come with it.
const WARNING_TEXT: Record<ImportWarning, [string, string]> = {
  images: ['Gambar tidak ikut diimpor — notebook ini khusus teks.', 'Images are not imported — this notebook is text only.'],
  textboxes: ['Isi kotak teks dipindahkan menjadi paragraf biasa.', 'Text box contents were moved into ordinary paragraphs.'],
  revisions: ['Perubahan terlacak yang dihapus tidak dibawa; teks final yang dipakai.', 'Tracked deletions were dropped; the final text is used.'],
  comments: ['Komentar tidak ikut diimpor.', 'Comments are not imported.'],
  endnotes: ['Catatan akhir menjadi catatan kaki.', 'Endnotes became footnotes.'],
  runningRich: ['Header/footer disederhanakan menjadi satu baris teks.', 'The header and footer were reduced to a single line of text.'],
  shapes: ['Bentuk dan diagram tidak ikut diimpor.', 'Shapes and diagrams are not imported.'],
};

// Two steps on purpose: the file is extracted and shown first, and only a confirmed preview creates a notebook.
export function ImportDocxDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { settings: prefs } = useShell();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'creating'>('');
  const [error, setError] = useState('');

  async function extract(chosen: File) {
    setFile(chosen); setExtraction(null); setError('');
    if (!chosen.name.toLowerCase().endsWith('.docx')) { setError(t('Pilih berkas .docx. Format lain belum didukung.', 'Choose a .docx file. Other formats are not supported yet.')); return; }
    if (chosen.size > MAX_BYTES) { setError(t('Berkas lebih dari 5 MB. Pisahkan dokumennya lebih dulu.', 'The file is over 5 MB. Split the document first.')); return; }
    setBusy('reading');
    try {
      const result = await request<Extraction>(`/api/documents/import?language=${prefs.writingLanguage === 'en' ? 'en' : 'id'}`, 'POST', await chosen.arrayBuffer(), newKey(), DOCX_CONTENT_TYPE);
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
      const doc = await request<{ id: string }>('/api/documents', 'POST', { title: extraction.title, language: prefs.writingLanguage, content: extraction.content, preferences, docxImportReceipt: extraction.docxImportReceipt }, newKey());
      if (!guardedPush(router, `/notebooks/${doc.id}`)) onClose();
    } catch (caught) {
      if (!guard(caught)) setError(errorText(caught, locale === 'en'));
      setBusy('');
    }
  }

  const plain = extraction ? documentText(extraction.content) : '';
  const characters = plain.length;
  const locked = error && extraction === null && busy === '';

  return (
    <Modal size="lg" busy={busy !== ''} onClose={onClose}
      title={t('Impor dokumen Word', 'Import a Word document')}
      description={t('Teks, judul, daftar, tabel dan formatnya dibawa masuk. Periksa hasilnya sebelum notebook dibuat.', 'Text, headings, lists, tables and their formatting come across. Check the result before the notebook is created.')}
      footer={<>
        <Button onClick={onClose} disabled={busy !== ''}>{t('Batal', 'Cancel')}</Button>
        {extraction && <Button onClick={() => { setExtraction(null); setFile(null); input.current?.click(); }} disabled={busy !== ''}>{t('Ganti berkas', 'Choose another file')}</Button>}
        <Button variant="primary" onClick={() => void create()} loading={busy === 'creating'} disabled={!extraction || busy !== '' || !characters}>
          {t('Buat notebook', 'Create notebook')}
        </Button>
      </>}>
      <div className="space-y-4">
        <input ref={input} type="file" accept=".docx" className="sr-only"
          onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void extract(chosen); }} />

        {!extraction && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy !== ''}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-paper px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60">
            <Upload size={22} aria-hidden="true" className="text-ink-500" />
            <span className="text-[14px] font-semibold text-ink-900">{busy === 'reading' ? t('Membaca berkas…', 'Reading the file…') : t('Pilih berkas .docx', 'Choose a .docx file')}</span>
            <span className="text-[12.5px] text-ink-500">{t('Maksimal 5 MB. Teks dan formatnya dibawa seperti di Word.', 'Up to 5 MB. Text and its formatting come across as in Word.')}</span>
          </button>
        )}

        {locked && <Alert tone="error">{error}</Alert>}

        {extraction && (
          <>
            <div className="flex items-start gap-3 rounded-xl border border-line bg-white p-3">
              <FileText size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink-900">{extraction.title}</p>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {file?.name} · {new Intl.NumberFormat(locale).format(characters)} {t('karakter', 'characters')} · {extraction.pageSize === 'letter' ? 'Letter' : 'A4'}
                </p>
              </div>
            </div>

            {!!extraction.warnings?.length && (
              <Alert tone="warning" title={t('Yang tidak ikut terbawa', 'What does not come across')}>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {extraction.warnings.map((warning) => (
                    <li key={warning}>{t(WARNING_TEXT[warning]?.[0] ?? warning, WARNING_TEXT[warning]?.[1] ?? warning)}</li>
                  ))}
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
