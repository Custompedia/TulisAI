'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { JSONContent } from '@tiptap/core';
import { del, get, set } from 'idb-keyval';
import { Bot, ChartNoAxesColumn, CopyPlus, History, PanelLeftOpen, PanelRightClose, RefreshCw, RotateCcw, X, type LucideIcon } from 'lucide-react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type LayoutStorage } from 'react-resizable-panels';
import { useLocale } from '@/lib/client/locale';
import { ApiError, errorText, newKey, request } from '@/lib/client/api';
import { dateTime, numberFormat } from '@/lib/client/format';
import { documentText, plainTextDocument, selectionOffsets } from '@/lib/editor/document';
import { countWords } from '@/lib/editor/metrics';
import { AI_SCOPE_LIMIT, INLINE_LIMIT, SELECTION_LIMIT, customConflict, defaults, detectLanguage, isMode, modeFromPrompt, promptFor, resolveLanguage, runtimeControls, type Settings } from '@/lib/writing/settings';
import { useSessionGuard, type UserSettings } from '@/components/app/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Toast } from '@/components/ui/Toast';
import { Button, buttonClass, IconButton } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { LoadingBlock } from '@/components/ui/Spinner';
import { AnalyticsPanel } from './AnalyticsPanel';
import { AssistantPanel } from './AssistantPanel';
import { CompareView } from './CompareView';
import { documentLimits } from './document-limits';
import { FormatToolbar } from './FormatToolbar';
import { HistoryPanel } from './HistoryPanel';
import { PreviewCard } from './PreviewCard';
import { ProjectPanel } from './ProjectPanel';
import { protectionExtension } from './protection';
import { SelectionMenu, type SelectionCommand } from './SelectionMenu';
import { PREVIEW, previewText, SOURCE, WORKING, type Doc, type Draft, type InlineAction, type Preview, type Quality, type SaveState, type Scope, type SelectionRange, type Term, type Version } from './types';
import { versionLabel } from './versions';
import { WorkspaceHeader } from './WorkspaceHeader';

type GenerateRequest = { scope: Scope; inlineAction?: InlineAction; override?: Settings; anchor?: { from: number; to: number }; pmTo?: number };
type Dialog = { kind: 'checkpoint' | 'rename' | 'restore' | 'link' | 'delete' | 'reload'; version?: Version };
type Notice = { tone: 'success' | 'error' | 'info'; message: string; retrySave?: boolean };
type CompareState = { a: string; b: string; before: string; after: string; loading: boolean };
type RightTab = 'assistant' | 'history' | 'analytics';

const FROZEN = new Set(['apply', 'restore', 'recover', 'delete']);
const nextStrength = (value: string) => (value === 'light' ? 'balanced' : 'strong');
const lowerStrength = (value: string) => (value === 'strong' ? 'balanced' : 'light');
const layoutStorage: LayoutStorage = {
  getItem: (key) => { try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); } catch { return null; } },
  setItem: (key, value) => { try { window.localStorage.setItem(key, value); } catch { return; } },
};
const separatorClass = 'relative w-1.5 shrink-0 bg-transparent outline-none transition-colors before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-line hover:bg-brand-100 data-[separator=hover]:bg-brand-100 data-[separator=focus]:bg-brand-200 data-[separator=active]:bg-brand-400 data-[separator=active]:before:bg-transparent';

function TabStrip({ tabs, active, open, onPick }: { tabs: Array<{ id: RightTab; icon: LucideIcon; label: string }>; active: RightTab; open: boolean; onPick: (tab: RightTab) => void }) {
  return (
    <nav role="tablist" aria-orientation="vertical" className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-line bg-white py-2">
      {tabs.map(({ id, icon: Icon, label }) => {
        const selected = open && active === id;
        return (
          <button key={id} type="button" role="tab" aria-selected={selected} aria-label={label} title={label} onClick={() => onPick(id)}
            className={`grid h-10 w-10 place-items-center rounded-lg transition-colors ${selected ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-100' : 'text-ink-500 hover:bg-paper-deep hover:text-ink-900'}`}>
            <Icon size={18} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { t, locale, setLocale } = useLocale();
  const english = locale === 'en';
  const guard = useSessionGuard();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [doc, setDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState<Settings>(defaults);
  const [text, setText] = useState('');
  const [editStamp, setEditStamp] = useState(0);
  const [metaTick, setMetaTick] = useState(0);
  const [save, setSave] = useState<SaveState>('loading');
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState('');
  const [aiError, setAiError] = useState('');
  const [narrow, setNarrow] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>('assistant');
  const [versionsError, setVersionsError] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionCursor, setVersionCursor] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [terms, setTerms] = useState<Term[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [alternative, setAlternative] = useState(0);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [scope, setScope] = useState<Scope>('document');
  const [compare, setCompare] = useState<CompareState | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [field, setField] = useState('');
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [quality, setQuality] = useState<(Quality & { stamp: number }) | null>(null);
  const [qualityState, setQualityState] = useState({ loading: false, error: '' });
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);

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
  const latest = useRef({ title, settings });
  const versionTexts = useRef(new Map<string, string>());
  const autoStarted = useRef(false);
  const compareStarted = useRef(false);
  const termsRef = useRef<string[]>([]);
  const protectedLabel = useRef('');
  const englishRef = useRef(english);
  const contentRef = useRef<JSONContent | null>(null);
  const leftPanel = usePanelRef();
  const rightPanel = usePanelRef();
  const layout = useDefaultLayout({ id: 'workspace-layout', storage: layoutStorage, panelIds: ['project', 'canvas', 'assistant'] });
  latest.current = { title, settings };
  termsRef.current = terms.map((term) => term.term);
  protectedLabel.current = t('Dilindungi: tidak akan diubah AI', 'Protected: AI will not change this');
  englishRef.current = english;

  const cache = useCallback((content: JSONContent) => {
    const base = current.current;
    if (!base || !cacheKey.current || !localDrafts.current) return;
    const draft: Draft = { owner: owner.current, revision: base.revision, content, title: latest.current.title, settings: latest.current.settings, updatedAt: Date.now() };
    void set(cacheKey.current, draft).catch(() => setSave('local-unavailable'));
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ code: false, codeBlock: false, strike: false, link: { openOnClick: false, autolink: true, protocols: ['http', 'https'] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      protectionExtension(() => termsRef.current, () => protectedLabel.current),
      documentLimits(() => setNotice({ tone: 'error', message: englishRef.current ? 'This content exceeds the document limit or uses unsupported formatting.' : 'Isi melewati batas dokumen atau memakai format yang belum didukung.' })),
    ],
    content: plainTextDocument(''),
    editorProps: { attributes: { class: 'focus:outline-none', 'aria-label': t('Isi dokumen', 'Document content'), spellcheck: 'true' } },
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
      if (from === to) { setSelection(null); setScope((value) => (value === 'selection' ? 'document' : value)); return; }
      try {
        const json = instance.getJSON(); const offsets = selectionOffsets(json, from, to);
        setSelection({ ...offsets, text: documentText(json).slice(offsets.from, offsets.to), pmTo: to }); setScope('selection');
      } catch { setSelection(null); }
    },
  });

  const frozen = FROZEN.has(busy);
  useEffect(() => { if (editor && loaded) editor.setEditable(!compare && !frozen && !recovery, false); }, [editor, loaded, compare, frozen, recovery]);
  useEffect(() => { editor?.view.dispatch(editor.state.tr.setMeta('refreshProtection', true)); }, [editor, terms]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const apply = () => { setNarrow(media.matches); if (media.matches) { setPanelOpen(false); setLeftOpen(false); } };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); if (navigator.onLine) setSave((state) => (state === 'offline' ? 'dirty' : state)); };
    update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => () => {
    // Best-effort save when leaving the document inside the app; the local recovery copy covers failures.
    const base = current.current; const content = contentRef.current;
    if (!base || !content || (!dirty.current && !metaDirty.current)) return;
    void fetch(`/api/documents/${id}/autosave`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newKey() }, body: JSON.stringify({ content, title: latest.current.title.trim() || 'Untitled document', language: latest.current.settings.language, preferences: latest.current.settings, expectedRevision: base.revision }) }).catch(() => undefined);
  }, [id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current || metaDirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    if (!narrow) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPanelOpen(false); setLeftOpen(false); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [narrow]);
  useEffect(() => { if (notice?.tone !== 'success') return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer); }, [notice]);

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
      const [user, prefs, value] = await Promise.all([request<{ id: string }>('/api/me'), request<UserSettings>('/api/settings'), request<Doc>(`/api/documents/${id}`)]);
      if (!isLive()) return;
      setLocale(prefs.interfaceLanguage);
      localDrafts.current = prefs.localDrafts !== false; owner.current = user.id; cacheKey.current = `writing-draft:${user.id}:${id}`;
      current.current = value; setDoc(value); setTitle(value.title);
      const base: Settings = { ...defaults, mode: modeFromPrompt(prefs.defaultMode) ?? 'standard', context: prefs.humanizerContext, ...(value.preferences ?? {}), language: value.language };
      const modeParam = search.get('mode'); if (isMode(modeParam)) base.mode = modeParam;
      setSettings(base); latest.current = { title: value.title, settings: base };
      editor.commands.setContent(value.content, { emitUpdate: false }); contentRef.current = value.content;
      setText(documentText(value.content)); setSave('saved');
      await Promise.all([loadVersions(), loadTerms()]);
      if (value.originalVersionId) versionText(value.originalVersionId).then(setOriginal).catch(() => setOriginal(null));
      const draft = await get<Draft>(cacheKey.current).catch(() => undefined);
      if (isLive() && localDrafts.current && draft?.owner === user.id && (JSON.stringify(draft.content) !== JSON.stringify(value.content) || draft.title !== value.title)) setRecovery(draft);
      const panelParam = search.get('panel'); if (panelParam === 'history' || panelParam === 'analytics') { openRight(panelParam); syncUrl({ panel: null }); }
      if (isLive()) { initializing.current = false; setLoaded(true); }
    } catch (caught) { if (isLive() && !guard(caught)) setLoadError(errorText(caught, english)); }
  });

  useEffect(() => {
    if (!editor) return;
    let live = true;
    initializing.current = true; dirty.current = false; metaDirty.current = false; stamp.current = 0;
    setLoaded(false); setPreview(null); setCompare(null); setOriginal(null); setQuality(null); versionTexts.current.clear();
    void loadDocument(() => live);
    return () => { live = false; initializing.current = true; };
  }, [id, editor]);

  async function flush(): Promise<Doc> {
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    const base = current.current;
    if (!base || !editor) throw new Error('not-loaded');
    if (!dirty.current && !metaDirty.current) return base;
    const savedStamp = stamp.current; const savedMeta = metaStamp.current;
    const payload = { content: editor.getJSON(), title: latest.current.title.trim() || t('Dokumen tanpa judul', 'Untitled document'), language: latest.current.settings.language, preferences: latest.current.settings, expectedRevision: base.revision };
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

  function markMetadata(nextTitle: string, nextSettings: Settings) {
    latest.current = { title: nextTitle, settings: nextSettings };
    metaDirty.current = true; metaStamp.current++; setMetaTick(metaStamp.current);
    setSave((state) => (state === 'conflict' ? state : 'dirty'));
    if (editor) cache(editor.getJSON());
  }

  async function run(name: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setNotice(null);
    try { await work(); } catch (caught) { if (!guard(caught)) setNotice({ tone: 'error', message: errorText(caught, english) }); } finally { setBusy(''); }
  }

  function loadContent(value: Doc) {
    if (!editor) return;
    current.current = { ...current.current, ...value }; setDoc(current.current);
    editor.commands.setContent(value.content, { emitUpdate: false }); contentRef.current = value.content;
    setText(documentText(value.content)); setSelection(null);
    stamp.current++; setEditStamp(stamp.current); setSave('saved');
    void del(cacheKey.current).catch(() => undefined);
  }

  function resolveScope(req: GenerateRequest, full: string): { anchor?: { from: number; to: number }; source: string; pmTo?: number } | string {
    if (req.anchor) return { anchor: req.anchor, source: full.slice(req.anchor.from, req.anchor.to), pmTo: req.pmTo };
    if (req.scope === 'selection') {
      if (!selection?.text.trim()) return t('Blok teks di editor terlebih dahulu.', 'Select text in the editor first.');
      return { anchor: { from: selection.from, to: selection.to }, source: selection.text, pmTo: selection.pmTo };
    }
    if (req.scope === 'paragraph' && editor) {
      const position = selectionOffsets(editor.getJSON(), editor.state.selection.from, editor.state.selection.from).from;
      const from = full.lastIndexOf('\n', Math.max(0, position - 1)) + 1; const end = full.indexOf('\n', position); const to = end < 0 ? full.length : end;
      if (to <= from) return t('Letakkan kursor di paragraf yang berisi teks.', 'Place the cursor in a paragraph with text.');
      return { anchor: { from, to }, source: full.slice(from, to) };
    }
    return { source: full };
  }

  async function generate(req: GenerateRequest) {
    if (!editor || busy) return;
    const effective = req.override ?? latest.current.settings;
    const conflict = effective.customized || effective.mode === 'custom' ? customConflict(effective, termsRef.current) : null;
    openRight('assistant');
    if (conflict) { setAiError(conflict === 'summary-detail' ? t('Ringkasan tidak bisa digabung dengan "Lebih detail". Ubah salah satunya di Sesuaikan.', 'A summary cannot be combined with "More detailed". Change one in Customize.') : t('Permintaan tambahan menyebut istilah yang dikunci. Buka kunci istilah itu dulu jika ingin mengubahnya.', 'Your additional request mentions a locked term. Unlock it first if you want it changed.')); return; }
    setBusy('generate'); setAiError(''); setLastRequest(req);
    try {
      const saved = await flush();
      if (dirty.current) { setAiError(t('Tulisan masih berubah. Coba lagi setelah selesai mengetik.', 'The text is still changing. Try again when you finish typing.')); return; }
      const full = documentText(editor.getJSON());
      const resolved = resolveScope(req, full);
      if (typeof resolved === 'string') { setAiError(resolved); return; }
      if (!resolved.source.trim()) { setAiError(t('Bagian yang dipilih masih kosong.', 'The chosen part is empty.')); return; }
      const limit = req.inlineAction ? INLINE_LIMIT : req.scope === 'document' ? AI_SCOPE_LIMIT : SELECTION_LIMIT;
      if (resolved.source.length > limit) { setAiError(req.scope === 'selection' ? t(`${numberFormat(resolved.source.length, 'id')}/${numberFormat(limit, 'id')} karakter — persingkat pilihan.`, `${numberFormat(resolved.source.length, 'en')}/${numberFormat(limit, 'en')} characters — shorten the selection.`) : t(`Terlalu panjang untuk sekali proses (maks. ${numberFormat(limit, 'id')} karakter). Pilih paragraf atau blok sebagian teks.`, `Too long for one run (max ${numberFormat(limit, 'en')} characters). Choose a paragraph or select part of the text.`)); return; }
      const plainList = effective.mode === 'custom' && (effective.format === 'bullets' || effective.format === 'numbered_list') && effective.length === 'same' && !effective.focus.length && !effective.extra.trim();
      if (plainList && !req.inlineAction && req.scope !== 'paragraph' && resolved.source.split('\n').filter((line) => line.trim()).length >= 2) {
        const listType = effective.format === 'bullets' ? 'bulletList' : 'orderedList';
        if (!editor.isActive(listType)) { const chain = editor.chain().focus(); if (req.scope === 'document') chain.selectAll(); (listType === 'bulletList' ? chain.toggleBulletList() : chain.toggleOrderedList()).run(); }
        setNotice({ tone: 'success', message: t('Baris sudah terpisah, jadi langsung diformat tanpa AI.', 'The lines were already separate, so they were formatted without AI.') });
        return;
      }
      const language = resolveLanguage(effective, resolved.source);
      if (!language) { setAiError(t('Bahasa belum terdeteksi. Pilih Indonesia atau English di panel.', 'The language could not be detected. Choose Indonesian or English in the panel.')); return; }
      if (preview) void request(`/api/ai/previews/${preview.id}/discard`, 'POST', {}, newKey()).catch(() => undefined);
      setPreview(null);
      const captured = stamp.current;
      const result = await request<{ id: string; output: Preview['output']; expiresAt: string }>('/api/ai/generate', 'POST', {
        documentId: id, promptId: req.inlineAction ? 'P07_INLINE_ALTERNATIVES' : promptFor[effective.mode],
        source: { text: resolved.source, ...(resolved.anchor ? { anchor: resolved.anchor } : {}) },
        runtime: runtimeControls(effective, language, req.inlineAction), expectedRevision: saved.revision,
      }, newKey());
      setPreview({ ...result, source: resolved.source, stamp: captured, anchor: resolved.anchor, settings: effective, scope: req.anchor ? (req.scope === 'document' ? 'document' : req.scope) : req.scope, revision: saved.revision, inlineAction: req.inlineAction, pmTo: resolved.pmTo });
      setAlternative(0);
    } catch (caught) { if (!guard(caught)) setAiError(errorText(caught instanceof ApiError && caught.code.toUpperCase() === 'SCOPE_TOO_LARGE' ? new ApiError('SCOPE_TOO_LARGE', caught.status) : caught, english)); }
    finally { setBusy(''); }
  }

  const runInitialGenerate = useEffectEvent(() => {
    if (!loaded || recovery || autoStarted.current || search.get('autoGenerate') !== '1') return;
    autoStarted.current = true;
    const intent = sessionStorage.getItem(`writing-generate:${id}`); sessionStorage.removeItem(`writing-generate:${id}`);
    syncUrl({ autoGenerate: null, mode: null });
    if (intent === '1') void generate({ scope: 'document' });
  });
  useEffect(() => { runInitialGenerate(); }, [loaded, recovery]);

  async function apply() {
    if (!preview || !current.current) return;
    const target = preview;
    await run('apply', async () => {
      const result = await request<Doc>(`/api/ai/previews/${target.id}/apply`, 'POST', { expectedRevision: current.current!.revision, ...(target.output.alternatives ? { selectedAlternative: alternative } : {}) }, newKey());
      loadContent(result); setPreview(null); setCompare(null); syncUrl({ compare: null });
      await loadVersions();
      setNotice({ tone: 'success', message: t('Hasil diterapkan dan tersimpan sebagai versi baru.', 'Result applied and saved as a new version.') });
    });
  }

  async function discard() {
    if (!preview) return;
    const target = preview;
    setPreview(null); if (compare && [compare.a, compare.b].some((side) => side === PREVIEW || side === SOURCE)) setCompare(null);
    await request(`/api/ai/previews/${target.id}/discard`, 'POST', {}, newKey()).catch(() => undefined);
  }

  function insertAlternative() {
    if (!preview || !editor || preview.stamp !== stamp.current || preview.pmTo === undefined) return;
    editor.chain().focus().insertContentAt(preview.pmTo, ` ${previewText(preview, alternative)}`).run();
    void discard();
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

  function selectionCommand(command: SelectionCommand) {
    if (!selection) return;
    const multi = selection.text.includes('\n');
    const base = latest.current.settings;
    switch (command) {
      case 'lock': void lockSelection(); return;
      case 'unlock': { const term = terms.find((item) => item.term === selection.text.trim()); if (term) void unlock(term); return; }
      case 'custom': { const next = { ...base, mode: 'custom' as const }; setSettings(next); markMetadata(title, next); setScope('selection'); openRight('assistant'); return; }
      case 'humanize': void generate({ scope: 'selection', override: { ...base, mode: 'humanize', context: base.mode === 'academic' ? 'academic' : base.mode === 'professional' ? 'professional' : base.context } }); return;
      case 'academic': void generate({ scope: 'selection', override: { ...base, mode: 'academic' } }); return;
      default:
        if (selection.text.length > INLINE_LIMIT) { openRight('assistant'); setAiError(t(`${numberFormat(selection.text.length, 'id')}/${numberFormat(INLINE_LIMIT, 'id')} karakter — persingkat pilihan.`, `${numberFormat(selection.text.length, 'en')}/${numberFormat(INLINE_LIMIT, 'en')} characters — shorten the selection.`)); return; }
        if (!multi) { void generate({ scope: 'selection', inlineAction: command }); return; }
        if (command === 'alternatives') { openRight('assistant'); setAiError(t('Alternatif hanya untuk kata, frasa, atau satu kalimat. Pilih bagian yang lebih kecil.', 'Alternatives work on a word, phrase, or single sentence. Select a smaller part.')); return; }
        void generate({ scope: 'selection', override: command === 'clearer' ? { ...base, mode: 'simplify' } : command === 'shorter' ? { ...base, mode: 'standard', customized: true, length: 'shorter' } : command === 'formal' ? { ...base, mode: 'professional' } : command === 'natural' ? { ...base, mode: 'humanize' } : { ...base, mode: 'standard' } });
    }
  }

  async function openCompare(a: string, b: string) {
    setCompare({ a, b, before: '', after: '', loading: true });
    const resolve = async (side: string) => side === WORKING ? documentText(editor?.getJSON() ?? plainTextDocument('')) : side === PREVIEW ? (preview ? previewText(preview, alternative) : '') : side === SOURCE ? (preview?.source ?? '') : versionText(side);
    try {
      const [before, after] = await Promise.all([resolve(a), resolve(b)]);
      setCompare({ a, b, before, after, loading: false });
      syncUrl({ compare: [a, b].some((side) => side === PREVIEW || side === SOURCE) ? null : `${a}:${b}` });
    } catch (caught) { setCompare(null); if (!guard(caught)) setNotice({ tone: 'error', message: errorText(caught, english) }); }
  }
  function exitCompare() { setCompare(null); syncUrl({ compare: null }); }
  function defaultCompare() {
    const originalId = doc?.originalVersionId ?? versions.at(-1)?.id;
    if (originalId) void openCompare(originalId, WORKING);
  }
  const runInitialCompare = useEffectEvent(() => {
    const pair = search.get('compare'); if (!loaded || !pair || compareStarted.current) return;
    compareStarted.current = true; const [a, b] = pair.split(':'); if (a && b) void openCompare(a, b);
  });
  useEffect(() => { runInitialCompare(); }, [loaded]);

  function openRight(tab: RightTab) { setRightTab(tab); setPanelOpen(true); rightPanel.current?.expand(); }
  function closeRight() { setPanelOpen(false); rightPanel.current?.collapse(); }
  function toggleRight() { if (panelOpen) closeRight(); else openRight(rightTab); }
  function pickTab(tab: RightTab) { if (panelOpen && rightTab === tab && !narrow) closeRight(); else openRight(tab); }
  function toggleLeft() { if (leftOpen) { setLeftOpen(false); leftPanel.current?.collapse(); } else { setLeftOpen(true); leftPanel.current?.expand(); } }
  function loadMoreVersions() {
    if (!versionCursor || loadingVersions) return;
    setLoadingVersions(true); setVersionsError('');
    void loadVersions(versionCursor).catch((caught) => { if (!guard(caught)) setVersionsError(errorText(caught, english)); }).finally(() => setLoadingVersions(false));
  }

  async function duplicateVersion(version: Version) {
    await run('duplicate', async () => {
      const content = (await request<{ content: JSONContent }>(`/api/documents/${id}/versions/${version.id}`)).content;
      const copy = await request<{ id: string }>('/api/documents', 'POST', { title: `${title} — ${versionLabel(version, t)}`.slice(0, 180), content, language: settings.language, preferences: settings }, newKey());
      router.push(`/projects/${copy.id}`);
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
      const result = await request<Quality>('/api/ai/analyze-quality', 'POST', { documentId: id, expectedRevision: saved.revision, source: { text: source, ...(anchor ? { anchor } : {}) }, language, context: settings.mode === 'custom' ? 'standard' : settings.mode }, newKey());
      setQuality({ ...result, stamp: stamp.current }); setQualityState({ loading: false, error: '' });
    } catch (caught) {
      if (guard(caught)) return;
      setQualityState({ loading: false, error: caught instanceof Error && caught.message === 'language' ? t('Pilih bahasa tulisan dulu di panel AI.', 'Choose the writing language in the AI panel first.') : errorText(caught, english) });
    }
  }

  async function confirmDialog() {
    if (!dialog || !editor) return;
    const active = dialog;
    await run(active.kind, async () => {
      if (active.kind === 'link') {
        const href = field.trim();
        if (href && !/^https?:\/\/\S+$/i.test(href)) throw new ApiError('INVALID_LINK', 400);
        if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run(); else editor.chain().focus().extendMarkRange('link').unsetLink().run();
      } else if (active.kind === 'delete') {
        await request(`/api/documents/${id}`, 'DELETE', {}, newKey()); await del(cacheKey.current).catch(() => undefined);
        dirty.current = false; metaDirty.current = false; router.push('/projects'); return;
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
        const copy = await request<{ id: string }>('/api/documents', 'POST', { title: `${draft.title} (${t('pemulihan', 'recovered')})`.slice(0, 180), content: draft.content, language: draft.settings.language, preferences: draft.settings }, newKey());
        await del(cacheKey.current).catch(() => undefined); setRecovery(null); router.push(`/projects/${copy.id}`); return;
      }
      if (mode === 'discard') { await del(cacheKey.current).catch(() => undefined); setRecovery(null); return; }
      editor.commands.setContent(draft.content, { emitUpdate: false }); contentRef.current = draft.content;
      setText(documentText(draft.content)); setTitle(draft.title); setSettings(draft.settings);
      dirty.current = true; stamp.current++; setEditStamp(stamp.current); markMetadata(draft.title, draft.settings); setRecovery(null);
    });
  }

  async function copyAsNew() {
    if (!editor) return;
    await run('copy', async () => {
      const copy = await request<{ id: string }>('/api/documents', 'POST', { title: `${title} (${t('salinan', 'copy')})`.slice(0, 180), content: editor.getJSON(), language: settings.language, preferences: settings }, newKey());
      dirty.current = false; metaDirty.current = false; await del(cacheKey.current).catch(() => undefined); router.push(`/projects/${copy.id}`);
    });
  }

  const updateSettings = (next: Settings) => { setSettings(next); markMetadata(title, next); };

  const lockedSelection = !!selection && terms.some((term) => term.term === selection.text.trim());
  const stale = !!preview && (preview.stamp !== editStamp || (doc !== null && preview.revision !== doc.revision && busy !== 'apply'));
  const scopeText = scope === 'selection' ? selection?.text ?? '' : scope === 'paragraph' ? editor?.state.selection.$from.parent.textContent ?? '' : text;
  const detected = detectLanguage(scopeText || text);
  const compareOptions = useMemo(() => [
    { value: WORKING, label: t('Tulisan saat ini', 'Current draft') },
    ...(preview ? [{ value: SOURCE, label: t('Teks sumber pratinjau', 'Preview source') }, { value: PREVIEW, label: t('Pratinjau AI', 'AI preview') }] : []),
    ...versions.map((version) => ({ value: version.id, label: `${versionLabel(version, t)} · ${dateTime(version.createdAt, locale)}` })),
  ], [preview, versions, t, locale]);

  if (loadError) {
    return (
      <main className="grid flex-1 place-items-center bg-paper px-4">
        <div className="w-full max-w-md"><Alert tone="error" title={t('Dokumen tidak bisa dibuka', 'The document could not be opened')} actions={<><Button size="sm" icon={RefreshCw} onClick={() => window.location.reload()}>{t('Muat ulang', 'Reload')}</Button><Link href="/projects" className={buttonClass('secondary', 'sm')}>{t('Ke daftar proyek', 'Go to projects')}</Link></>}>{loadError}</Alert></div>
      </main>
    );
  }

  const words = countWords(text);
  const closeOnNarrow = () => { if (narrow) setPanelOpen(false); };
  const assistant = (
    <AssistantPanel
      settings={settings} onSettings={updateSettings} scope={scope} onScope={setScope} hasSelection={!!selection} scopeWords={countWords(scopeText)} scopeChars={scopeText.length} detected={detected}
      busy={busy !== '' || !loaded} generating={busy === 'generate'}
      onGenerate={() => void generate({ scope })}
      canGenerate={loaded && !!text.trim() && !recovery && !compare && (scope !== 'selection' || !!selection)}
    >
      {preview && (
        <PreviewCard
          preview={preview} alternative={alternative} onAlternative={setAlternative} stale={stale} busy={busy !== ''} applying={busy === 'apply'}
          onApply={() => void apply()} onCompare={() => { closeOnNarrow(); void openCompare(SOURCE, PREVIEW); }} onDiscard={() => void discard()}
          onRetry={() => void generate(lastRequest ? { ...lastRequest, override: preview.settings, anchor: preview.anchor, pmTo: preview.pmTo } : { scope })} onInsert={insertAlternative}
          onStronger={() => void generate({ scope: preview.scope, anchor: preview.anchor, pmTo: preview.pmTo, inlineAction: preview.inlineAction, override: { ...preview.settings, strength: nextStrength(preview.settings.strength) as Settings['strength'], preservation: preview.settings.strength === 'strong' ? 'flexible' : preview.settings.preservation } })}
          onReduce={() => void generate({ scope: preview.scope, anchor: preview.anchor, pmTo: preview.pmTo, override: { ...preview.settings, strength: lowerStrength(preview.settings.strength) as Settings['strength'], preservation: 'conservative' } })}
        />
      )}
    </AssistantPanel>
  );

  const tabs: Array<{ id: RightTab; icon: LucideIcon; label: string }> = [
    { id: 'assistant', icon: Bot, label: t('Asisten AI', 'AI assistant') }, { id: 'history', icon: History, label: t('Riwayat', 'History') }, { id: 'analytics', icon: ChartNoAxesColumn, label: t('Analisis', 'Analytics') },
  ];
  const activeTab = tabs.find((tab) => tab.id === rightTab) ?? { id: 'assistant', icon: Bot, label: t('Asisten AI', 'AI assistant') };
  const TabIcon = activeTab.icon;
  const rightContent = (
    <section aria-label={activeTab.label} className="flex h-full min-w-0 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
        <TabIcon size={16} className="shrink-0 text-brand-700" aria-hidden="true" />
        <h2 className="flex-1 truncate text-sm font-semibold text-ink-900">{activeTab.label}</h2>
        <IconButton size="sm" icon={narrow ? X : PanelRightClose} label={t('Tutup panel', 'Close panel')} onClick={closeRight} />
      </header>
      <div role="tabpanel" aria-label={activeTab.label} className="min-h-0 flex-1">
        {rightTab === 'assistant' ? assistant : rightTab === 'history' ? (
          <HistoryPanel
            versions={versions} currentRevision={doc?.revision ?? null} originalId={doc?.originalVersionId ?? null} loading={!loaded} hasMore={!!versionCursor} loadingMore={loadingVersions} error={versionsError}
            busy={busy !== ''} canSave={loaded && !frozen} onLoadMore={loadMoreVersions} onRetry={loadMoreVersions} onSave={() => { setField(''); setDialog({ kind: 'checkpoint' }); }} loadText={versionText}
            onCompare={(version) => { closeOnNarrow(); void openCompare(version.id, WORKING); }} onRestore={(version) => setDialog({ kind: 'restore', version })}
            onRename={(version) => { setField(version.label ?? ''); setDialog({ kind: 'rename', version }); }} onDuplicate={(version) => void duplicateVersion(version)}
          />
        ) : (
          <div className="scrollbar-thin h-full overflow-y-auto">
            <AnalyticsPanel text={text} original={original} scopeLabel={selection ? t('teks terpilih', 'selected text') : t('seluruh dokumen', 'entire document')} quality={quality} stale={!!quality && quality.stamp !== editStamp}
              loading={qualityState.loading} error={qualityState.error} onAnalyze={() => void analyze()}
              blockedReason={!loaded ? t('Dokumen masih dimuat.', 'The document is still loading.') : !text.trim() ? t('Dokumen masih kosong.', 'The document is empty.') : (selection?.text ?? text).length > AI_SCOPE_LIMIT ? t('Terlalu panjang untuk dianalisis sekaligus. Blok sebagian teks terlebih dahulu.', 'Too long to analyse at once. Select part of the text first.') : null} />
          </div>
        )}
      </div>
    </section>
  );

  const leftContent = (
    <section aria-label={t('Proyek', 'Project')} className="flex h-full min-w-0 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
        <h2 className="flex-1 truncate text-sm font-semibold text-ink-900">{t('Proyek', 'Project')}</h2>
        <IconButton size="sm" icon={X} label={t('Tutup panel Proyek', 'Close project panel')} onClick={toggleLeft} />
      </header>
      <div className="min-h-0 flex-1">
        <ProjectPanel editor={editor} loaded={loaded} navigable={!compare} text={text} original={original} hasChanges={versions.some((version) => version.kind !== 'original')} terms={terms} busy={busy !== ''}
          onUnlock={(term) => void unlock(term)} onNavigate={() => { if (narrow) setLeftOpen(false); }} />
      </div>
    </section>
  );

  const center = (
    <main className="flex h-full min-w-0 flex-col">
      {compare && (
        <CompareView options={compareOptions} a={compare.a} b={compare.b} before={compare.before} after={compare.after} loading={compare.loading} busy={busy !== ''}
          onChange={(a, b) => void openCompare(a, b)} onExit={exitCompare}
          onRestore={(versionId) => { const version = versions.find((item) => item.id === versionId); if (version) setDialog({ kind: 'restore', version }); }}
          onApplyPreview={preview && [compare.a, compare.b].includes(PREVIEW) && !stale ? () => void apply() : undefined} />
      )}
      <div className={compare ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        {editor && <div className="flex shrink-0 justify-center px-3 pt-3 sm:px-6"><div className="w-full max-w-[816px]"><FormatToolbar editor={editor} disabled={!loaded || frozen || !!recovery} onLink={() => { setField(String(editor.getAttributes('link').href ?? '')); setDialog({ kind: 'link' }); }} /></div></div>}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
          <article className="editor-prose relative mx-auto min-h-full max-w-[816px] rounded-md bg-white px-6 py-10 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-14px_rgb(0_0_0/0.12)] ring-1 ring-line sm:px-16 sm:py-16">
            {!loaded && <LoadingBlock label={t('Memuat dokumen…', 'Loading document…')} />}
            {loaded && !text.trim() && <p aria-hidden="true" className="pointer-events-none absolute left-6 top-10 font-serif text-lg text-ink-300 sm:left-16 sm:top-16">{t('Mulai menulis atau tempel teks di sini…', 'Start writing or paste text here…')}</p>}
            <div className={loaded ? '' : 'hidden'}><EditorContent editor={editor} /></div>
            {editor && loaded && <SelectionMenu editor={editor} locked={lockedSelection} disabled={busy !== ''} chars={selection?.text.length ?? 0} onCommand={selectionCommand} />}
          </article>
        </div>
      </div>
    </main>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper">
      <WorkspaceHeader
        title={title} onTitle={(value) => { setTitle(value); markMetadata(value, settings); }} mode={settings.mode} words={words} save={loaded ? save : 'loading'} disabled={!loaded || frozen} comparing={!!compare}
        leftOpen={leftOpen} rightOpen={panelOpen} onToggleLeft={toggleLeft} onToggleRight={toggleRight} onMode={() => openRight('assistant')}
        onCompare={() => (compare ? exitCompare() : defaultCompare())} onHistory={() => openRight('history')} onAnalytics={() => openRight('analytics')}
        onSaveVersion={() => { setField(''); setDialog({ kind: 'checkpoint' }); }} onDelete={() => setDialog({ kind: 'delete' })}
      />

      {save === 'conflict' && (
        <Toast tone="warning" title={t('Dokumen berubah di tempat lain', 'The document changed elsewhere')} actions={<><Button size="sm" icon={CopyPlus} loading={busy === 'copy'} onClick={() => void copyAsNew()}>{t('Simpan sebagai proyek baru', 'Save as a new project')}</Button><Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setDialog({ kind: 'reload' })}>{t('Muat salinan server', 'Load server copy')}</Button></>}>
          {t('Perubahanmu belum ditimpa dan masih ada di layar ini.', 'Nothing was overwritten; your changes are still on this screen.')}
        </Toast>
      )}
      {notice && <Toast tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')} actions={notice.retrySave ? <Button size="sm" icon={RefreshCw} onClick={() => { setNotice(null); setSave('dirty'); void flush().catch(() => undefined); }}>{t('Coba simpan lagi', 'Retry saving')}</Button> : undefined}>{notice.message}</Toast>}
      {aiError && busy !== 'generate' && <Toast tone="error" onDismiss={() => setAiError('')} dismissLabel={t('Tutup', 'Dismiss')} actions={<Button size="sm" icon={RefreshCw} onClick={() => void generate(lastRequest ?? { scope })}>{t('Coba lagi', 'Retry')}</Button>}>{aiError}</Toast>}

      {narrow ? (
        <div className="flex min-h-0 flex-1">{center}</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <Group orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged} className="min-w-0 flex-1">
            <Panel id="project" panelRef={leftPanel} defaultSize="20%" minSize="14%" maxSize="28%" collapsible collapsedSize="40px" onResize={(size) => setLeftOpen(size.inPixels > 48)}>
              {leftOpen ? leftContent : (
                <div className="flex h-full flex-col items-center bg-white py-2">
                  <IconButton size="sm" icon={PanelLeftOpen} label={t('Buka panel Proyek', 'Open project panel')} onClick={toggleLeft} />
                </div>
              )}
            </Panel>
            <Separator aria-label={t('Ubah lebar panel Proyek', 'Resize project panel')} className={separatorClass} />
            <Panel id="canvas" minSize="40%">{center}</Panel>
            <Separator aria-label={t('Ubah lebar panel Asisten', 'Resize assistant panel')} className={separatorClass} />
            <Panel id="assistant" panelRef={rightPanel} defaultSize="28%" minSize="22%" maxSize="40%" collapsible collapsedSize="0%" onResize={(size) => setPanelOpen(size.inPixels > 1)}>
              {panelOpen && rightContent}
            </Panel>
          </Group>
          <TabStrip tabs={tabs} active={rightTab} open={panelOpen} onPick={pickTab} />
        </div>
      )}

      {narrow && leftOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-ink-900/30" aria-hidden="true" onClick={() => setLeftOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-full max-w-xs border-r border-line bg-white shadow-2xl">{leftContent}</aside>
        </>
      )}
      {narrow && panelOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-ink-900/30" aria-hidden="true" onClick={() => setPanelOpen(false)} />
          <aside aria-label={activeTab.label} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md bg-white shadow-2xl animate-slide-in">
            <div className="min-w-0 flex-1">{rightContent}</div>
            <TabStrip tabs={tabs} active={rightTab} open={panelOpen} onPick={pickTab} />
          </aside>
        </>
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
      {dialog?.kind === 'link' && (
        <ConfirmDialog title={t('Atur tautan', 'Edit link')} description={t('Kosongkan untuk menghapus tautan.', 'Leave empty to remove the link.')} confirmLabel={t('Terapkan', 'Apply')} busy={busy === 'link'} disabled={!!field.trim() && !/^https?:\/\/\S+$/i.test(field.trim())} onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <input autoFocus type="url" aria-label="URL" className={inputClass} value={field} maxLength={2048} onChange={(event) => setField(event.target.value)} placeholder="https://" />
          {field.trim() && !/^https?:\/\/\S+$/i.test(field.trim()) && <p className="mt-1.5 text-xs text-red-600">{t('Tautan harus diawali https:// atau http://', 'Links must start with https:// or http://')}</p>}
        </ConfirmDialog>
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog title={t('Hapus dokumen ini?', 'Delete this document?')} tone="danger" confirmLabel={t('Hapus permanen', 'Delete permanently')} busy={busy === 'delete'} onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <p>{t('Dokumen, semua versi, dan pratinjaunya akan dihapus. Tindakan ini tidak bisa dibatalkan.', 'The document, all versions, and previews will be deleted. This cannot be undone.')}</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'reload' && (
        <ConfirmDialog title={t('Muat salinan server?', 'Load the server copy?')} confirmLabel={t('Muat ulang', 'Reload')} tone="danger" onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()}>
          <p>{localDrafts.current ? t('Tulisanmu di layar ini tersimpan sebagai salinan pemulihan dan akan ditawarkan setelah dimuat ulang.', 'Your on-screen text is kept as a recovery copy and will be offered after reloading.') : t('Salinan pemulihan lokal nonaktif. Perubahan yang belum tersimpan akan hilang.', 'Local recovery is off. Unsaved changes will be lost.')}</p>
        </ConfirmDialog>
      )}
      {recovery && (
        <Modal title={t('Ada tulisan yang belum tersimpan', 'Unsaved writing found')} description={`${t('Dari perangkat ini', 'From this device')} · ${dateTime(recovery.updatedAt, locale)}`} busy={busy === 'recover'} dismissible={false} onClose={() => undefined} size="lg"
          footer={<>
            <Button disabled={busy === 'recover'} onClick={() => void recover('discard')}>{t('Pakai salinan server', 'Use server copy')}</Button>
            <Button disabled={busy === 'recover'} icon={CopyPlus} onClick={() => void recover('copy')}>{t('Simpan sebagai dokumen baru', 'Save as new document')}</Button>
            {recovery.revision === doc?.revision && <Button variant="primary" loading={busy === 'recover'} onClick={() => void recover('continue')}>{t('Lanjutkan tulisan ini', 'Continue this draft')}</Button>}
          </>}>
          <p className="mb-3">{t('Periksa isinya sebelum memilih. "Pakai salinan server" akan membuang salinan lokal ini.', 'Review it before choosing. "Use server copy" discards this local copy.')}</p>
          <div className="scrollbar-thin max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-paper px-4 py-3 font-serif text-[15px] leading-relaxed text-ink-900">{documentText(recovery.content)}</div>
        </Modal>
      )}
    </div>
  );
}
