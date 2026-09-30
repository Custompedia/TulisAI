'use client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { del, get, set } from 'idb-keyval';
import { ChevronsRight, ClipboardPaste, CopyPlus, FileText, Minimize2, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type LayoutStorage } from 'react-resizable-panels';
import { useLocale } from '@/lib/client/locale';
import { ApiError, errorText, newKey, request } from '@/lib/client/api';
import { dateTime, numberFormat } from '@/lib/client/format';
import { guardedPush, leaveHref, leavesPath, setLeaveGuard } from '@/lib/client/navigation-guard';
import { documentText, plainTextDocument, selectionOffsets } from '@/lib/editor/document';
import { copyRichText, handleClipboardEvent } from '@/lib/editor/clipboard';
import { normalizePastedHtml, plainTextSlice } from '@/lib/editor/paste-normalize';
import { documentExtensions } from '@/lib/editor/extensions';
import { countCharacters, countWords } from '@/lib/editor/metrics';
import { docTypeHint, isDocType, isSpoken, orderActions, type DocType } from '@/lib/writing/doc-types';
import { docPanelCookie, docPanelState, type DocPanelPreferences } from '@/lib/navigation/doc-panel';
import { firstRunCustomKey, firstRunOverride } from '@/lib/writing/composer';
import { autosavePreferences, copyPreferences, readMeta, type NotebookMeta } from '@/lib/writing/notebook-meta';
import { AI_SCOPE_LIMIT, INLINE_LIMIT, MIN_WORDS, asMode, customConflict, defaults, detectLanguage, modeFromPrompt, normalizeSettings, promptFor, resolveLanguage, runtimeControls, type Settings } from '@/lib/writing/settings';
import { applyStyle, reconcileStyle, type WritingStyle } from '@/lib/writing/styles';
import { suggestStyle } from '@/lib/writing/suggest';
import { useWritingStyles } from '@/lib/client/styles-store';
import { StyleDialog } from '@/components/writing/StyleDialog';
import { useEntitlements, useSessionGuard, useShell } from '@/components/app/AppShell';
import { openPlans, requestNewWriting, showLockedFeature, showPlanNotice, showShellNotice } from '@/components/app/shell-events';
import { notifyLibraryChanged } from '@/lib/navigation/library';
import { setFocusMode, useFocusMode, useInitialDocPanel } from '@/components/app/editor-frame';
import { AppearancePicker, useAppearanceSave } from '@/components/app/AppearancePicker';
import { ADVANCED_PREFERENCE, requiredTierFor } from '@/lib/plans';
import { pageStyle } from '@/lib/docx/office-defaults';
import { docxFilename } from '@/lib/docx/export';
import { Toast } from '@/components/ui/Toast';
import { Button, IconButton, pressGreen, raisedGreen } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { LoadingBlock, Spinner } from '@/components/ui/Spinner';
import { StatusScreen, statusIcons } from '@/components/ui/StatusScreen';
import { AnalyticsPanel } from './AnalyticsPanel';
import { AssistantPanel } from './AssistantPanel';
import { CompareView } from './CompareView';
import { documentLimits } from './document-limits';
import { paragraphGutterExtension, paragraphGutterKey, targetAtPosition } from './paragraph-gutter';
import { InstructionDock } from './InstructionDock';
import { FormattingToolbar } from './FormattingToolbar';
import { usePageZoom } from './toolbar/zoom';
import { PAGE_GUTTER, paginationExtension } from '@/lib/editor/extensions/pagination';
import { tabStopsExtension } from '@/lib/editor/extensions/tab-stops';
import { SearchExtension } from '@/lib/editor/extensions/search';
import { spellcheckExtension } from '@/lib/editor/extensions/spellcheck';
import { renderRunning } from '@/lib/docx/running';
import { HeaderFooterDialog } from './HeaderFooterDialog';
import { HistoryPanel } from './HistoryPanel';
import { layoutPreferences, readLayout, type PageLayout } from './page-layout';
import { PageRuler } from './PageRuler';
import { PageSetupDialog } from './PageSetupDialog';
import { ANALYTICS_SECTION_ID, ReviewPanel } from './ReviewPanel';
import { DocPanelContent, DocPanelFrame } from './DocPanel';
import { StatusBar } from './StatusBar';
import { CompactToolbar } from './CompactToolbar';
import { compareDefault, draftSpotAt, firstDraftSpot, hasStructure, meaningfulOriginal, sectionBodyAt, shouldDiscard, type SectionBody } from './editor-rules';
import { DraftCard } from './DraftCard';
import { InlineResult, type InlineStatus } from './InlineResult';
import { getInlineTarget, inlineTargetExtension, setInlineTarget, type InlineTarget } from './inline-target';
import { NotebookHeader } from './NotebookHeader';
import { PreviewCard } from './PreviewCard';
import { protectionExtension } from './protection';
import { planInstruction, planSelectionCommand, planStyleCommand, quickActionLabel, quickActionOverride, type QuickAction, type SelectionCommand, type SelectionPlan } from './selection-commands';
import { SelectionMenu } from './SelectionMenu';
import { TableContextMenu } from './toolbar/TableTools';
import { StudioPanel, StudioStrip, useStudioTabs, type StudioTab } from './StudioPanel';
import { PREVIEW, previewText, SOURCE, WORKING, type Doc, type Draft, type InlineAction, type Preview, type Quality, type SaveState, type Scope, type SelectionRange, type Surface, type Term, type Version } from './types';
import { versionLabel } from './versions';

// `draft` marks a Draf dari brief run: the editor position it writes at, so "Coba lagi" writes the same section.
type GenerateRequest = { scope: Scope; surface: Surface; label?: string; inlineAction?: InlineAction; override?: Settings; anchor?: { from: number; to: number }; suggestTitle?: boolean; instruction?: string; draft?: number };
// One quick action started from the selection toolbar; its result is shown on the text, not in the panel.
type InlineSession = { label: string; status: InlineStatus; message: string };
type Dialog = { kind: 'checkpoint' | 'rename' | 'restore' | 'delete' | 'reload' | 'page-setup' | 'header-footer'; version?: Version };
type LoadError = { code: string; message: string };
type Notice = { tone: 'success' | 'error' | 'info' | 'warning'; message: string; retrySave?: boolean };
type CompareState = { a: string; b: string; before: string; after: string; loading: boolean };

const FROZEN = new Set(['apply', 'restore', 'recover', 'delete']);
const nextStrength = (value: string) => (value === 'light' ? 'balanced' : 'strong');
const lowerStrength = (value: string) => (value === 'strong' ? 'balanced' : 'light');
const PANEL_IDS = ['writing', 'studio'];
// v2: the right panel is sized in pixels now (360, 300–480), so layouts saved as percentages are not reused.
const LAYOUT_ID = 'notebook-layout-v2';
const noopSubscribe = () => () => {};
const layoutStorage: LayoutStorage = {
  getItem: (key) => { try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); } catch { return null; } },
  setItem: (key, value) => { try { window.localStorage.setItem(key, value); } catch { return; } },
};
const separatorClass = 'w-3 shrink-0 cursor-col-resize outline-none';

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { t, locale } = useLocale();
  const { limits, has } = useEntitlements();
  // The signed-in shell already holds the account and its preferences, so the editor no longer fetches them again.
  const { user, settings: prefs, refreshUsage } = useShell();
  const english = locale === 'en';
  const guard = useSessionGuard();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [pinned, setPinnedState] = useState(false);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState<Settings>(defaults);
  // Page layout lives beside the writing settings: same preferences row, different owner.
  const [pageLayout, setPageLayout] = useState<PageLayout>(() => readLayout(undefined, 'id'));
  const [pageCount, setPageCount] = useState(1);
  const [advancedMode, setAdvancedMode] = useState(false);
  // Kind of writing, word target and brief: kept beside the settings so no save or copy drops them.
  const [meta, setMeta] = useState<NotebookMeta>({});
  const [text, setText] = useState('');
  const [editStamp, setEditStamp] = useState(0);
  const [metaTick, setMetaTick] = useState(0);
  const [save, setSave] = useState<SaveState>('loading');
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState('');
  const [aiError, setAiError] = useState('');
  const [inline, setInline] = useState<InlineSession | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [rightTab, setRightTab] = useState<StudioTab>('assistant');
  // Phones and small tablets: Dokumen, Asisten, Riwayat and Tinjau each open as a sheet from the action bar.
  const [sheet, setSheet] = useState<'document' | StudioTab | null>(null);
  // The Dokumen column: the server-read cookie when the writer chose before, otherwise open only from 1440px.
  const savedDocPanel = useInitialDocPanel();
  // The shell only renders pages after the session loads on the client, so the viewport is known on the first render
  // and the panels never resize right after mounting (which would shrink the pixel-sized right panel).
  const [docPanel, setDocPanel] = useState<DocPanelPreferences>(() => docPanelState(savedDocPanel, typeof window === 'undefined' ? 0 : window.innerWidth));
  const focus = useFocusMode();
  // Inline alternatives: 3 or 5 (the backend accepts 3–5); switching reruns the card.
  const [altCount, setAltCount] = useState<3 | 5>(3);
  const altCountRef = useRef<3 | 5>(3);
  const [tipHidden, setTipHidden] = useState(false);
  const studioTabs = useStudioTabs();
  const [appearance, setAppearance] = useState<{ color: string | null; icon: string | null }>({ color: null, icon: null });
  const [appearanceAnchor, setAppearanceAnchor] = useState<HTMLElement | null>(null);
  const [page, setPage] = useState(1);
  const appearanceSave = useAppearanceSave(id, appearance, setAppearance);
  // Arriving from the home composer: the Studio opens on Assistant and stays in its waiting state until the first result lands.
  const [arriving, setArriving] = useState(() => search.get('autoGenerate') === '1');
  const [versionsError, setVersionsError] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionCursor, setVersionCursor] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [terms, setTerms] = useState<Term[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [scope, setScope] = useState<Scope>('document');
  // The caret, so "Bagian ini" follows it; a collapsed selection does not change `selection` and would not re-render.
  const [caret, setCaret] = useState(0);
  const [compare, setCompare] = useState<CompareState | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [field, setField] = useState('');
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [quality, setQuality] = useState<(Quality & { stamp: number }) | null>(null);
  const [qualityState, setQualityState] = useState({ loading: false, error: '' });
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [customizeRequest, setCustomizeRequest] = useState(0);
  const [leaving, setLeaving] = useState<{ href: string; saving: boolean } | null>(null);
  // `apply` marks the notebook as using the style right after it is saved from the current settings.
  const [styleDialog, setStyleDialog] = useState<{ style: WritingStyle | null; preset: Settings; apply: boolean } | null>(null);
  const [suggestionOff, setSuggestionOff] = useState(true);
  // What the Mode tab falls back to: the notebook's own settings, or the account defaults when a skill owns them.
  const [manualBase, setManualBase] = useState<Settings>(defaults);
  const [modeTabRequest, setModeTabRequest] = useState(0);
  // Arriving from "Draf dari brief (AI)" in Tulis baru (?brief=1): the Brief unfolds and offers the first section.
  const [briefFocus, setBriefFocus] = useState(false);
  const styleList = useWritingStyles();

  const current = useRef<Doc | null>(null);
  const owner = useRef('');
  const cacheKey = useRef('');
  const localDrafts = useRef(true);
  const stamp = useRef(0);
  const metaStamp = useRef(0);
  const dirty = useRef(false);
  const metaDirty = useRef(false);
  const initializing = useRef(true);
  const inFlight = useRef<Promise<Doc> | null>(null);
  const latest = useRef({ title, settings, layout: pageLayout, advanced: advancedMode, meta });
  // Writing settings, page layout and the notebook facts share one preferences row; none may drop another on save.
  const savedPreferences = () => autosavePreferences({ settings: latest.current.settings, layout: layoutPreferences(latest.current.layout), advanced: latest.current.advanced, meta: latest.current.meta });
  // A new notebook made from this one: create refuses layout keys and skill ids the account cannot use, so they stay out.
  const copiedPreferences = (settingsFor: Settings = latest.current.settings) => copyPreferences(
    { settings: settingsFor, layout: layoutPreferences(latest.current.layout), advanced: latest.current.advanced, meta: latest.current.meta },
    { advancedNotebook: has('advanced_notebook'), savedStyles: has('saved_styles') });
  const versionTexts = useRef(new Map<string, string>());
  const autoStarted = useRef(false);
  const arrivingRef = useRef(false);
  // True only while the notebook still carries the title the composer derived for it.
  const autoTitle = useRef(false);
  // Bumped when a result is discarded so an in-flight request cannot resurface it.
  const generation = useRef(0);
  const compareStarted = useRef(false);
  const termsRef = useRef<string[]>([]);
  const protectedLabel = useRef('');
  const englishRef = useRef(english);
  // The gutter extension is built once, so it reads the current mode through a ref.
  const pagedRef = useRef(false);
  const columnsRef = useRef(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Advanced mode is stored in the notebook's preferences and gated on the server; the client only renders it.
  // It is held beside the writing settings because normalizeSettings keeps writing controls only.
  const advanced = advancedMode;
  const paged = advanced && has('advanced_notebook');
  pagedRef.current = paged;
  columnsRef.current = pageLayout.columns;
  const pageZoom = usePageZoom(canvasRef, paged);
  const contentRef = useRef<JSONContent | null>(null);
  const rightPanel = usePanelRef();
  const layout = useDefaultLayout({ id: LAYOUT_ID, storage: layoutStorage, panelIds: PANEL_IDS, onlySaveAfterUserInteractions: true });
  const deleted = useRef(false);
  const discardNotice = useRef('');
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  latest.current = { title, settings, layout: pageLayout, advanced: advancedMode, meta };
  arrivingRef.current = arriving;
  const unsaved = () => dirty.current || metaDirty.current || inFlight.current !== null;
  termsRef.current = terms.map((term) => term.term);
  protectedLabel.current = t('Dilindungi: tidak akan diubah AI', 'Protected: AI will not change this');
  englishRef.current = english;
  discardNotice.current = t('Notebook kosong tidak disimpan.', 'The empty notebook was not kept.');

  const cache = useCallback((content: JSONContent) => {
    const base = current.current;
    if (!base || !cacheKey.current || !localDrafts.current) return;
    const draft: Draft = { owner: owner.current, revision: base.revision, content, title: latest.current.title, settings: latest.current.settings, updatedAt: Date.now() };
    void set(cacheKey.current, draft).catch(() => setSave('local-unavailable'));
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...documentExtensions,
      protectionExtension(() => termsRef.current, () => protectedLabel.current),
      // Newspaper columns flow as one long sheet: the page splitter measures single-column blocks only.
      SearchExtension, paginationExtension({ enabled: () => pagedRef.current && columnsRef.current === 1, onPages: setPageCount }), spellcheckExtension(() => pagedRef.current),
      tabStopsExtension({ enabled: () => pagedRef.current }),
      inlineTargetExtension,
      paragraphGutterExtension({ enabled: () => pagedRef.current, label: () => englishRef.current ? 'Act on this paragraph' : 'Tindakan untuk paragraf ini' }),
      documentLimits(() => setNotice({ tone: 'error', message: englishRef.current ? 'This content exceeds the document limit or uses unsupported formatting.' : 'Isi melewati batas dokumen atau memakai format yang belum didukung.' })),
    ],
    content: plainTextDocument(''),
    editorProps: {
      attributes: { class: 'focus:outline-none', 'aria-label': t('Isi dokumen', 'Document content') },
      transformPastedHTML: (html) => normalizePastedHtml(html),
      clipboardTextParser: (text, $context) => plainTextSlice(text, $context),
      handleDOMEvents: {
        copy: (view, event) => handleClipboardEvent(view, event, { mode: pagedRef.current ? 'paged' : 'plain' }),
        cut: (view, event) => handleClipboardEvent(view, event, { mode: pagedRef.current ? 'paged' : 'plain', cut: true }),
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (initializing.current) return;
      dirty.current = true; stamp.current++; setEditStamp(stamp.current);
      contentRef.current = instance.getJSON();
      setText(documentText(contentRef.current));
      setSave((state) => (state === 'conflict' ? state : 'dirty'));
      cache(instance.getJSON());
    },
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection;
      if (from === to) { setCaret(from); setSelection(null); setScope((value) => (value === 'selection' ? 'document' : value)); return; }
      try {
        const json = instance.getJSON(); const offsets = selectionOffsets(json, from, to);
        setSelection({ ...offsets, text: documentText(json).slice(offsets.from, offsets.to), pmFrom: from, pmTo: to }); setScope('selection');
      } catch { setSelection(null); }
    },
  });

  const frozen = FROZEN.has(busy);
  useEffect(() => { if (editor && loaded) editor.setEditable(!compare && !frozen && !recovery, false); }, [editor, loaded, compare, frozen, recovery]);
  useEffect(() => { editor?.view.dispatch(editor.state.tr.setMeta('refreshProtection', true)); }, [editor, terms]);
  useEffect(() => { if (editor && !inline) setInlineTarget(editor, null); }, [editor, inline]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const apply = () => { setNarrow(media.matches); if (!media.matches) setSheet(null); };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  const saveDocPanel = (next: DocPanelPreferences) => { setDocPanel(next); document.cookie = docPanelCookie(next); };
  // "hal x/y" in the status bar: the page at the top third of the viewport, from how far the sheet has scrolled.
  useEffect(() => {
    const node = canvasRef.current;
    if (!node || !paged || !loaded) return;
    const onScroll = () => { const stride = node.scrollHeight / Math.max(1, pageCount); setPage(Math.max(1, Math.floor((node.scrollTop + node.clientHeight / 3) / stride) + 1)); };
    onScroll(); node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [paged, pageCount, loaded]);
  // Mode fokus: Ctrl+. anywhere in the editor (captured before the editor's own shortcuts), Esc leaves it.
  const toggleFocus = useEffectEvent(() => setFocusMode(!focus));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === '.' || event.code === 'Period')) { event.preventDefault(); event.stopPropagation(); toggleFocus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); setFocusMode(false); };
  }, []);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); if (navigator.onLine) setSave((state) => (state === 'offline' ? 'dirty' : state)); };
    update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => () => {
    const base = current.current; const content = contentRef.current;
    // An outline or blank notebook that was never touched is deleted for good on the way out (it is not user
    // content, so it skips the trash), and empty notebooks do not pile up. Only in-app leaving: a reload keeps it.
    if (base && content && !deleted.current && shouldDiscard({ source: latest.current.meta.docSource, revision: base.revision, dirty: dirty.current || metaDirty.current || inFlight.current !== null, text: documentText(content), original: documentText(base.content) })) {
      void fetch(`/api/documents/${id}?permanent=1`, { method: 'DELETE', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newKey() }, body: '{}' }).catch(() => undefined);
      if (cacheKey.current) void del(cacheKey.current).catch(() => undefined);
      showShellNotice({ tone: 'info', message: discardNotice.current });
      return;
    }
    // Best-effort save when leaving the document inside the app; the local recovery copy covers failures.
    if (!base || !content || inFlight.current || (!dirty.current && !metaDirty.current)) return;
    void fetch(`/api/documents/${id}/autosave`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newKey() }, body: JSON.stringify({ content, title: latest.current.title.trim() || 'Untitled document', language: latest.current.settings.language, preferences: savedPreferences(), expectedRevision: base.revision }) }).catch(() => undefined);
  }, [id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsaved()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    if (!sheet && !focus) return;
    const close = (event: KeyboardEvent) => { if (event.key !== 'Escape' || event.defaultPrevented) return; if (sheet) setSheet(null); else setFocusMode(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [sheet, focus]);
  useEffect(() => { if (!arriving) return; setRightTab('assistant'); setPanelOpen(true); if (window.matchMedia('(max-width: 1023px)').matches) setSheet('assistant'); }, [arriving]);
  // Toggling the mode changes nothing in the document, so the gutter decorations are refreshed explicitly.
  useEffect(() => { if (!editor) return; editor.view.dispatch(editor.state.tr.setMeta(paragraphGutterKey, 'refresh')); }, [editor, paged]);
  useEffect(() => { if (notice?.tone !== 'success') return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer); }, [notice]);

  // The skill suggestion is dismissed per notebook so it never nags after the user says no.
  const suggestionKey = `skill-suggestion-dismissed:${id}`;
  useEffect(() => {
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(suggestionKey) === '1'; } catch { dismissed = false; }
    setSuggestionOff(dismissed);
  }, [suggestionKey]);
  function dismissSuggestion() {
    setSuggestionOff(true);
    try { window.localStorage.setItem(suggestionKey, '1'); } catch { /* storage unavailable */ }
  }

  const syncUrl = useCallback((params: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, []);

  const loadVersions = useCallback(async (next?: string) => {
    const page = await request<{ items: Version[]; nextCursor: string | null }>(`/api/documents/${id}/versions?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
    setVersions((existing) => (next ? [...existing, ...page.items] : page.items)); setVersionCursor(page.nextCursor); setVersionsError('');
  }, [id]);
  const loadTerms = useCallback(async () => { setTerms(await request<Term[]>(`/api/documents/${id}/locks`)); }, [id]);
  const versionText = useCallback(async (versionId: string) => {
    const cached = versionTexts.current.get(versionId); if (cached !== undefined) return cached;
    const value = documentText((await request<{ content: JSONContent }>(`/api/documents/${id}/versions/${versionId}`)).content);
    versionTexts.current.set(versionId, value); return value;
  }, [id]);

  const loadDocument = useEffectEvent(async (isLive: () => boolean) => {
    if (!editor) return;
    try {
      const value = await request<Doc>(`/api/documents/${id}`);
      if (!isLive()) return;
      localDrafts.current = prefs.localDrafts !== false; owner.current = user.id; cacheKey.current = `writing-draft:${user.id}:${id}`;
      current.current = value; setDoc(value); setTitle(value.title); setAppearance({ color: value.color ?? null, icon: value.icon ?? null }); setPinnedState(value.pinned === true);
      const base = normalizeSettings({ ...defaults, mode: modeFromPrompt(prefs.defaultMode) ?? 'humanize', context: prefs.humanizerContext, ...(value.preferences ?? {}), language: value.language });
      const modeParam = asMode(search.get('mode')); if (modeParam) base.mode = modeParam;
      const account = normalizeSettings({ ...defaults, mode: modeFromPrompt(prefs.defaultMode) ?? 'humanize', context: prefs.humanizerContext, language: value.language });
      setManualBase(base.styleId ? account : { ...base, styleId: null, sample: '' });
      const loadedLayout = readLayout(value.preferences, value.language === 'en' ? 'en' : prefs.interfaceLanguage === 'en' ? 'en' : 'id');
      const loadedAdvanced = (value.preferences as Record<string, unknown> | undefined)?.[ADVANCED_PREFERENCE] === true;
      const loadedMeta = readMeta(value.preferences);
      setSettings(base); setPageLayout(loadedLayout); setAdvancedMode(loadedAdvanced); setMeta(loadedMeta);
      latest.current = { title: value.title, settings: base, layout: loadedLayout, advanced: loadedAdvanced, meta: loadedMeta };
      editor.commands.setContent(value.content, { emitUpdate: false }); contentRef.current = value.content;
      setText(documentText(value.content)); setSave('saved');
      await Promise.all([loadVersions(), loadTerms()]);
      if (value.originalVersionId) versionText(value.originalVersionId).then(setOriginal).catch(() => setOriginal(null));
      const draft = await get<Draft>(cacheKey.current).catch(() => undefined);
      if (isLive() && localDrafts.current && draft?.owner === user.id && (JSON.stringify(draft.content) !== JSON.stringify(value.content) || draft.title !== value.title)) setRecovery(draft);
      const panelParam = search.get('panel'); if (panelParam === 'history' || panelParam === 'analytics' || panelParam === 'review') { openRight(panelParam === 'history' ? 'history' : 'review'); syncUrl({ panel: null }); }
      if (isLive()) { initializing.current = false; setLoaded(true); }
    } catch (caught) { if (isLive() && !guard(caught)) setLoadError({ code: caught instanceof ApiError ? caught.code.toUpperCase() : '', message: errorText(caught, english) }); }
  });

  useEffect(() => {
    if (!editor) return;
    let live = true;
    initializing.current = true; dirty.current = false; metaDirty.current = false; stamp.current = 0;
    setLoaded(false); setPreview(null); setInline(null); setAiError(''); setCompare(null); setOriginal(null); setQuality(null); versionTexts.current.clear();
    void loadDocument(() => live);
    return () => { live = false; initializing.current = true; };
  }, [id, editor, loadAttempt]);

  async function flush(): Promise<Doc> {
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    const base = current.current;
    if (!base || !editor) throw new Error('not-loaded');
    if (!dirty.current && !metaDirty.current) return base;
    const savedStamp = stamp.current; const savedMeta = metaStamp.current;
    const payload = { content: editor.getJSON(), title: latest.current.title.trim() || t('Notebook tanpa judul', 'Untitled notebook'), language: latest.current.settings.language, preferences: savedPreferences(), expectedRevision: base.revision };
    setSave('saving');
    const promise = request<Doc>(`/api/documents/${id}/autosave`, 'PATCH', payload, newKey());
    inFlight.current = promise;
    try {
      const updated = await promise;
      current.current = { ...base, ...updated }; setDoc(current.current);
      if (stamp.current === savedStamp) dirty.current = false;
      if (metaStamp.current === savedMeta) metaDirty.current = false;
      if (!dirty.current && !metaDirty.current) { setSave('saved'); await del(cacheKey.current).catch(() => setSave('local-unavailable')); }
      else { cache(editor.getJSON()); setSave('dirty'); }
      return updated;
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      setSave(code === 'REVISION_CONFLICT' ? 'conflict' : code === 'NETWORK_ERROR' ? 'offline' : 'error');
      if (!guard(caught) && code !== 'NETWORK_ERROR' && code !== 'REVISION_CONFLICT') setNotice({ tone: 'error', message: errorText(caught, english), retrySave: true });
      throw caught;
    } finally { inFlight.current = null; }
  }
  const autosave = useEffectEvent(() => { void flush().catch(() => undefined); });

  useEffect(() => {
    if (!loaded || save === 'conflict' || save === 'error' || save === 'saving' || (save === 'offline' && online)) return;
    if (!dirty.current && !(metaDirty.current && !preview)) return;
    if (!online) { setSave('offline'); return; }
    const timer = setTimeout(() => autosave(), 1800);
    return () => clearTimeout(timer);
  }, [editStamp, metaTick, loaded, save, preview, online]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); autosave(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const flushSoon = useEffectEvent(() => { if (loaded && online && save !== 'conflict' && (dirty.current || (metaDirty.current && !preview))) void flush().catch(() => undefined); });
  useEffect(() => {
    if (!editor) return;
    const onHide = () => { if (document.visibilityState === 'hidden') flushSoon(); };
    const onBlur = () => flushSoon();
    document.addEventListener('visibilitychange', onHide); editor.on('blur', onBlur);
    return () => { document.removeEventListener('visibilitychange', onHide); editor.off('blur', onBlur); };
  }, [editor]);

  // Leave guard: links are intercepted here, programmatic pushes go through the navigation-guard registry.
  const interceptLeave = useEffectEvent((href: string) => {
    const place = { href: window.location.href, origin: window.location.origin, pathname: window.location.pathname };
    if (!unsaved() || !leavesPath(href, place)) return false;
    setLeaving({ href, saving: false }); return true;
  });
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = leaveHref({ button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, defaultPrevented: event.defaultPrevented, href: anchor.getAttribute('href'), target: anchor.getAttribute('target'), download: anchor.hasAttribute('download') }, { href: window.location.href, origin: window.location.origin, pathname: window.location.pathname });
      if (href && interceptLeave(href)) { event.preventDefault(); event.stopPropagation(); }
    };
    const onPop = () => { if (dirty.current || metaDirty.current) flushSoon(); };
    const release = setLeaveGuard((href) => interceptLeave(href));
    document.addEventListener('click', onClick, true); window.addEventListener('popstate', onPop);
    return () => { release(); document.removeEventListener('click', onClick, true); window.removeEventListener('popstate', onPop); };
  }, []);

  async function saveAndLeave() {
    if (!leaving || leaving.saving) return;
    const { href } = leaving;
    setLeaving({ href, saving: true });
    try {
      await flush();
      if (unsaved()) throw new ApiError('REVISION_CONFLICT', 409);
      router.push(href);
    } catch (caught) { setLeaving(null); if (!guard(caught)) setNotice({ tone: 'error', message: errorText(caught, english), retrySave: true }); }
  }
  async function discardAndLeave() {
    if (!leaving || leaving.saving) return;
    const { href } = leaving;
    dirty.current = false; metaDirty.current = false;
    await del(cacheKey.current).catch(() => undefined);
    router.push(href);
  }

  function markMetadata(nextTitle: string, nextSettings: Settings, nextLayout = latest.current.layout, nextAdvanced = latest.current.advanced, nextMeta = latest.current.meta) {
    latest.current = { title: nextTitle, settings: nextSettings, layout: nextLayout, advanced: nextAdvanced, meta: nextMeta };
    metaDirty.current = true; metaStamp.current++; setMetaTick(metaStamp.current);
    setSave((state) => (state === 'conflict' ? state : 'dirty'));
    if (editor) cache(editor.getJSON());
  }

  async function run(name: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setNotice(null);
    try { await work(); } catch (caught) { if (!guard(caught) && !showPlanNotice(caught)) setNotice({ tone: 'error', message: errorText(caught, english) }); } finally { setBusy(''); }
  }

  function loadContent(value: Doc) {
    if (!editor) return;
    setInlineTarget(editor, null);
    current.current = { ...current.current, ...value }; setDoc(current.current);
    editor.commands.setContent(value.content, { emitUpdate: false }); contentRef.current = value.content;
    setText(documentText(value.content)); setSelection(null);
    dirty.current = false; stamp.current++; setEditStamp(stamp.current);
    if (metaDirty.current) { setSave('dirty'); void flush().catch(() => undefined); return; }
    setSave('saved'); void del(cacheKey.current).catch(() => undefined);
  }

  function resolveScope(req: GenerateRequest, full: string): { anchor?: { from: number; to: number }; source: string } | string {
    if (req.surface === 'inline' && editor) {
      // The highlighted target follows edits, so retries always rewrite the text the user picked.
      const target = getInlineTarget(editor.state);
      if (!target) return t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.');
      const anchor = selectionOffsets(editor.getJSON(), target.from, target.to);
      return { anchor, source: full.slice(anchor.from, anchor.to) };
    }
    if (req.anchor) return { anchor: req.anchor, source: full.slice(req.anchor.from, req.anchor.to) };
    if (req.scope === 'selection') {
      if (!selection?.text.trim()) return t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.');
      return { anchor: { from: selection.from, to: selection.to }, source: selection.text };
    }
    if (req.scope === 'section') {
      const section = editor ? currentSection() : null;
      if (!section) return t('Letakkan kursor di bagian yang berisi teks, di bawah sebuah judul.', 'Put the cursor in a section with text under a heading.');
      const anchor = selectionOffsets(editor!.getJSON(), section.from, section.to);
      return { anchor, source: full.slice(anchor.from, anchor.to) };
    }
    return { source: full };
  }

  // "Bagian ini": the text between the headings around the caret (see sectionBodyAt).
  function sectionAt(position: number): SectionBody | null {
    if (!editor) return null;
    const blocks: Array<{ type: string; text: string; pos: number; size: number }> = [];
    editor.state.doc.forEach((node, offset) => { blocks.push({ type: node.type.name, text: node.textContent, pos: offset, size: node.nodeSize }); });
    return sectionBodyAt(blocks, position);
  }
  function currentSection(): SectionBody | null { return editor ? sectionAt(Math.min(caret, editor.state.doc.content.size)) : null; }
  // Moves "Bagian ini" to the next section's text and brings it into view; the scope stays on sections.
  function nextSection() {
    const section = currentSection();
    if (!editor || section?.next === null || section?.next === undefined) return;
    const position = section.next;
    editor.chain().setTextSelection(position).run(); setCaret(position); setScope('section');
    const dom = editor.view.domAtPos(position).node;
    (dom instanceof HTMLElement ? dom : dom.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // The Dokumen panel's "Olah bagian ini dengan AI": the caret goes into the heading's section, then the Asisten opens on it.
  function processSection(headingPos: number) {
    if (!editor) return;
    const section = sectionAt(headingPos + 1);
    if (!section) { setNotice({ tone: 'error', message: t('Bagian ini belum berisi teks.', 'This section has no text yet.') }); return; }
    editor.chain().setTextSelection(section.from).run(); setCaret(section.from); setSelection(null); setScope('section');
    openRight('assistant');
  }

  // The top-level blocks, as the pure outline and draft rules read them.
  function topBlocks() {
    const blocks: Array<{ type: string; text: string; pos: number; size: number }> = [];
    editor?.state.doc.forEach((node, offset) => { blocks.push({ type: node.type.name, text: node.textContent, pos: offset, size: node.nodeSize }); });
    return blocks;
  }
  // Unfolds the Brief in the Dokumen panel (or its sheet on a phone) so the writer can fill it in.
  function openBrief() {
    setBriefFocus(true);
    if (window.matchMedia('(max-width: 1023px)').matches) setSheet('document'); else saveDocPanel({ ...docPanel, collapsed: false });
    requestAnimationFrame(() => window.document.getElementById('notebook-brief')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  // UX 3, Draf dari brief: writes one still-empty section from the saved brief and outline into a preview the writer
  // checks before using it. Plus and up; the brief needs a topic or a key message; the server has the final say.
  async function draftSection(position?: number) {
    if (!editor || busy) return;
    if (!has('draft_from_brief')) { showLockedFeature(requiredTierFor('draft_from_brief')); return; }
    const spot = draftSpotAt(topBlocks(), position ?? Math.min(caret, editor.state.doc.content.size));
    const label = t('Draf', 'Draft');
    openRight('assistant'); setInline(null);
    if (!spot) { setAiError(t('Letakkan kursor di judul bagian yang masih kosong, atau di baris kosong di bawah sebuah judul.', 'Put the cursor on a heading whose section is still empty, or on an empty line under a heading.')); return; }
    const facts = latest.current.meta;
    if (!facts.briefTopic?.trim() && !facts.briefMessage?.trim()) { openBrief(); setAiError(t('Isi Topik atau Pesan utama di Brief dulu, lalu tulis bagian ini.', 'Fill in the Topic or the Key message in the Brief first, then write this section.')); return; }
    setBusy('generate'); setAiError(''); setLastRequest({ scope: 'section', surface: 'panel', label, draft: spot.pos });
    const ticket = ++generation.current;
    try {
      const saved = await flush();
      if (ticket !== generation.current) return;
      if (dirty.current) { setAiError(t('Tulisan masih berubah. Coba lagi setelah selesai mengetik.', 'The text is still changing. Try again when you finish typing.')); return; }
      const at = selectionOffsets(editor.getJSON(), spot.pos, spot.pos).from;
      const chosen = latest.current.settings.language;
      const language = chosen !== 'auto' ? chosen : detectLanguage([facts.briefTopic, facts.briefMessage, facts.notes, documentText(editor.getJSON())].filter(Boolean).join('\n')) ?? (english ? 'en' : 'id');
      if (preview) void request(`/api/ai/previews/${preview.id}/discard`, 'POST', {}, newKey()).catch(() => undefined);
      setPreview(null);
      const captured = stamp.current;
      const result = await request<{ id: string; output: Preview['output']; expiresAt: string; heading: string; academic: boolean }>('/api/ai/draft', 'POST', { documentId: id, expectedRevision: saved.revision, at, language }, newKey());
      if (ticket !== generation.current) { void request(`/api/ai/previews/${result.id}/discard`, 'POST', {}, newKey()).catch(() => undefined); return; }
      setPreview({ id: result.id, output: result.output, expiresAt: result.expiresAt, source: '', stamp: captured, anchor: { from: at, to: at }, settings: latest.current.settings, scope: 'section', revision: saved.revision, surface: 'panel', label, draft: { heading: result.heading, academic: result.academic, pos: spot.pos } });
      setBriefFocus(false);
      void refreshUsage();
    } catch (caught) {
      if (guard(caught)) return;
      showPlanNotice(caught);
      setAiError(errorText(caught, english));
    } finally { if (ticket === generation.current) setBusy(''); }
  }
  function draftFirst() {
    if (!has('draft_from_brief')) { showLockedFeature(requiredTierFor('draft_from_brief')); return; }
    const spot = firstDraftSpot(topBlocks());
    if (!spot) { setNotice({ tone: 'info', message: t('Semua bagian di kerangka sudah berisi teks.', 'Every section of the outline already has text.') }); return; }
    void draftSection(spot.pos);
  }

  async function generate(req: GenerateRequest) {
    if (!editor || busy) return;
    const effective = req.override ?? latest.current.settings;
    const conflict = effective.customized ? customConflict(effective, termsRef.current) : null;
    const label = req.label ?? inline?.label ?? '';
    const fail = (message: string) => { setArriving(false); if (req.surface === 'inline') setInline({ label, status: 'error', message }); else setAiError(message); };
    if (req.surface === 'panel') { openRight('assistant'); setInline(null); }
    else if (!getInlineTarget(editor.state)) { const { from, to } = editor.state.selection; setInlineTarget(editor, { from, to }); }
    if (conflict) { fail(conflict === 'summary-detail' ? t('Ringkasan tidak bisa digabung dengan "Lebih detail". Ubah salah satunya di Sesuaikan.', 'A summary cannot be combined with "More detailed". Change one in Customize.') : t('Catatan untuk AI menyebut istilah yang dikunci. Buka kunci istilah itu dulu jika ingin mengubahnya.', 'Your note for the AI mentions a locked term. Unlock it first if you want it changed.')); return; }
    setBusy('generate'); setAiError(''); setLastRequest(req);
    if (req.surface === 'inline') setInline({ label, status: 'loading', message: '' });
    const ticket = ++generation.current;
    try {
      const saved = await flush();
      if (ticket !== generation.current) return;
      if (dirty.current) { fail(t('Tulisan masih berubah. Coba lagi setelah selesai mengetik.', 'The text is still changing. Try again when you finish typing.')); return; }
      const full = documentText(editor.getJSON());
      const resolved = resolveScope(req, full);
      if (typeof resolved === 'string') { fail(resolved); return; }
      if (!resolved.source.trim()) { fail(t('Bagian yang dipilih masih kosong.', 'The chosen part is empty.')); return; }
      const limit = req.inlineAction ? INLINE_LIMIT : limits.runLimit;
      if (resolved.source.length > limit) { fail(req.scope === 'selection' ? t(`${numberFormat(resolved.source.length, 'id')}/${numberFormat(limit, 'id')} karakter — persingkat pilihan.`, `${numberFormat(resolved.source.length, 'en')}/${numberFormat(limit, 'en')} characters — shorten the selection.`) : t(`Terlalu panjang untuk sekali proses (maks. ${numberFormat(limit, 'id')} karakter). Blok sebagian teks saja.`, `Too long for one run (max ${numberFormat(limit, 'en')} characters). Select part of the text instead.`)); return; }
      // v3 deterministic bypass: lines that are already separate become a list without an AI call.
      const plainList = effective.customized && (effective.format === 'bullets' || effective.format === 'numbered_list') && effective.length === 'same' && !effective.focus.length && !effective.extra.trim();
      if (plainList && !req.inlineAction && resolved.source.split('\n').filter((line) => line.trim()).length >= 2) {
        const listType = effective.format === 'bullets' ? 'bulletList' : 'orderedList';
        if (!editor.isActive(listType)) { const chain = editor.chain().focus(); if (req.scope === 'document') chain.selectAll(); else if (req.scope === 'section' && resolved.anchor) { const range = currentSection(); if (range) chain.setTextSelection({ from: range.from, to: range.to }); } (listType === 'bulletList' ? chain.toggleBulletList() : chain.toggleOrderedList()).run(); void flush().catch(() => undefined); }
        setNotice({ tone: 'success', message: t('Baris sudah terpisah, jadi langsung diformat tanpa AI.', 'The lines were already separate, so they were formatted without AI.') });
        setInline(null); return;
      }
      const language = resolveLanguage(effective, resolved.source);
      if (!language) { fail(t('Bahasa belum terdeteksi. Pilih Indonesia atau English di panel.', 'The language could not be detected. Choose Indonesian or English in the panel.')); return; }
      if (preview) void request(`/api/ai/previews/${preview.id}/discard`, 'POST', {}, newKey()).catch(() => undefined);
      setPreview(null);
      const captured = stamp.current;
      const result = await request<{ id: string; output: Preview['output']; expiresAt: string }>('/api/ai/generate', 'POST', {
        documentId: id, promptId: req.instruction ? 'P08_CUSTOM_TRANSFORM' : req.inlineAction ? 'P07_INLINE_ALTERNATIVES' : promptFor[effective.mode],
        source: { text: resolved.source, ...(resolved.anchor ? { anchor: resolved.anchor } : {}) },
        runtime: runtimeControls(effective, language, req.inlineAction, req.inlineAction ? altCountRef.current : undefined), expectedRevision: saved.revision,
        ...(req.suggestTitle ? { suggestTitle: true } : {}),
        ...(req.instruction ? { instruction: req.instruction } : {}),
      }, newKey());
      if (ticket !== generation.current) { void request(`/api/ai/previews/${result.id}/discard`, 'POST', {}, newKey()).catch(() => undefined); return; }
      setPreview({ ...result, source: resolved.source, stamp: captured, anchor: resolved.anchor, settings: effective, scope: req.scope, revision: saved.revision, inlineAction: req.inlineAction, surface: req.surface, label });
      if (req.surface === 'inline') setInline({ label, status: 'ready', message: '' });
      adoptTitle(req, result.output.suggested_title);
      void refreshUsage();
    } catch (caught) {
      if (guard(caught)) return;
      // Quota, request cap and locked features also raise the shared toast with "Lihat paket"; the per-minute cap does not.
      showPlanNotice(caught);
      fail(errorText(caught instanceof ApiError && caught.code.toUpperCase() === 'SCOPE_TOO_LARGE' ? new ApiError('SCOPE_TOO_LARGE', caught.status) : caught, english));
    }
    // A stopped run has already cleared the busy state, and a newer run may own it by now.
    finally { if (ticket === generation.current) setBusy(''); if (req.surface === 'panel') setArriving(false); }
  }

  // The AI label replaces the composer's local title once, and only while the user has not renamed the notebook.
  function adoptTitle(req: GenerateRequest, suggested: string | undefined) {
    if (!req.suggestTitle || !autoTitle.current || !suggested?.trim()) return;
    const value = suggested.trim();
    autoTitle.current = false;
    if (latest.current.title !== current.current?.title || value === latest.current.title) return;
    setTitle(value); markMetadata(value, latest.current.settings);
  }

  const runInitialGenerate = useEffectEvent(() => {
    if (autoStarted.current || search.get('autoGenerate') !== '1') return;
    if (!loaded || recovery) return;
    autoStarted.current = true;
    const intent = sessionStorage.getItem(`writing-generate:${id}`); sessionStorage.removeItem(`writing-generate:${id}`);
    // The composer's Sesuaikan block rides along for this one run; below Max the stored notebook no longer has it.
    const custom = sessionStorage.getItem(firstRunCustomKey(id)); sessionStorage.removeItem(firstRunCustomKey(id));
    syncUrl({ autoGenerate: null, mode: null });
    if (intent !== '1') { setArriving(false); return; }
    autoTitle.current = true;
    openRight('assistant');
    const override = latest.current.settings.customized ? null : firstRunOverride(latest.current.settings, custom);
    void generate({ scope: 'document', surface: 'panel', suggestTitle: true, ...(override ? { override } : {}) });
  });
  useEffect(() => { runInitialGenerate(); }, [loaded, recovery]);

  async function apply(selectedAlternative = 0) {
    if (!preview || !current.current) return;
    const target = preview;
    await run('apply', async () => {
      const result = await request<Doc>(`/api/ai/previews/${target.id}/apply`, 'POST', { expectedRevision: current.current!.revision, ...(target.output.alternatives ? { selectedAlternative } : {}) }, newKey());
      loadContent(result); setPreview(null); setInline(null); setCompare(null); syncUrl({ compare: null });
      await loadVersions();
      setNotice({ tone: 'success', message: t('Hasil diterapkan dan tersimpan sebagai versi baru.', 'Result applied and saved as a new version.') });
    });
  }

  // Drops an in-flight run: its result is discarded when it lands, and the UI is free straight away.
  function stopGeneration() { generation.current++; setBusy((value) => (value === 'generate' ? '' : value)); setInline(null); }
  // Closes the inline card and releases the server-side preview, if one exists.
  async function discard() {
    stopGeneration();
    if (!preview) return;
    const target = preview;
    setPreview(null); if (compare && [compare.a, compare.b].some((side) => side === PREVIEW || side === SOURCE)) setCompare(null);
    await request(`/api/ai/previews/${target.id}/discard`, 'POST', {}, newKey()).catch(() => undefined);
  }

  async function lockSelection() {
    const term = selection?.text.trim();
    if (!term) return;
    if (term.length > 300) { setNotice({ tone: 'error', message: t('Pilih istilah maksimal 300 karakter.', 'Select a term of at most 300 characters.') }); return; }
    await run('lock', async () => {
      await flush();
      await request(`/api/documents/${id}/locks`, 'POST', { term }, newKey()); await loadTerms();
      setNotice({ tone: 'success', message: t(`“${term}” dikunci. AI tidak akan mengubahnya.`, `“${term}” is locked. AI will not change it.`) });
    });
  }
  async function unlock(term: Term) {
    await run('unlock', async () => { await request(`/api/documents/${id}/locks/${term.id}`, 'DELETE', {}, newKey()); await loadTerms(); });
  }

  // Quick actions from the selection toolbar run and resolve on the text itself; only "Customize" hands over to the panel.
  function selectionCommand(command: SelectionCommand) {
    if (!selection || !editor) return;
    runPlan(planSelectionCommand(command, selection, latest.current.settings, t, (value) => numberFormat(value, locale), limits));
  }
  function styleCommand(style: WritingStyle) {
    if (!selection || !editor) return;
    runPlan(planStyleCommand(style, selection, latest.current.settings, t, (value) => numberFormat(value, locale), limits));
  }
  // A typed instruction resolves on the text like every other toolbar action, never through the right panel.
  function instructionCommand(instruction: string) {
    const range = instructionRange();
    if (!range || !editor) return;
    runPlan(planInstruction(instruction, range, latest.current.settings, t, (value) => numberFormat(value, locale), limits), range);
  }
  // The field takes focus, which hides the browser selection, so the dock's target stays highlighted while it is open.
  const dockTarget = useRef<InlineTarget | null>(null);
  function dockOpenChange(open: boolean) {
    if (!editor) return;
    if (!open) { if (dockTarget.current && getInlineTarget(editor.state) === dockTarget.current) setInlineTarget(editor, null); dockTarget.current = null; return; }
    const range = inline ? null : instructionRange();
    if (!range) return;
    dockTarget.current = { from: range.pmFrom, to: range.pmTo }; setInlineTarget(editor, dockTarget.current);
  }
  // Selection first; with no selection the caret's own paragraph is the target, so the dock always has something
  // concrete to act on. Computed from the document rather than React state so it is correct in the same tick.
  function instructionRange(): SelectionRange | null {
    if (selection?.text.trim()) return selection;
    if (!editor) return null;
    const target = targetAtPosition(editor.state.doc, editor.state.selection.from);
    if (!target) return null;
    const offsets = selectionOffsets(editor.getJSON(), target.from, target.to);
    const text = editor.state.doc.textBetween(target.from, target.to, '\n', ' ');
    return text.trim() ? { from: offsets.from, to: offsets.to, text, pmFrom: target.from, pmTo: target.to } : null;
  }
  function runPlan(plan: SelectionPlan, range: SelectionRange | null = selection) {
    if (!range || !editor) return;
    switch (plan.kind) {
      case 'lock': void lockSelection(); return;
      case 'unlock': { const term = terms.find((item) => item.term === range.text.trim()); if (term) void unlock(term); return; }
      case 'customize': setScope('selection'); openRight('assistant'); setCustomizeRequest((value) => value + 1); return;
      case 'error': {
        if (preview) void discard();
        setInlineTarget(editor, { from: range.pmFrom, to: range.pmTo }); setLastRequest(null);
        setInline({ label: plan.label, status: 'error', message: plan.message }); return;
      }
      case 'generate': {
        if (preview) void discard();
        setInlineTarget(editor, { from: range.pmFrom, to: range.pmTo });
        void generate({ scope: 'selection', surface: 'inline', label: plan.label, inlineAction: plan.inlineAction, override: plan.override, instruction: plan.instruction }); return;
      }
    }
  }
  function retryInline() {
    if (lastRequest?.surface === 'inline') void generate(preview?.surface === 'inline' ? { ...lastRequest, override: preview.settings } : lastRequest);
  }

  async function openCompare(a: string, b: string) {
    setCompare({ a, b, before: '', after: '', loading: true });
    const resolve = async (side: string) => side === WORKING ? documentText(editor?.getJSON() ?? plainTextDocument('')) : side === PREVIEW ? (preview ? previewText(preview) : '') : side === SOURCE ? (preview?.source ?? '') : versionText(side);
    try {
      const [before, after] = await Promise.all([resolve(a), resolve(b)]);
      setCompare({ a, b, before, after, loading: false });
      syncUrl({ compare: [a, b].some((side) => side === PREVIEW || side === SOURCE) ? null : `${a}:${b}` });
    } catch (caught) { setCompare(null); if (!guard(caught)) setNotice({ tone: 'error', message: errorText(caught, english) }); }
  }
  function exitCompare() { setCompare(null); syncUrl({ compare: null }); }
  // Skeleton and blank notebooks compare the latest version with now; there may be nothing to compare yet.
  const showOriginal = meaningfulOriginal(original, meta.docSource);
  const comparePair = compareDefault(versions, doc?.originalVersionId ?? null, showOriginal);
  function defaultCompare() { if (comparePair) void openCompare(comparePair.a, comparePair.b); }
  const runInitialCompare = useEffectEvent(() => {
    const pair = search.get('compare'); if (!loaded || !pair || compareStarted.current) return;
    compareStarted.current = true; const [a, b] = pair.split(':'); if (a && b) void openCompare(a, b);
  });
  useEffect(() => { runInitialCompare(); }, [loaded]);
  // "Draf dari brief (AI)" in Tulis baru lands here with ?brief=1: the Brief unfolds first, then the first section.
  const runBriefArrival = useEffectEvent(() => {
    if (!loaded || search.get('brief') !== '1') return;
    syncUrl({ brief: null }); openBrief();
  });
  useEffect(() => { runBriefArrival(); }, [loaded]);

  async function pasteClipboard() {
    if (!editor) return;
    try {
      // Rich HTML first so a paste from Docs or Word keeps its formatting; plain text when the browser refuses read().
      let html = '', text = '';
      try {
        for (const item of await navigator.clipboard.read()) {
          if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        }
      } catch { text = await navigator.clipboard.readText(); }
      if (!html.trim() && !text.trim()) return;
      editor.commands.focus();
      if (html.trim()) editor.view.pasteHTML(html); else editor.view.pasteText(text);
    } catch { setNotice({ tone: 'error', message: t('Browser tidak mengizinkan akses clipboard. Tempel dengan Ctrl+V.', 'The browser blocked clipboard access. Paste with Ctrl+V.') }); }
  }

  function openRight(tab: StudioTab) {
    setRightTab(tab); setPanelOpen(true); rightPanel.current?.expand();
    if (window.matchMedia('(max-width: 1023px)').matches) setSheet(tab);
    if (focus) setFocusMode(false);
  }
  function closeRight() { setPanelOpen(false); rightPanel.current?.collapse(); setSheet(null); }
  function openReview() { openRight('review'); requestAnimationFrame(() => document.getElementById(ANALYTICS_SECTION_ID)?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }
  function loadMoreVersions() {
    if (!versionCursor || loadingVersions) return;
    setLoadingVersions(true); setVersionsError('');
    void loadVersions(versionCursor).catch((caught) => { if (!guard(caught)) setVersionsError(errorText(caught, english)); }).finally(() => setLoadingVersions(false));
  }

  async function duplicateVersion(version: Version) {
    await run('duplicate', async () => {
      const content = (await request<{ content: JSONContent }>(`/api/documents/${id}/versions/${version.id}`)).content;
      const copy = await request<{ id: string }>('/api/documents', 'POST', { title: `${title} — ${versionLabel(version, t)}`.slice(0, 180), content, language: settings.language, preferences: copiedPreferences() }, newKey());
      guardedPush(router, `/notebooks/${copy.id}`);
    });
  }

  async function analyze() {
    if (!editor) return;
    setQualityState({ loading: true, error: '' });
    try {
      const saved = await flush();
      const full = documentText(editor.getJSON());
      const anchor = selection && selection.text.trim() ? { from: selection.from, to: selection.to } : undefined;
      const source = anchor ? full.slice(anchor.from, anchor.to) : full;
      const language = resolveLanguage(latest.current.settings, source);
      if (!language) throw new Error('language');
      const result = await request<Quality>('/api/ai/analyze-quality', 'POST', { documentId: id, expectedRevision: saved.revision, source: { text: source, ...(anchor ? { anchor } : {}) }, language, context: settings.mode }, newKey());
      setQuality({ ...result, stamp: stamp.current }); setQualityState({ loading: false, error: '' });
      void refreshUsage();
    } catch (caught) {
      if (guard(caught)) return;
      showPlanNotice(caught);
      setQualityState({ loading: false, error: caught instanceof Error && caught.message === 'language' ? t('Pilih bahasa tulisan dulu di panel AI.', 'Choose the writing language in the AI panel first.') : errorText(caught, english) });
    }
  }

  // Sematkan: cosmetic, so it never touches the revision or the save state.
  async function togglePin(next: boolean) {
    try { await request(`/api/documents/${id}/pin`, 'PATCH', { pinned: next }, newKey()); setPinnedState(next); notifyLibraryChanged(); setNotice({ tone: 'success', message: next ? t('Notebook disematkan.', 'Notebook pinned.') : t('Sematan dilepas.', 'Notebook unpinned.') }); }
    catch (caught) { if (!guard(caught)) setNotice({ tone: 'error', message: errorText(caught, english) }); }
  }

  async function confirmDialog() {
    if (!dialog || !editor) return;
    const active = dialog;
    await run(active.kind, async () => {
      if (active.kind === 'delete') {
        // Into the trash: the local copy stays until the purge, so a restore finds nothing missing.
        await request(`/api/documents/${id}`, 'DELETE', {}, newKey()); deleted.current = true;
        dirty.current = false; metaDirty.current = false; notifyLibraryChanged();
        showShellNotice({ tone: 'info', message: t('Notebook dipindahkan ke Sampah. Pulihkan dari Sampah dalam 30 hari.', 'The notebook was moved to the trash. Restore it from the trash within 30 days.') });
        router.push('/notebooks'); return;
      } else if (active.kind === 'reload') {
        window.location.reload(); return;
      } else if (active.kind === 'rename' && active.version) {
        await request(`/api/documents/${id}/versions/${active.version.id}`, 'PATCH', { label: field.trim() }, newKey()); await loadVersions();
      } else {
        const saved = await flush();
        if (dirty.current) throw new ApiError('REVISION_CONFLICT', 409);
        if (active.kind === 'checkpoint') {
          const updated = await request<Doc>(`/api/documents/${id}/versions`, 'POST', { expectedRevision: saved.revision, ...(field.trim() ? { label: field.trim() } : {}) }, newKey());
          current.current = { ...current.current, ...updated }; setDoc(current.current);
          setNotice({ tone: 'success', message: t('Versi tersimpan di linimasa.', 'Version saved to the timeline.') });
        }
        if (active.kind === 'restore' && active.version) {
          const restored = await request<Doc>(`/api/documents/${id}/versions/${active.version.id}/restore`, 'POST', { expectedRevision: saved.revision }, newKey());
          if (preview) void request(`/api/ai/previews/${preview.id}/discard`, 'POST', {}, newKey()).catch(() => undefined);
          loadContent(restored); setPreview(null); setCompare(null); syncUrl({ compare: null });
          setNotice({ tone: 'success', message: t('Versi dipulihkan sebagai versi baru. Riwayat lama tetap ada.', 'Restored as a new version. Older history is kept.') });
        }
        await loadVersions();
      }
      setDialog(null); setField('');
    });
  }

  async function recover(mode: 'continue' | 'copy' | 'discard') {
    if (!recovery || !editor) return;
    const draft = recovery;
    await run('recover', async () => {
      if (mode === 'copy') {
        const copy = await request<{ id: string }>('/api/documents', 'POST', { title: `${draft.title} (${t('pemulihan', 'recovered')})`.slice(0, 180), content: draft.content, language: draft.settings.language, preferences: copiedPreferences(normalizeSettings(draft.settings)) }, newKey());
        await del(cacheKey.current).catch(() => undefined); setRecovery(null); router.push(`/notebooks/${copy.id}`); return;
      }
      if (mode === 'discard') { await del(cacheKey.current).catch(() => undefined); setRecovery(null); return; }
      editor.commands.setContent(draft.content, { emitUpdate: false }); contentRef.current = draft.content;
      const restored = normalizeSettings(draft.settings); setText(documentText(draft.content)); setTitle(draft.title); setSettings(restored);
      dirty.current = true; stamp.current++; setEditStamp(stamp.current); markMetadata(draft.title, restored); setRecovery(null);
      void flush().catch(() => undefined);
    });
  }

  async function copyAsNew() {
    if (!editor) return;
    await run('copy', async () => {
      const copy = await request<{ id: string }>('/api/documents', 'POST', { title: `${title} (${t('salinan', 'copy')})`.slice(0, 180), content: editor.getJSON(), language: settings.language, preferences: copiedPreferences() }, newKey());
      dirty.current = false; metaDirty.current = false; await del(cacheKey.current).catch(() => undefined); router.push(`/notebooks/${copy.id}`);
    });
  }

  async function copyAll() {
    const json = editor?.getJSON() ?? plainTextDocument(text);
    try {
      const result = await copyRichText(json, documentText(json), { mode: paged ? 'paged' : 'plain' });
      setNotice(result === 'rich'
        ? { tone: 'success', message: t('Semua teks disalin dengan formatnya', 'All text copied with its formatting') }
        : { tone: 'warning', message: t('Teks disalin tanpa format: browser ini tidak mengizinkan salin berformat.', 'Text copied without formatting: this browser does not allow a rich copy.') });
    } catch { setNotice({ tone: 'error', message: t('Teks tidak bisa disalin. Izinkan akses papan klip di browser lalu coba lagi.', 'The text could not be copied. Allow clipboard access in your browser and try again.') }); }
  }

  // Plain text for Instagram or TikTok: no formatting at all, whatever the browser would carry along.
  async function copyPlain() {
    const json = editor?.getJSON() ?? plainTextDocument(text);
    try { await navigator.clipboard.writeText(documentText(json)); setNotice({ tone: 'success', message: t('Teks polos disalin, siap ditempel ke media sosial.', 'Plain text copied, ready to paste into social media.') }); }
    catch { setNotice({ tone: 'error', message: t('Teks tidak bisa disalin. Izinkan akses papan klip di browser lalu coba lagi.', 'The text could not be copied. Allow clipboard access in your browser and try again.') }); }
  }

  // A copy of the whole notebook as it is now: saved first, then created from the current content and facts.
  async function duplicateNotebook() {
    if (!editor) return;
    await run('duplicate', async () => {
      await flush();
      const copy = await request<{ id: string }>('/api/documents', 'POST', { title: `${latest.current.title || title} (${t('salinan', 'copy')})`.slice(0, 180), content: editor.getJSON(), language: latest.current.settings.language, preferences: copiedPreferences(), ...(appearance.color ? { color: appearance.color } : {}), ...(appearance.icon ? { icon: appearance.icon } : {}) }, newKey());
      guardedPush(router, `/notebooks/${copy.id}`);
    });
  }

  // The gate is on the route, so the browser just follows the download; a refusal comes back as JSON. Word is
  // tried even without Pro, because a notebook exported before a downgrade is still allowed.
  async function exportFile(format: 'docx' | 'html', pageSize?: 'a4' | 'letter') {
    await run('export', async () => {
      await flush().catch(() => undefined);
      const response = await fetch(`/api/documents/${id}/export?format=${format}${pageSize ? `&pageSize=${pageSize}` : ''}`, { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
        throw new ApiError(body?.error?.code ?? 'REQUEST_FAILED', response.status);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      // window.document, because the Workers type globals shadow the DOM `document` in this project.
      const link = window.document.createElement('a');
      link.href = url;
      link.download = format === 'docx' ? docxFilename(latest.current.title || title) : `${(latest.current.title || title || 'notebook').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'notebook'}.html`;
      // appendChild, not append: the Workers type globals give `append` a conflicting signature here.
      // Firefox needs the anchor in the document for a programmatic click to start the download.
      window.document.body.appendChild(link); link.click(); link.remove();
      // Revoked on the next tick so the click has started the download.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice({ tone: 'success', message: format === 'docx' ? t('Berkas DOCX diunduh.', 'The DOCX file was downloaded.') : t('Berkas HTML diunduh.', 'The HTML file was downloaded.') });
    });
  }

  // Advanced mode is a notebook preference, so it saves like any other and the server has the final say.
  function toggleAdvanced(next: boolean) {
    setAdvancedMode(next);
    markMetadata(latest.current.title, latest.current.settings, latest.current.layout, next);
  }


  // Kind of writing, word target and brief: saved like any other metadata, never sent to the AI.
  function updateMeta(patch: Partial<typeof meta>) {
    const next = { ...latest.current.meta, ...patch };
    setMeta(next); markMetadata(latest.current.title, latest.current.settings, latest.current.layout, latest.current.advanced, next);
  }
  function runQuick(action: QuickAction) {
    void generate({ scope, surface: 'panel', label: quickActionLabel(action, t), override: quickActionOverride(action, latest.current.settings) });
  }

  // Clears the style marker as soon as the settings drift from the saved preset.
  const updateSettings = (next: Settings) => { const value = reconcileStyle(next, styleList.styles); setSettings(value); markMetadata(title, value); };
  // Applying a skill hides the chip for this session only; the permanent dismissal stays with the explicit "ignore".
  const chooseStyle = (style: WritingStyle) => { setSuggestionOff(true); updateSettings(applyStyle(latest.current.settings, style)); };
  // Saving a skill starts at Plus, so a free account is shown the plans instead of a 403 from the save.
  const openStyleDialog = (style: WritingStyle | null, preset: Settings, apply: boolean) =>
    (has('saved_styles') ? setStyleDialog({ style, preset, apply }) : openPlans());
  // Deleting the applied skill only drops the marker; the notebook keeps the settings it is running with.
  function onStyleDeleted(removed: WritingStyle) {
    setStyleDialog(null);
    // The deleted skill's sample and custom request must stop being sent; the notebook keeps writing in the same mode.
    if (latest.current.settings.styleId === removed.id) {
      updateSettings({ ...latest.current.settings, styleId: null, sample: '', extra: '', focus: [], format: defaults.format, length: defaults.length, customized: false });
      setModeTabRequest((value) => value + 1);
    }
    setNotice({ tone: 'success', message: t(`Skill “${removed.name}” dihapus.`, `Skill “${removed.name}” deleted.`) });
  }
  function onStyleSaved(saved: WritingStyle, created: boolean) {
    const shouldApply = styleDialog?.apply || latest.current.settings.styleId === saved.id;
    setStyleDialog(null);
    if (shouldApply) updateSettings(applyStyle(latest.current.settings, saved));
    setNotice({ tone: 'success', message: created ? t(`Skill “${saved.name}” tersimpan.`, `Skill “${saved.name}” saved.`) : t(`Skill “${saved.name}” diperbarui.`, `Skill “${saved.name}” updated.`) });
  }

  const lockedSelection = !!selection && terms.some((term) => term.term === selection.text.trim());
  const stale = !!preview && (preview.stamp !== editStamp || (doc !== null && preview.revision !== doc.revision && busy !== 'apply'));
  const panelPreview = preview?.surface === 'panel' ? preview : null;
  const inlinePreview = preview?.surface === 'inline' ? preview : null;
  const section = loaded && scope === 'section' ? currentSection() : null;
  // "Tulis bagian ini" in the Asisten follows the caret onto a section nobody has written yet.
  const draftSpot = loaded && editor && !compare && !recovery && !selection ? draftSpotAt(topBlocks(), Math.min(caret, editor.state.doc.content.size)) : null;
  const briefReady = !!(meta.briefTopic?.trim() || meta.briefMessage?.trim());
  const sectionText = section && editor ? editor.state.doc.textBetween(section.from, section.to, '\n', ' ') : '';
  const scopeText = scope === 'selection' ? selection?.text ?? '' : scope === 'section' ? sectionText : text;
  const detected = detectLanguage(scopeText || text);
  // Suggestion only: it never changes settings and never starts a generation.
  const suggestion = useMemo(() => (suggestionOff || !loaded || settings.styleId ? null : suggestStyle(styleList.styles, { title, text })), [suggestionOff, loaded, settings.styleId, styleList.styles, title, text]);
  const compareOptions = useMemo(() => [
    { value: WORKING, label: t('Tulisan saat ini', 'Current draft') },
    ...(preview ? [{ value: SOURCE, label: t('Teks sumber pratinjau', 'Preview source') }, { value: PREVIEW, label: t('Pratinjau AI', 'AI preview') }] : []),
    ...versions.map((version) => ({ value: version.id, label: `${versionLabel(version, t)} · ${dateTime(version.createdAt, locale)}` })),
  ], [preview, versions, t, locale]);

  if (loadError) {
    const kind = loadError.code === 'NOT_FOUND' ? 'not-found' : loadError.code === 'NETWORK_ERROR' ? 'offline' : 'error';
    const description = kind === 'not-found' ? t('Notebook ini tidak ada atau sudah dihapus. Periksa tautannya atau buka dari daftar notebook.', 'This notebook does not exist or was deleted. Check the link or open it from your notebooks.')
      : kind === 'offline' ? t('Koneksi internet terputus. Periksa jaringanmu lalu coba lagi.', 'You are offline. Check your connection and try again.')
      : t('Terjadi kendala saat memuat notebook. Coba lagi sebentar lagi.', 'Something went wrong while loading the notebook. Please try again shortly.');
    return (
      <StatusScreen kind={kind} title={t('Notebook tidak bisa dibuka', 'The notebook could not be opened')} description={description}
        primary={{ label: t('Coba lagi', 'Try again'), icon: statusIcons.retry, onClick: () => { setLoadError(null); setLoadAttempt((value) => value + 1); } }}
        secondary={{ label: t('Ke daftar notebook', 'Go to notebooks'), icon: statusIcons.back, href: '/notebooks' }} />
    );
  }

  // An imported notebook keeps the page setup of its source file; otherwise Word's locale default applies.
  const canvasStyle = pageStyle(pageLayout) as React.CSSProperties;
  const applyLayout = (next: PageLayout) => { setPageLayout(next); markMetadata(latest.current.title, latest.current.settings, next); setDialog(null); };
  // Recomputed per render so the dock always names the current target; cheap next to the editor itself.
  const dockRange = loaded ? instructionRange() : null;
  const instructionTarget = dockRange
    ? { label: selection?.text.trim() ? t('teks terpilih', 'the selection') : t('paragraf ini', 'this paragraph'), words: countWords(dockRange.text), chars: Array.from(dockRange.text).length }
    : null;
  const words = countWords(text);
  const spoken = isSpoken(meta.docType);
  const docType: DocType | null = isDocType(meta.docType) ? meta.docType : null;
  // An outline nobody filled in is not text to work on yet, even though its headings count as words.
  const emptyDocument = words < MIN_WORDS || (meta.docSource === 'skeleton' && original !== null && text === original);
  const structured = !!editor && loaded && (scope === 'document' ? hasStructure(editor.state.doc) : scope === 'section' && !!section && hasStructure(editor.state.doc.slice(section.from, section.to).content));
  const compareHint = comparePair ? null : t('Belum ada versi untuk dibandingkan', 'No version to compare yet');
  // On the Halaman canvas the hint sits inside the page margins, so it lines up with the first line of text.
  const emptyHint = (
    <div className="pointer-events-none absolute z-10" style={paged ? { top: 'var(--page-margin-top)', left: 'var(--page-margin-left)', right: 'var(--page-margin-right)' } : { top: 0, left: 0, right: 0 }}>
      <p aria-hidden="true" className={paged ? 'text-ink-500' : 'text-[16px] leading-[1.75] text-ink-500'}>{t('Mulai menulis, atau tempel teks yang ingin diolah', 'Start writing, or paste the text you want to work on')}</p>
      {!frozen && !recovery && (
        <button type="button" onClick={() => void pasteClipboard()} className={`pointer-events-auto mt-4 inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-sans text-[13px] font-semibold ${raisedGreen} ${pressGreen}`}>
          <ClipboardPaste size={15} aria-hidden="true" />{t('Tempel teks', 'Paste text')}
        </button>
      )}
    </div>
  );
  const closeOnNarrow = () => { if (narrow) setSheet(null); };
  const assistant = (
    <AssistantPanel
      suggestion={suggestion} onDismissSuggestion={dismissSuggestion}
      styles={styleList.styles} stylesLoading={styleList.loading} stylesError={styleList.error ? errorText(styleList.error, english) : ''} onRetryStyles={styleList.reload}
      onApplyStyle={chooseStyle} onCreateStyle={() => openStyleDialog(null, defaults, false)} onEditStyle={(style) => openStyleDialog(style, settings, false)} onSaveAsStyle={() => openStyleDialog(null, settings, true)}
      settings={settings} onSettings={updateSettings} scope={scope} onScope={setScope} hasSelection={!!selection} scopeWords={countWords(scopeText)} scopeChars={scopeText.length} detected={detected}
      busy={busy !== '' || !loaded} generating={(busy === 'generate' && lastRequest?.surface === 'panel') || (arriving && !aiError)} arrival={arriving} previewId={panelPreview?.id ?? null}
      manualBase={manualBase} modeTabRequest={modeTabRequest}
      error={aiError} onDismissError={() => setAiError('')} onRetry={() => (lastRequest?.draft !== undefined ? void draftSection(lastRequest.draft) : void generate(lastRequest?.surface === 'panel' ? lastRequest : { scope, surface: 'panel' }))}
      onGenerate={() => void generate({ scope, surface: 'panel' })} customizeRequest={customizeRequest}
      canGenerate={loaded && !!text.trim() && !recovery && !compare && (scope !== 'selection' || !!selection) && (scope !== 'section' || !!sectionText.trim())}
      section={scope === 'section' ? { heading: section?.heading ?? null, hasNext: section?.next !== null && section?.next !== undefined } : null} onNextSection={nextSection}
      onUpgrade={openPlans} docType={meta.docType} onQuickAction={runQuick} structured={structured} emptyDocument={loaded && emptyDocument}
      draft={draftSpot ? { heading: draftSpot.heading, ready: briefReady, locked: !has('draft_from_brief') } : null} onDraft={() => void draftSection()} onOpenBrief={openBrief}
      drafting={busy === 'generate' && lastRequest?.draft !== undefined}
    >
      {panelPreview?.draft && (
        <DraftCard preview={panelPreview} stale={stale} busy={busy !== ''} applying={busy === 'apply'} onApply={() => void apply()} onDiscard={() => void discard()}
          onRetry={() => { const position = panelPreview.draft!.pos; void discard().then(() => draftSection(position)); }} />
      )}
      {panelPreview && !panelPreview.draft && (
        <PreviewCard
          preview={panelPreview} stale={stale} busy={busy !== ''} applying={busy === 'apply'} paged={paged}
          onApply={() => void apply()} onCompare={() => { closeOnNarrow(); void openCompare(SOURCE, PREVIEW); }} onDiscard={() => void discard()}
          onRetry={() => void generate(lastRequest?.surface === 'panel' ? { ...lastRequest, override: panelPreview.settings, anchor: panelPreview.anchor } : { scope, surface: 'panel' })}
          onStronger={() => void generate({ scope: panelPreview.scope, surface: 'panel', anchor: panelPreview.anchor, override: { ...panelPreview.settings, strength: nextStrength(panelPreview.settings.strength) as Settings['strength'], preservation: panelPreview.settings.strength === 'strong' ? 'flexible' : panelPreview.settings.preservation } })}
          onReduce={() => void generate({ scope: panelPreview.scope, surface: 'panel', anchor: panelPreview.anchor, override: { ...panelPreview.settings, strength: lowerStrength(panelPreview.settings.strength) as Settings['strength'], preservation: 'conservative' } })}
        />
      )}
    </AssistantPanel>
  );

  const tabBody = (tab: StudioTab) => (tab === 'assistant' ? assistant : tab === 'history' ? (
    <HistoryPanel
      versions={versions} currentRevision={doc?.revision ?? null} originalId={doc?.originalVersionId ?? null} loading={!loaded} hasMore={!!versionCursor} loadingMore={loadingVersions} error={versionsError}
      busy={busy !== ''} canSave={loaded && !frozen} onLoadMore={loadMoreVersions} onRetry={loadMoreVersions} onSave={() => { setField(''); setDialog({ kind: 'checkpoint' }); }} loadText={versionText}
      onCompare={(version) => { closeOnNarrow(); void openCompare(version.id, WORKING); }} onRestore={(version) => setDialog({ kind: 'restore', version })}
      onRename={(version) => { setField(version.label ?? ''); setDialog({ kind: 'rename', version }); }} onDuplicate={(version) => void duplicateVersion(version)}
    />
  ) : (
    <ReviewPanel text={text} original={original} showOriginal={showOriginal} hasChanges={versions.some((version) => version.kind !== 'original')} spoken={spoken}
      analytics={
        <AnalyticsPanel text={text} original={original} showOriginal={showOriginal} scopeLabel={selection ? t('teks terpilih', 'selected text') : t('seluruh dokumen', 'entire document')} sourceChars={countCharacters(selection?.text.trim() ? selection.text : text)} quality={quality} stale={!!quality && quality.stamp !== editStamp}
          loading={qualityState.loading} error={qualityState.error} onAnalyze={() => void analyze()}
          blockedReason={!loaded ? t('Notebook masih dimuat.', 'The notebook is still loading.') : !text.trim() ? t('Tulisan masih kosong.', 'The text is empty.') : (selection?.text ?? text).length > AI_SCOPE_LIMIT ? t('Terlalu panjang untuk dianalisis sekaligus. Blok sebagian teks terlebih dahulu.', 'Too long to analyse at once. Select part of the text first.') : null} />
      } />
  ));
  const studio = (tab: StudioTab) => (
    <StudioPanel tab={tab} onTab={(next) => { setRightTab(next); if (sheet) setSheet(next); }} onClose={closeRight} narrow={narrow}>{tabBody(tab)}</StudioPanel>
  );
  const documentPanel = (asSheet: boolean) => (
    <DocPanelContent editor={editor} loaded={loaded} navigable={!compare} text={text} words={words} terms={terms} busy={busy !== ''} docId={id} title={title} meta={meta} mode={settings.mode}
      onMeta={updateMeta} onUnlock={(term) => void unlock(term)} onOpenAssistant={() => openRight('assistant')} onNavigate={closeOnNarrow}
      onProcessSection={(position) => { processSection(position); closeOnNarrow(); }}
      onDraftSection={(position) => { closeOnNarrow(); void draftSection(position + 1); }} draftLocked={!has('draft_from_brief')} briefOpen={briefFocus}
      onDraftFirst={briefFocus || (loaded && emptyDocument && meta.docSource === 'skeleton') ? () => { closeOnNarrow(); draftFirst(); } : undefined}
      onCopied={(message) => setNotice({ tone: 'success', message })} sheet={asSheet} onClose={() => (asSheet ? setSheet(null) : saveDocPanel({ ...docPanel, collapsed: true }))} />
  );

  const writing = (
    <main aria-label={t('Tulisan', 'Writing')} className={`flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl ${paged ? 'ww-writing-paged' : 'border border-line bg-white'}`}>
      {!compare && (paged
        ? <FormattingToolbar editor={editor} disabled={!loaded || frozen || !!recovery} zoom={pageZoom.zoom} onZoom={pageZoom.setZoom}
          onPageSetup={() => setDialog({ kind: 'page-setup' })} onHeaderFooter={() => setDialog({ kind: 'header-footer' })} />
        : <CompactToolbar editor={loaded ? editor : null} disabled={!loaded || frozen || !!recovery} />)}
      {compare ? (
        <CompareView options={compareOptions} a={compare.a} b={compare.b} before={compare.before} after={compare.after} loading={compare.loading} busy={busy !== ''} applying={busy === 'apply'}
          paged={paged} pageStyle={paged ? canvasStyle : undefined}
          onChange={(a, b) => void openCompare(a, b)} onExit={exitCompare}
          onRestore={(versionId) => { const version = versions.find((item) => item.id === versionId); if (version) setDialog({ kind: 'restore', version }); }}
          onApplyPreview={preview && !preview.output.alternatives && [compare.a, compare.b].includes(PREVIEW) && !stale ? () => void apply() : undefined} />
      ) : null}
      <div className={`relative min-h-0 flex-1 ${compare ? 'hidden' : ''}`}>
      <div ref={canvasRef} className={`scrollbar-thin h-full overflow-y-auto ${paged ? 'editor-paged' : 'px-5 pb-24 pt-6 sm:px-10 sm:pt-8'}`} style={paged ? canvasStyle : undefined}>
        <article className={paged ? 'ww-page-frame relative' : 'editor-plain relative mx-auto min-h-full max-w-[760px]'} style={paged ? ({ '--page-zoom': pageZoom.scale } as React.CSSProperties) : undefined}>
          {/* The kind of writing gives one short tip above the text; it never adds words to the notebook. */}
          {loaded && !paged && docType && text.trim() && !tipHidden && (
            <p className="mb-5 flex items-start gap-2 rounded-lg bg-paper px-3 py-2 font-sans text-[12.5px] leading-relaxed text-ink-600">
              <span className="min-w-0 flex-1">{docTypeHint(docType, t)}</span>
              <button type="button" onClick={() => setTipHidden(true)} aria-label={t('Sembunyikan tips', 'Hide tip')} className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 hover:text-ink-900"><X size={13} aria-hidden="true" /></button>
            </p>
          )}
          {/* An empty notebook explains itself on both canvases: a neutral hint plus a paste button. */}
          {loaded && !paged && !text.trim() && emptyHint}
          {paged && editor && loaded && !compare && (
            <PageRuler editor={editor} layout={pageLayout} zoom={pageZoom.scale} language={english ? 'en' : 'id'}
              disabled={!loaded || frozen || !!recovery} onMargins={(margins) => applyLayout({ ...pageLayout, margins })} />
          )}
          <div className={paged ? 'ww-page' : undefined}>
            {loaded && paged && !compare && !text.trim() && emptyHint}
            {!loaded && <LoadingBlock label={arriving ? t('Menyiapkan notebook…', 'Preparing your notebook…') : t('Memuat notebook…', 'Loading notebook…')} />}
            <div className={loaded ? '' : 'hidden'}><EditorContent editor={editor} /></div>
            {paged && loaded && (pageLayout.header || pageLayout.footer) && (
              <div aria-hidden="true" className="ww-running-layer">
                {Array.from({ length: pageLayout.columns === 1 ? pageCount : 1 }, (_, index) => (
                  <Fragment key={index}>
                    {pageLayout.header && (
                      <div className="ww-running ww-running-header" style={{ top: `calc(${index} * (var(--page-height) + ${PAGE_GUTTER}px) + var(--page-header-top))`, textAlign: pageLayout.header.align }}>
                        {renderRunning(pageLayout.header.text, index + 1, pageCount)}
                      </div>
                    )}
                    {pageLayout.footer && (
                      <div className="ww-running ww-running-footer" style={{ top: `calc(${index} * (var(--page-height) + ${PAGE_GUTTER}px) + var(--page-height) - var(--page-footer-bottom))`, textAlign: pageLayout.footer.align }}>
                        {renderRunning(pageLayout.footer.text, index + 1, pageCount)}
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
          {editor && loaded && <TableContextMenu editor={editor} disabled={busy !== '' || !!compare || !!recovery} />}
          {editor && loaded && <SelectionMenu editor={editor} locked={lockedSelection} disabled={busy !== ''} hidden={inline !== null} chars={selection?.text.length ?? 0} styles={styleList.styles} stylesLocked={!has('saved_styles')} onCommand={selectionCommand} onStyle={styleCommand} onUpgrade={openPlans} order={orderActions(meta.docType)} />}
          {editor && loaded && inline && (
            <InlineResult
              editor={editor} label={inline.label} status={inline.status} preview={inlinePreview} message={inline.message} stale={stale} busy={busy !== ''} applying={busy === 'apply'}
              onApply={(index) => void apply(index)} onRetry={lastRequest?.surface === 'inline' ? retryInline : undefined} onDiscard={() => void discard()}
              count={altCount} onCount={lastRequest?.surface === 'inline' ? (value) => { setAltCount(value); altCountRef.current = value; retryInline(); } : undefined}
            />
          )}
        </article>
      </div>
      {/* Perintah AI on both canvases; below Max it stays visible as a labelled lock. */}
      {loaded && !recovery && (
        <InstructionDock busy={busy !== ''} locked={!has('freeform_prompt')} target={instructionTarget}
          onSubmit={instructionCommand} onUpgrade={openPlans} onOpenChange={dockOpenChange}
          running={busy === 'generate' && !!lastRequest?.instruction} onStop={stopGeneration} />
      )}
      </div>
      {loaded && !compare && <StatusBar text={text} spoken={spoken} page={paged && pageLayout.columns === 1 ? { current: Math.min(page, pageCount), total: pageCount } : null} onOpen={openReview} />}
    </main>
  );

  const showDocPanel = !narrow && !focus;
  const showRight = !narrow && !focus && mounted;
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-shell">
      <NotebookHeader
        title={title} onTitle={(value) => { autoTitle.current = false; setTitle(value); markMetadata(value, settings); }} disabled={!loaded || frozen} comparing={!!compare} save={loaded ? save : 'loading'}
        docType={meta.docType} onDocType={(type) => updateMeta({ docType: type ?? undefined })}
        canAdvanced={has('advanced_notebook')} advanced={advanced} onAdvanced={toggleAdvanced}
        onSaveVersion={() => { setField(''); setDialog({ kind: 'checkpoint' }); }} compareHint={compare ? null : compareHint} onCompare={() => (compare ? exitCompare() : defaultCompare())} onHistory={() => openRight('history')}
        canExport={has('docx_export')} exporting={busy === 'export'} pageSize={pageLayout.size} onExportDocx={(size) => void exportFile('docx', size)} onExportHtml={() => void exportFile('html')}
        canCopy={loaded && !!text.trim()} onCopy={() => void copyAll()} onCopyPlain={() => void copyPlain()}
        onPageSetup={() => setDialog({ kind: 'page-setup' })} onHeaderFooter={() => setDialog({ kind: 'header-footer' })} onFocus={() => setFocusMode(!focus)} onNew={() => requestNewWriting()}
        onDuplicate={() => void duplicateNotebook()} onAppearance={setAppearanceAnchor} onReview={openReview} onDelete={() => setDialog({ kind: 'delete' })}
        pinned={pinned} onPin={(next) => void togglePin(next)}
        onUpgrade={openPlans}
      />

      {save === 'conflict' && (
        <Toast tone="warning" title={t('Notebook berubah di tempat lain', 'The notebook changed elsewhere')} actions={<><Button size="sm" icon={CopyPlus} loading={busy === 'copy'} onClick={() => void copyAsNew()}>{t('Simpan sebagai notebook baru', 'Save as a new notebook')}</Button><Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setDialog({ kind: 'reload' })}>{t('Muat salinan server', 'Load server copy')}</Button></>}>
          {t('Perubahanmu belum ditimpa dan masih ada di layar ini.', 'Nothing was overwritten; your changes are still on this screen.')}
        </Toast>
      )}
      {notice && <Toast tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')} actions={notice.retrySave ? <Button size="sm" icon={RefreshCw} onClick={() => { setNotice(null); setSave('dirty'); void flush().catch(() => undefined); }}>{t('Coba simpan lagi', 'Retry saving')}</Button> : undefined}>{notice.message}</Toast>}

      {/* The shared shell's rail stays fixed on the left, so the writing area starts after it on desktop; Mode fokus
          hides the rail and both side panels. Phones get the action bar instead of side panels. */}
      <div className={`flex min-h-0 flex-1 px-3 pb-3 ${focus ? '' : 'md:pl-[84px]'} ${narrow ? 'pb-[4.5rem]' : ''}`}>
        {showDocPanel && (docPanel.collapsed ? (
          <aside aria-label={t('Dokumen', 'Document')} className="mr-3 hidden h-full w-10 shrink-0 flex-col items-center gap-1 rounded-2xl border border-line bg-white py-2 lg:flex">
            <IconButton size="sm" icon={ChevronsRight} label={t('Buka panel Dokumen', 'Open the Document panel')} onClick={() => saveDocPanel({ ...docPanel, collapsed: false })} />
            <span aria-hidden="true" className="my-1 h-px w-5 bg-line" />
            <IconButton size="sm" icon={FileText} label={t('Kerangka, istilah, dan brief', 'Outline, terms and brief')} onClick={() => saveDocPanel({ ...docPanel, collapsed: false })} />
          </aside>
        ) : (
          <DocPanelFrame width={docPanel.width} onWidth={(width) => saveDocPanel({ width, collapsed: false })}>{documentPanel(false)}</DocPanelFrame>
        ))}
        {!showRight ? writing : (
          <Group orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged} className="min-w-0 flex-1">
            <Panel id="writing" minSize="45%">{writing}</Panel>
            <Separator aria-label={t('Ubah lebar panel kanan', 'Resize the side panel')} className={separatorClass} />
            <Panel id="studio" panelRef={rightPanel} defaultSize="360px" minSize="300px" maxSize="480px" groupResizeBehavior="preserve-pixel-size" collapsible collapsedSize="48px" onResize={(size) => setPanelOpen(size.inPixels > 60)}>
              {panelOpen ? studio(rightTab) : <StudioStrip onOpen={(tab) => openRight(tab ?? rightTab)} />}
            </Panel>
          </Group>
        )}
      </div>

      {focus && (
        <button type="button" onClick={() => setFocusMode(false)} className="fixed bottom-4 right-4 z-30 inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-[12.5px] font-semibold text-ink-700 shadow-[0_8px_24px_-12px_rgb(31_32_29/0.35)] transition-colors hover:bg-paper">
          <Minimize2 size={14} aria-hidden="true" />{t('Keluar mode fokus', 'Leave focus mode')} <kbd className="rounded border border-line bg-paper px-1 text-[10.5px] font-medium text-ink-500">Esc</kbd>
        </button>
      )}

      {/* Phones and small tablets: one bar replaces the Studio pill; each button opens its own sheet. */}
      {narrow && (
        <nav aria-label={t('Panel notebook', 'Notebook panels')} className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-line bg-shell/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
          {([['document', FileText, t('Dokumen', 'Document')] as const, ...studioTabs.map((tab) => [tab.id, tab.icon, tab.label] as const)]).map(([value, Icon, label]) => (
            <button key={value} type="button" aria-haspopup="dialog" aria-pressed={sheet === value} onClick={() => { if (value === 'document') setSheet('document'); else openRight(value); }}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold ${sheet === value ? 'text-ink-900' : 'text-ink-500'}`}>
              <span className={`grid h-8 w-10 place-items-center rounded-lg ${sheet === value ? 'bg-white text-brand-800 shadow-[0_1px_2px_rgb(31_32_29/0.08)]' : ''}`}><Icon size={18} aria-hidden="true" /></span>
              <span className="max-w-full truncate">{label}</span>
            </button>
          ))}
        </nav>
      )}
      {narrow && sheet && (
        <>
          <div className="fixed inset-0 z-40 bg-ink-900/30" aria-hidden="true" onClick={() => setSheet(null)} />
          <div role="dialog" aria-modal="true" aria-label={sheet === 'document' ? t('Dokumen', 'Document') : studioTabs.find((tab) => tab.id === sheet)?.label}
            className={`fixed inset-y-0 z-50 w-full max-w-md bg-shell p-2 shadow-2xl animate-slide-in ${sheet === 'document' ? 'left-0' : 'right-0'}`}>
            {sheet === 'document' ? <div className="h-full overflow-hidden rounded-2xl border border-line bg-white">{documentPanel(true)}</div> : studio(sheet)}
          </div>
        </>
      )}
      {appearanceAnchor && (
        <AppearancePicker anchor={appearanceAnchor} color={appearance.color} icon={appearance.icon} mode={settings.mode} onClose={() => setAppearanceAnchor(null)}
          onSelect={(next) => { void appearanceSave.save(next); if (next.icon !== appearance.icon && next.icon !== null) setAppearanceAnchor(null); }} />
      )}
      {appearanceSave.error && <Toast tone="error" onDismiss={appearanceSave.clearError} dismissLabel={t('Tutup', 'Dismiss')} title={t('Tampilan gagal disimpan', 'Could not save appearance')}>{appearanceSave.error}</Toast>}

      {dialog?.kind === 'page-setup' && (
        <PageSetupDialog layout={pageLayout} language={english ? 'en' : 'id'} onClose={() => setDialog(null)} onApply={applyLayout} />
      )}
      {dialog?.kind === 'header-footer' && (
        <HeaderFooterDialog layout={pageLayout} onClose={() => setDialog(null)} onApply={applyLayout} />
      )}
      {dialog?.kind === 'checkpoint' && (
        <ConfirmDialog title={t('Simpan Versi', 'Save Version')} description={t('Membuat titik simpan yang bisa kamu bandingkan atau pulihkan nanti.', 'Creates a checkpoint you can compare or restore later.')} confirmLabel={t('Simpan', 'Save')} busy={busy === 'checkpoint'} onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <label className="block text-[13px] font-semibold text-ink-700">{t('Nama versi (opsional)', 'Version name (optional)')}<input autoFocus className={`${inputClass} mt-1.5`} value={field} maxLength={120} onChange={(event) => setField(event.target.value)} placeholder={t('Mis. Draft untuk dosen pembimbing', 'E.g. Draft for supervisor')} /></label>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'rename' && (
        <ConfirmDialog title={t('Ubah nama versi', 'Rename version')} confirmLabel={t('Simpan nama', 'Save name')} busy={busy === 'rename'} disabled={!field.trim()} onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <input autoFocus aria-label={t('Nama versi', 'Version name')} className={inputClass} value={field} maxLength={120} onChange={(event) => setField(event.target.value)} />
        </ConfirmDialog>
      )}
      {dialog?.kind === 'restore' && dialog.version && (
        <ConfirmDialog title={t('Pulihkan versi ini?', 'Restore this version?')} confirmLabel={t('Ya, pulihkan', 'Yes, restore')} busy={busy === 'restore'} onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <p><b className="text-ink-900">{versionLabel(dialog.version, t)}</b> {t('akan menjadi tulisan aktif. Tulisan saat ini disimpan dulu, dan semua riwayat tetap ada.', 'will become the active text. Your current text is saved first, and all history is kept.')}</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog title={t('Pindahkan ke Sampah?', 'Move to the trash?')} tone="danger" confirmLabel={t('Pindahkan ke Sampah', 'Move to trash')} busy={busy === 'delete'} onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <p>{t('Notebook ini beserta semua versinya pindah ke Sampah dan bisa dipulihkan selama 30 hari. Setelah itu dihapus permanen.', 'This notebook and all its versions move to the trash and can be restored for 30 days. After that it is deleted for good.')}</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'reload' && (
        <ConfirmDialog title={t('Muat salinan server?', 'Load the server copy?')} confirmLabel={t('Muat ulang', 'Reload')} tone="danger" onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <p>{localDrafts.current ? t('Tulisanmu di layar ini tersimpan sebagai salinan pemulihan dan akan ditawarkan setelah dimuat ulang.', 'Your on-screen text is kept as a recovery copy and will be offered after reloading.') : t('Salinan pemulihan lokal nonaktif. Perubahan yang belum tersimpan akan hilang.', 'Local recovery is off. Unsaved changes will be lost.')}</p>
        </ConfirmDialog>
      )}
      {leaving && (
        <Modal title={t('Perubahan belum tersimpan', 'Unsaved changes')} description={t('Kamu punya perubahan yang belum tersimpan di notebook ini.', 'You have unsaved changes in this notebook.')} busy={leaving.saving} onClose={() => setLeaving(null)}
          footer={<>
            <button type="button" disabled={leaving.saving} onClick={() => void discardAndLeave()} className="mr-auto inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"><Trash2 size={15} aria-hidden="true" />{t('Buang perubahan', 'Discard changes')}</button>
            <button type="button" disabled={leaving.saving} onClick={() => setLeaving(null)} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-[13px] font-semibold text-ink-800 transition-colors hover:border-line-strong hover:bg-paper disabled:opacity-50">{t('Batal', 'Cancel')}</button>
            <button type="button" disabled={leaving.saving} aria-busy={leaving.saving || undefined} onClick={() => void saveAndLeave()} className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold disabled:opacity-80 ${raisedGreen} ${pressGreen}`}>
              {leaving.saving ? <Spinner size={15} /> : <Save size={15} aria-hidden="true" />}{t('Simpan & keluar', 'Save & leave')}
            </button>
          </>} />
      )}
      {styleDialog && (
        <StyleDialog styles={styleList.styles} style={styleDialog.style} preset={styleDialog.preset} onClose={() => setStyleDialog(null)} onSaved={onStyleSaved} onDeleted={onStyleDeleted} />
      )}
      {recovery && (
        <Modal title={t('Ada tulisan yang belum tersimpan', 'Unsaved writing found')} description={`${t('Dari perangkat ini', 'From this device')} · ${dateTime(recovery.updatedAt, locale)}`} busy={busy === 'recover'} dismissible={false} onClose={() => undefined} size="lg"
          footer={<>
            <Button disabled={busy === 'recover'} onClick={() => void recover('discard')}>{t('Pakai salinan server', 'Use server copy')}</Button>
            <Button disabled={busy === 'recover'} icon={CopyPlus} onClick={() => void recover('copy')}>{t('Simpan sebagai notebook baru', 'Save as a new notebook')}</Button>
            {recovery.revision === doc?.revision && <Button variant="primary" loading={busy === 'recover'} onClick={() => void recover('continue')}>{t('Lanjutkan tulisan ini', 'Continue this draft')}</Button>}
          </>}>
          <p className="mb-3">{t('Periksa isinya sebelum memilih. "Pakai salinan server" akan membuang salinan lokal ini.', 'Review it before choosing. "Use server copy" discards this local copy.')}</p>
          <div className="scrollbar-thin max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-paper px-4 py-3 font-serif text-[15px] leading-relaxed text-ink-900">{documentText(recovery.content)}</div>
        </Modal>
      )}
    </div>
  );
}
