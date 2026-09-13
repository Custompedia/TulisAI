'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, ClipboardPaste, FilePlus2, Languages, Trash2, TriangleAlert } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { plainTextDocument } from '@/lib/editor/document';
import { countCharacters, countWords } from '@/lib/editor/metrics';
import { numberFormat } from '@/lib/client/format';
import { AI_SCOPE_LIMIT, defaults, detectLanguage, MIN_WORDS, modeFromPrompt, type Settings, type WritingLanguage } from '@/lib/writing/settings';
import { useSessionGuard, useShell } from '@/components/app/AppShell';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import { CustomizePanel, ModeOptions, ModePicker } from '@/components/writing/WritingControls';
import { generateLabel, requestSummary } from '@/components/writing/modes';

const DRAFT_KEY = 'composer-draft';

export function Composer({ variant = 'dashboard' }: { variant?: 'dashboard' | 'new' }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { settings: prefs, usage } = useShell();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState<Settings>(() => ({ ...defaults, mode: modeFromPrompt(prefs.defaultMode) ?? 'standard', language: prefs.writingLanguage, context: prefs.humanizerContext }));
  const [busy, setBusy] = useState<'generate' | 'blank' | null>(null);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { try { const saved = sessionStorage.getItem(DRAFT_KEY); if (saved) setText(saved); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { try { if (text) sessionStorage.setItem(DRAFT_KEY, text); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ } }, [text]);

  const words = countWords(text);
  const detected = detectLanguage(text);
  const tooLong = text.length > AI_SCOPE_LIMIT;
  const outOfQuota = usage !== null && usage.requestsRemaining <= 0;
  const needsLanguage = settings.language === 'auto' && words >= MIN_WORDS && !detected;
  const ready = words >= MIN_WORDS;
  const languageName = (value: 'id' | 'en' | null) => (value === 'id' ? 'Bahasa Indonesia' : value === 'en' ? 'English' : t('belum jelas', 'unclear'));

  async function create(generate: boolean) {
    if (busy) return;
    setBusy(generate ? 'generate' : 'blank'); setError('');
    const firstLine = text.trim().split('\n')[0]?.slice(0, 60).trim();
    const docTitle = title.trim() || (generate && firstLine ? firstLine : t('Dokumen tanpa judul', 'Untitled document'));
    try {
      const doc = await request<{ id: string }>('/api/documents', 'POST', { title: docTitle, language: settings.language, content: plainTextDocument(generate || variant === 'new' ? text : ''), preferences: settings }, newKey());
      if (generate && !tooLong) sessionStorage.setItem(`writing-generate:${doc.id}`, '1');
      sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/documents/${doc.id}${generate && !tooLong ? '?autoGenerate=1' : ''}`);
    } catch (caught) {
      if (!guard(caught)) setError(errorText(caught, locale === 'en'));
      setBusy(null);
    }
  }

  async function paste() {
    try { const value = await navigator.clipboard.readText(); if (value) setText((current) => (current ? `${current}\n${value}` : value)); }
    catch { setError(t('Browser tidak mengizinkan akses clipboard. Tempel dengan Ctrl+V.', 'The browser blocked clipboard access. Paste with Ctrl+V.')); }
  }

  const disabled = busy !== null;
  return (
    <section aria-label={t('Mulai menulis', 'Start writing')} className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgb(10_16_36/0.04),0_12px_32px_-12px_rgb(10_16_36/0.12)]">
      {variant === 'new' && (
        <div className="border-b border-line px-5 pt-5 pb-4 sm:px-7">
          <label htmlFor="doc-title" className="sr-only">{t('Judul dokumen', 'Document title')}</label>
          <input id="doc-title" value={title} maxLength={180} disabled={disabled} onChange={(event) => setTitle(event.target.value)} placeholder={t('Judul dokumen (opsional)', 'Document title (optional)')} className="w-full bg-transparent font-serif text-2xl font-semibold text-ink-950 placeholder:text-ink-300 focus:outline-none" />
        </div>
      )}
      <div className="relative">
        <label htmlFor="composer-text" className="sr-only">{t('Teks yang ingin diperbaiki', 'Text to improve')}</label>
        <textarea
          id="composer-text" value={text} disabled={disabled} maxLength={200_000} onChange={(event) => setText(event.target.value)}
          placeholder={t('Tulis atau tempel teks yang ingin kamu perbaiki…', 'Write or paste the text you want to improve…')}
          className="block min-h-[240px] w-full resize-y bg-transparent px-5 py-5 font-serif text-[17px] leading-[1.75] text-ink-900 placeholder:text-ink-300 focus:outline-none sm:min-h-[280px] sm:px-7"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-paper/50 px-5 py-2.5 text-xs text-ink-500 sm:px-7">
          <span><b className="font-semibold text-ink-800">{numberFormat(words, locale)}</b> {t('kata', 'words')}</span>
          <span><b className="font-semibold text-ink-800">{numberFormat(countCharacters(text), locale)}</b> {t('karakter', 'characters')}</span>
          {settings.language === 'auto' && words > 0 && <span className="inline-flex items-center gap-1.5"><Languages size={13} aria-hidden="true" />{t('Terdeteksi', 'Detected')}: {languageName(detected)}</span>}
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" icon={ClipboardPaste} disabled={disabled} onClick={() => void paste()}>{t('Tempel', 'Paste')}</Button>
            {text && <Button size="sm" variant="ghost" icon={Trash2} disabled={disabled} onClick={() => setConfirmClear(true)}>{t('Hapus', 'Clear')}</Button>}
          </span>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-7">
        <div>
          <p className="mb-2.5 text-[13px] font-semibold text-ink-700">{t('Kamu ingin teks ini menjadi seperti apa?', 'What should this text become?')}</p>
          <ModePicker value={settings.mode} disabled={disabled} onChange={(mode) => setSettings({ ...settings, mode })} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div><p className="mb-1.5 text-[13px] font-semibold text-ink-700">{t('Bahasa tulisan', 'Writing language')}</p><Segmented<WritingLanguage> label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={disabled} onChange={(language) => setSettings({ ...settings, language })} options={[{ value: 'auto', label: 'Auto' }, { value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} /></div>
          <ModeOptions settings={settings} disabled={disabled} onChange={setSettings} />
        </div>
        <CustomizePanel settings={settings} disabled={disabled} onChange={setSettings} />

        {error && <Alert tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error} {t('Teksmu tidak hilang.', 'Your text is kept.')}</Alert>}
        {needsLanguage && <Alert tone="warning">{t('Bahasa belum terdeteksi. Pilih Indonesia atau English sebelum melanjutkan.', 'The language could not be detected. Choose Indonesian or English first.')}</Alert>}
        {tooLong && <Alert tone="warning" title={t('Teks cukup panjang', 'Long text')}>{t(`Lebih dari ${numberFormat(AI_SCOPE_LIMIT, locale)} karakter. Buka sebagai dokumen, lalu perbaiki per paragraf atau bagian terpilih.`, `Over ${numberFormat(AI_SCOPE_LIMIT, 'en')} characters. Open it as a document, then improve it by paragraph or selection.`)}</Alert>}
        {outOfQuota && <Alert tone="warning">{t('Batas AI bulan ini sudah habis. Kamu tetap bisa membuat dan mengedit dokumen.', 'This month’s AI limit is used up. You can still create and edit documents.')}</Alert>}

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center">
          <Button icon={FilePlus2} disabled={disabled} loading={busy === 'blank'} onClick={() => void create(false)}>{variant === 'new' && text.trim() ? t('Simpan tanpa AI', 'Save without AI') : t('Buat Dokumen Kosong', 'Blank document')}</Button>
          <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:items-end">
            {ready ? (
              <>
                <p className="truncate text-xs text-ink-500 sm:text-right">{requestSummary(settings, t)}</p>
                <Button variant="primary" size="lg" iconRight={ArrowRight} loading={busy === 'generate'} disabled={disabled || needsLanguage || outOfQuota} onClick={() => void create(true)}>
                  {tooLong ? t('Buka sebagai dokumen', 'Open as document') : busy === 'generate' ? t('Menyiapkan…', 'Preparing…') : generateLabel(settings.mode, t)}
                </Button>
              </>
            ) : (
              <p className="inline-flex items-center gap-2 text-[13px] text-ink-400"><TriangleAlert size={14} aria-hidden="true" />{words === 0 ? t('Mulai dengan menulis atau menempelkan teks.', 'Start by writing or pasting text.') : t(`Tulis minimal ${MIN_WORDS} kata untuk mulai.`, `Write at least ${MIN_WORDS} words to start.`)}</p>
            )}
          </div>
        </div>
      </div>
      {confirmClear && <ConfirmDialog title={t('Hapus teks?', 'Clear text?')} description={t('Teks di kotak ini akan dikosongkan.', 'The text in this box will be cleared.')} confirmLabel={t('Ya, hapus', 'Yes, clear')} tone="danger" onClose={() => setConfirmClear(false)} onConfirm={() => { setText(''); setConfirmClear(false); }} />}
    </section>
  );
}

