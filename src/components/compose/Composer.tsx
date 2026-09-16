'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ClipboardPaste, Plus, SlidersHorizontal, Trash2, TriangleAlert, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { plainTextDocument } from '@/lib/editor/document';
import { countWords } from '@/lib/editor/metrics';
import { numberFormat } from '@/lib/client/format';
import { AI_SCOPE_LIMIT, defaults, detectLanguage, LEGACY_CUSTOM_PROMPT, MIN_WORDS, modeFromPrompt, normalizeSettings, type Mode, type Settings, type WritingLanguage } from '@/lib/writing/settings';
import { applyStyle, reconcileStyle } from '@/lib/writing/styles';
import { useWritingStyles } from '@/lib/client/styles-store';
import { useSessionGuard, useShell } from '@/components/app/AppShell';
import { COMPOSER_FOCUS_EVENT } from '@/components/app/Sidebar';
import { pressGreen, raisedGreen } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { CustomizePanel } from '@/components/writing/WritingControls';
import { academicOptions, contextOptions, creativityOptions, humanizeStrengthOptions, languageOptions, modeIcon, modeLabel, modeToneClass, preservationOptions, recipientOptions, requestSummary, simplifyForOptions, strengthOptions } from '@/components/writing/modes';
import { CHIP, ChipRow, ChipSelect } from './ComposerChips';

const DRAFT_KEY = 'composer-draft';
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 260;
const PRIMARY: Mode[] = ['humanize', 'standard', 'academic', 'professional'];
const MORE: Mode[] = ['creative', 'simplify'];

type T = (id: string, en: string) => string;

const placeholderFor = (mode: Mode | null, t: T) => mode === null ? t('Tulis, tempel, atau mulai dengan memilih aksi di bawah', 'Write, paste, or start with an action below') : {
  standard: t('Tulis atau tempel teks untuk diparafrase', 'Write or paste text to paraphrase'),
  academic: t('Tulis atau tempel teks untuk dirapikan secara akademik', 'Write or paste text to polish academically'),
  humanize: t('Tempel teks yang terasa seperti tulisan AI…', 'Paste text that reads like AI writing…'),
  professional: t('Tulis atau tempel teks agar lebih profesional', 'Write or paste text to make it more professional'),
  creative: t('Tulis atau tempel teks agar lebih kreatif', 'Write or paste text to make it more creative'),
  simplify: t('Tulis atau tempel teks agar lebih mudah dipahami', 'Write or paste text to make it easier to read'),
}[mode];

const sendLabelFor = (mode: Mode | null, t: T) => mode === null ? t('Perbaiki teks', 'Improve text') : {
  standard: t('Parafrase teks', 'Paraphrase text'), academic: t('Rapikan akademik', 'Polish academically'), humanize: t('Buat terasa manusiawi', 'Make it read human'),
  professional: t('Buat profesional', 'Make it professional'), creative: t('Buat kreatif', 'Make it creative'), simplify: t('Sederhanakan', 'Simplify text'),
}[mode];

export function Composer() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { settings: prefs, usage } = useShell();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const baseMode = modeFromPrompt(prefs.defaultMode) ?? 'humanize';
  const [text, setText] = useState('');
  const [picked, setPicked] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => normalizeSettings({ ...defaults, mode: prefs.defaultMode === LEGACY_CUSTOM_PROMPT ? 'custom' : baseMode, language: prefs.writingLanguage, context: prefs.humanizerContext }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const { styles } = useWritingStyles();

  const focus = useCallback(() => { const node = textarea.current; if (!node) return; node.focus(); node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, []);
  useEffect(() => { try { const saved = sessionStorage.getItem(DRAFT_KEY); if (saved) setText(saved); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { try { if (text) sessionStorage.setItem(DRAFT_KEY, text); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ } }, [text]);
  useEffect(() => {
    if (window.location.hash === '#compose') focus();
    window.addEventListener(COMPOSER_FOCUS_EVENT, focus);
    return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, focus);
  }, [focus]);
  useLayoutEffect(() => {
    const node = textarea.current; if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, node.scrollHeight))}px`;
    node.style.overflowY = node.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [text]);

  const words = countWords(text);
  const detected = detectLanguage(text);
  const tooLong = text.length > AI_SCOPE_LIMIT;
  const outOfQuota = usage !== null && !usage.unlimited && usage.requestsRemaining <= 0;
  const needsLanguage = settings.language === 'auto' && words >= MIN_WORDS && !detected;
  const ready = words >= MIN_WORDS;
  const canSend = ready && !busy && !needsLanguage && !(outOfQuota && !tooLong);
  const activeMode = picked ? settings.mode : null;
  const sendLabel = tooLong ? t('Buka sebagai notebook', 'Open as notebook') : sendLabelFor(activeMode, t);
  const status = busy ? { warn: false, text: t('Membuat notebook…', 'Creating notebook…') }
    : outOfQuota ? { warn: true, text: t('Batas AI bulan ini habis.', 'This month’s AI limit is used up.') }
    : needsLanguage ? { warn: true, text: t('Bahasa belum terdeteksi. Pilih Indonesia atau English.', 'Language unclear. Choose Indonesia or English.') }
    : tooLong ? { warn: true, text: t(`Lebih dari ${numberFormat(AI_SCOPE_LIMIT, locale)} karakter, dibuka sebagai notebook.`, `Over ${numberFormat(AI_SCOPE_LIMIT, 'en')} characters, opens as a notebook.`) }
    : words > 0 && !ready ? { warn: false, text: t(`Minimal ${MIN_WORDS} kata`, `At least ${MIN_WORDS} words`) }
    : words > 0 ? { warn: false, text: `${numberFormat(words, locale)} ${t('kata', 'words')}` } : null;

  // Any manual change drops the style marker as soon as the settings drift from the saved preset.
  const update = (next: Settings) => setSettings(reconcileStyle(next, styles));
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => update({ ...settings, [key]: value });
  const pick = (mode: Mode) => { update({ ...settings, mode }); setPicked(true); textarea.current?.focus(); };
  const unpick = () => { update({ ...settings, mode: baseMode, styleId: null }); setPicked(false); setCustomizing(false); };
  const pickStyle = (id: string) => {
    const style = styles.find((item) => item.id === id);
    if (!style) { setSettings({ ...settings, styleId: null }); return; }
    setSettings(applyStyle(settings, style)); setPicked(true);
  };
  const styleChip = styles.length > 0 && (
    <ChipSelect label={t('Skill', 'Skill')} title={t('Skills', 'Skills')} value={settings.styleId ?? ''} disabled={busy} onChange={pickStyle} width="w-72"
      options={[{ value: '', label: t('Tanpa skill', 'No skill'), hint: t('Pakai mode dan pengaturan di bawah', 'Use the mode and settings below') },
        ...styles.map((style) => ({ value: style.id, label: style.name, hint: requestSummary(style.settings, t) }))]} />
  );

  async function create() {
    if (!canSend) return;
    setBusy(true); setError('');
    const title = text.trim().split('\n')[0]?.slice(0, 60).trim() || t('Notebook tanpa judul', 'Untitled notebook');
    try {
      const doc = await request<{ id: string }>('/api/documents', 'POST', { title, language: settings.language, content: plainTextDocument(text), preferences: settings }, newKey());
      try {
        if (!tooLong) sessionStorage.setItem(`writing-generate:${doc.id}`, '1');
        sessionStorage.removeItem(DRAFT_KEY);
      } catch { /* storage unavailable */ }
      router.push(`/notebooks/${doc.id}${tooLong ? '' : '?autoGenerate=1'}`);
    } catch (caught) {
      if (!guard(caught)) setError(errorText(caught, locale === 'en'));
      setBusy(false);
    }
  }

  async function paste() {
    try { const value = await navigator.clipboard.readText(); if (value) setText((current) => (current ? `${current}\n${value}` : value)); textarea.current?.focus(); }
    catch { setError(t('Browser tidak mengizinkan akses clipboard. Tempel dengan Ctrl+V.', 'The browser blocked clipboard access. Paste with Ctrl+V.')); }
  }

  const modeControls: Record<Mode, React.ReactNode> = {
    standard: <ChipSelect label={t('Kekuatan', 'Strength')} title={t('Kekuatan perubahan', 'Change strength')} value={settings.strength} options={strengthOptions(t)} disabled={busy} onChange={(value) => set('strength', value)} />,
    academic: <ChipSelect label={t('Konteks', 'Context')} title={t('Konteks akademik', 'Academic context')} value={settings.academic} options={academicOptions(t)} disabled={busy} onChange={(value) => set('academic', value)} />,
    humanize: <>
      <ChipSelect label="Register" title={t('Register tulisan', 'Writing register')} value={settings.context} options={contextOptions(t)} disabled={busy} onChange={(value) => set('context', value)} />
      <ChipSelect label={t('Kekuatan', 'Strength')} title={t('Kekuatan humanize', 'Humanize strength')} value={settings.strength} options={humanizeStrengthOptions(t)} disabled={busy} onChange={(value) => set('strength', value)} />
      <ChipSelect label={t('Batas', 'Limit')} title={t('Batas perubahan', 'Change limit')} value={settings.preservation} options={preservationOptions(t)} disabled={busy} onChange={(value) => set('preservation', value)} />
    </>,
    professional: <ChipSelect label={t('Untuk', 'To')} title={t('Ditujukan untuk', 'Addressed to')} value={settings.recipient} options={recipientOptions(t)} disabled={busy} onChange={(value) => set('recipient', value)} />,
    creative: <ChipSelect label={t('Kreativitas', 'Creativity')} title={t('Tingkat kreativitas', 'Creativity level')} value={settings.strength} options={creativityOptions(t)} disabled={busy} onChange={(value) => set('strength', value)} />,
    simplify: <ChipSelect label={t('Untuk', 'For')} title={t('Untuk siapa', 'Written for')} value={settings.simplifyFor} options={simplifyForOptions(t)} disabled={busy} onChange={(value) => set('simplifyFor', value)} />,
  };

  const tone = modeToneClass(settings.mode);
  const ModeIcon = modeIcon[settings.mode];

  return (
    <div id="compose" className="scroll-mt-20">
      <section aria-label={t('Mulai menulis', 'Start writing')} className="rounded-[22px] border border-brand-300 bg-brand-50 p-1.5 shadow-[0_14px_36px_-20px_rgb(66_91_52/0.45)]">
        <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgb(31_32_29/0.08)]">
          <label htmlFor="composer-text" className="sr-only">{t('Teks yang ingin diperbaiki', 'Text to improve')}</label>
          <textarea
            ref={textarea} id="composer-text" value={text} disabled={busy} maxLength={200_000} onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void create(); } }}
            placeholder={placeholderFor(activeMode, t)} style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
            className="scrollbar-thin block w-full resize-none rounded-t-2xl bg-transparent px-5 pb-1 pt-4 text-[16px] leading-[1.7] text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-70"
          />
          <div className="flex items-center gap-1.5 px-3 pb-3">
            <Menu label={t('Aksi teks', 'Text actions')} align="start" disabled={busy}
              triggerClassName="grid h-9 w-9 place-items-center rounded-full text-ink-700 transition-colors hover:bg-paper-deep hover:text-ink-900 disabled:opacity-50"
              trigger={<Plus size={20} aria-hidden="true" />}
              items={[
                { label: t('Tempel', 'Paste'), icon: ClipboardPaste, onSelect: () => void paste() },
                { label: t('Hapus teks', 'Clear text'), icon: Trash2, tone: 'danger', disabled: !text, onSelect: () => setConfirmClear(true) },
              ]} />
            <ChipSelect<WritingLanguage> ghost prefix={t('Bahasa', 'Language')} label={t('Bahasa tulisan', 'Writing language')} value={settings.language} disabled={busy} onChange={(value) => set('language', value)}
              options={languageOptions(t)} />
            <span role="status" className={`ml-1 inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs ${status?.warn ? 'font-medium text-amber-700' : 'text-ink-500'}`}>
              {status?.warn && <TriangleAlert size={13} className="shrink-0" aria-hidden="true" />}<span className="truncate">{status?.text}</span>
            </span>
            <button type="button" onClick={() => void create()} disabled={!canSend} aria-label={busy ? t('Membuat notebook…', 'Creating notebook…') : sendLabel}
              key={canSend ? 'ready' : 'idle'} title={sendLabel} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${canSend ? `${raisedGreen} ${pressGreen}` : 'bg-paper-deep text-ink-300'}`}>
              {busy ? <Spinner size={15} /> : <ArrowRight size={17} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className={`flex flex-nowrap items-center gap-2 px-2 py-2.5 ${picked ? '' : 'justify-center'}`}>
          {picked ? (
            <>
              <ChipRow>
                {styleChip}
                <span className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-white pl-1 pr-0.5 text-[12.5px] font-medium ${tone.edge} ${tone.ink}`}>
                  <span className={`grid h-6 w-6 place-items-center rounded-full ${tone.fill}`}><ModeIcon size={13} aria-hidden="true" /></span>
                  {modeLabel(settings.mode, t)}
                  <button type="button" onClick={unpick} disabled={busy} aria-label={t('Hapus pilihan mode', 'Clear mode')} className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-paper-deep disabled:opacity-50"><X size={13} aria-hidden="true" /></button>
                </span>
                {modeControls[settings.mode]}
              </ChipRow>
              <button type="button" disabled={busy} aria-expanded={customizing} aria-controls="composer-customize" onClick={() => setCustomizing(!customizing)}
                className={`${CHIP} font-medium ${customizing || settings.customized ? 'border-brand-400 bg-white text-brand-800' : ''}`}>
                <SlidersHorizontal size={15} aria-hidden="true" />{t('Sesuaikan', 'Customize')}
                {settings.customized && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-label={t('aktif', 'on')} />}
                <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${customizing ? 'rotate-180' : ''}`} />
              </button>
            </>
          ) : (
            <ChipRow center>
              {styleChip}
              {PRIMARY.map((mode) => {
                const Icon = modeIcon[mode]; const chipTone = modeToneClass(mode);
                return (
                  <button key={mode} type="button" disabled={busy} onClick={() => pick(mode)} className={`${CHIP} pl-1 font-medium`}>
                    <span className={`grid h-6 w-6 place-items-center rounded-full ${chipTone.fill} ${chipTone.ink}`}><Icon size={13} aria-hidden="true" /></span>{modeLabel(mode, t)}
                  </button>
                );
              })}
            </ChipRow>
          )}
          {!picked && (
            <Menu label={t('Mode lainnya', 'More modes')} align="end" disabled={busy} className="shrink-0" triggerClassName={`${CHIP} font-medium`}
              trigger={<><Plus size={16} aria-hidden="true" />{t('Lainnya', 'More')}</>}
              items={MORE.map((mode) => ({ label: modeLabel(mode, t), icon: modeIcon[mode], onSelect: () => pick(mode) }))} />
          )}
        </div>
        {picked && customizing && (
          <div id="composer-customize" className="mx-0 mb-0.5 rounded-2xl bg-white px-4 py-4 shadow-[0_1px_3px_rgb(31_32_29/0.08)] animate-fade-up sm:px-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><p className="text-sm font-semibold text-ink-900">{t('Sesuaikan hasil', 'Customize result')}</p><p className="mt-0.5 text-xs text-ink-500">{t('Atur bentuk hasil tanpa mengubah mode.', 'Shape the output without changing the mode.')}</p></div>
              <button type="button" onClick={() => setCustomizing(false)} aria-label={t('Tutup Sesuaikan', 'Close customize')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 hover:bg-paper-deep hover:text-ink-900"><X size={16} aria-hidden="true" /></button>
            </div>
            <CustomizePanel embedded settings={settings} disabled={busy} onChange={update} onClose={() => setCustomizing(false)} />
          </div>
        )}
      </section>

      {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error} {t('Teksmu tidak hilang.', 'Your text is kept.')}</Toast>}
      {confirmClear && <ConfirmDialog title={t('Hapus teks?', 'Clear text?')} description={t('Teks di kotak ini akan dikosongkan.', 'The text in this box will be cleared.')} confirmLabel={t('Ya, hapus', 'Yes, clear')} tone="danger" onClose={() => setConfirmClear(false)} onConfirm={() => { setText(''); setConfirmClear(false); textarea.current?.focus(); }} />}
    </div>
  );
}
