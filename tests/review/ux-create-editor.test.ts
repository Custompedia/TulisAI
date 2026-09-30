import { describe, expect, it } from 'vitest';
import { DocumentCreateSchema, EditorDocumentSchema } from '@/lib/contracts';
import { documentText } from '@/lib/editor/document';
import { ADVANCED_PREFERENCE, PAGE_LAYOUT_PREFERENCES } from '@/lib/plans';
import { DEFAULT_ACTIONS, DOC_TYPES, defaultTitle, docTypeSettings, isSpoken, orderActions, orderModes, skeletonDocument, skeletonOrder } from '@/lib/writing/doc-types';
import { newNotebookBody } from '@/lib/writing/new-notebook';
import { BRIEF_VALUE_LIMIT, copyPreferences, storedParts } from '@/lib/writing/notebook-meta';
import { MODES } from '@/components/writing/modes';
import { documentSchema } from '@/lib/editor/extensions';
import { formatDuration, readingMinutes, speakingSeconds, SPEAKING_WPM } from '@/lib/editor/metrics';
import { docPanelCookie, docPanelState, parseDocPanelCookie } from '@/lib/navigation/doc-panel';
import { customConflict, defaults, normalizeSettings, runtimeControls } from '@/lib/writing/settings';
import { compareDefault, hasStructure, meaningfulOriginal, outlineSections, shouldDiscard } from '@/components/workspace/editor-rules';
import { QUICK_ACTIONS, quickActionLabel, quickActionOverride, type QuickAction } from '@/components/workspace/selection-commands';
import { WORKING, type Version } from '@/components/workspace/types';

const context = { defaultMode: 'P03_HUMANIZER', writingLanguage: 'auto' as const, humanizerContext: 'general', locale: 'id' as const, advancedNotebook: false, now: new Date(2026, 9, 1) };

describe('skeletons', () => {
  it('builds a valid outline for every kind, in the notebook language, with no body text to discard', () => {
    for (const type of DOC_TYPES) {
      const doc = EditorDocumentSchema.parse(skeletonDocument(type, 'id'));
      const headings = doc.content.filter((node) => node.type === 'heading');
      expect(headings.length, type).toBeGreaterThanOrEqual(4);
      // Headings only: each is followed by an empty paragraph to write in.
      expect(doc.content.filter((node) => node.type === 'paragraph').every((node) => !node.content?.length), type).toBe(true);
    }
    expect(documentText(skeletonDocument('script', 'id'))).toContain('Hook (0–3 detik)');
    expect(documentText(skeletonDocument('script', 'en'))).toContain('Hook (0–3 seconds)');
    expect(documentText(skeletonDocument('essay', 'id'))).toContain('Daftar Pustaka');
  });

  it('starts each kind in the mode the plan gives it', () => {
    expect(docTypeSettings('article')).toMatchObject({ mode: 'standard', strength: 'balanced' });
    expect(docTypeSettings('script').mode).toBe('creative');
    expect(docTypeSettings('caption')).toMatchObject({ mode: 'creative', strength: 'light' });
    expect(docTypeSettings('essay')).toMatchObject({ mode: 'academic', academic: 'thesis' });
    expect(docTypeSettings('report')).toMatchObject({ mode: 'professional', recipient: 'atasan' });
    expect(docTypeSettings('email').mode).toBe('professional');
    expect(docTypeSettings('product').mode).toBe('creative');
    expect(docTypeSettings('story').mode).toBe('creative');
  });

  it('names a new notebook "Artikel · 1 Okt"', () => {
    expect(defaultTitle('article', new Date(2026, 9, 1), 'id')).toBe('Artikel · 1 Okt');
    expect(defaultTitle('script', new Date(2026, 4, 17), 'id')).toBe('Script · 17 Mei');
    expect(defaultTitle(null, new Date(2026, 11, 31), 'id')).toBe('Notebook · 31 Des');
    expect(defaultTitle('essay', new Date(2026, 9, 1), 'en')).toBe('Essay · 1 Oct');
  });

  it('orders Beranda chips by the onboarding answer, keeping every kind', () => {
    expect(skeletonOrder('academic')[0]).toBe('essay');
    expect(skeletonOrder('professional')[0]).toBe('email');
    expect(skeletonOrder('general').slice(0, 2)).toEqual(['article', 'script']);
    for (const useCase of ['academic', 'professional', 'general', null]) expect([...skeletonOrder(useCase)].sort()).toEqual([...DOC_TYPES].sort());
  });

  it('moves recommended modes and selection actions forward without dropping any', () => {
    expect(orderModes(MODES, 'essay')[0]).toBe('academic');
    expect([...orderModes(MODES, 'essay')].sort()).toEqual([...MODES].sort());
    expect(orderModes(MODES, null)).toEqual(MODES);
    expect(orderActions('caption')[0]).toBe('shorter');
    expect(orderActions('nonsense')).toEqual(DEFAULT_ACTIONS);
    for (const type of DOC_TYPES) expect([...orderActions(type)].sort()).toEqual([...DEFAULT_ACTIONS].sort());
    expect(isSpoken('script')).toBe(true); expect(isSpoken('caption')).toBe(true); expect(isSpoken('essay')).toBe(false); expect(isSpoken(undefined)).toBe(false);
  });
});

describe('new notebook body', () => {
  it('sends a skeleton with its kind and mode, marked as a skeleton', () => {
    const body = newNotebookBody('essay', {}, context);
    expect(body.title).toBe('Esai · 1 Okt');
    expect(body.preferences).toMatchObject({ mode: 'academic', docType: 'essay', docSource: 'skeleton' });
    expect(() => DocumentCreateSchema.parse(body)).not.toThrow();
    const blank = newNotebookBody('blank', { title: '  Catatan rapat ' }, context);
    expect(blank.title).toBe('Catatan rapat');
    expect(blank.preferences).toMatchObject({ mode: 'humanize', docSource: 'blank' });
    expect(Object.hasOwn(blank.preferences, 'docType')).toBe(false);
  });

  it('only asks for the Halaman canvas when the account has it', () => {
    expect(Object.hasOwn(newNotebookBody('report', { paged: true }, context).preferences, ADVANCED_PREFERENCE)).toBe(false);
    expect(newNotebookBody('report', { paged: true }, { ...context, advancedNotebook: true }).preferences[ADVANCED_PREFERENCE]).toBe(true);
    for (const key of PAGE_LAYOUT_PREFERENCES) expect(Object.hasOwn(newNotebookBody('report', { paged: true }, { ...context, advancedNotebook: true }).preferences, key)).toBe(false);
  });

  it('writes the outline in the chosen language, or the interface language on Auto', () => {
    expect(documentText(newNotebookBody('email', { language: 'en' }, context).content)).toContain('Greeting');
    expect(documentText(newNotebookBody('email', {}, context).content)).toContain('Salam');
    expect(documentText(newNotebookBody('email', {}, { ...context, locale: 'en' }).content)).toContain('Greeting');
  });
});

describe('duplicating from the library', () => {
  const stored = { mode: 'academic', styleId: 'skill-1', pageSize: 'letter', pageMargins: '1440,1440,1440,1440', advanced: true, docType: 'essay', briefCta: 'Daftar', notes: 'x'.repeat(2500), unknown: 'dropped' };

  it('keeps settings and notebook facts but leaves out what create would refuse', () => {
    const free = copyPreferences(storedParts(stored), { advancedNotebook: false, savedStyles: false });
    for (const key of [ADVANCED_PREFERENCE, ...PAGE_LAYOUT_PREFERENCES]) expect(Object.hasOwn(free, key), key).toBe(false);
    expect(free).toMatchObject({ mode: 'academic', styleId: null, docType: 'essay', briefCta: 'Daftar', docSource: 'copy' });
    expect((free.notes as string).length).toBe(BRIEF_VALUE_LIMIT);
    expect(Object.hasOwn(free, 'unknown')).toBe(false);
    expect(() => DocumentCreateSchema.parse({ title: 'Salinan', preferences: free })).not.toThrow();
  });

  it('keeps the stored layout and canvas for an account with advanced_notebook', () => {
    const pro = copyPreferences(storedParts(stored), { advancedNotebook: true, savedStyles: true });
    expect(pro).toMatchObject({ advanced: true, pageSize: 'letter', pageMargins: '1440,1440,1440,1440', styleId: 'skill-1' });
    // Only the layout keys the notebook actually stored: no defaults are invented for the copy.
    expect(Object.hasOwn(pro, 'headerText')).toBe(false);
  });
});

describe('editor rules', () => {
  const version = (id: string, kind: Version['kind'], createdAt: string): Version => ({ id, kind, label: null, revision: 0, createdAt });
  const original = version('orig', 'original', '2026-10-01T08:00:00Z');

  it('hides the Original comparison for skeleton and blank notebooks', () => {
    expect(meaningfulOriginal('Teks lama yang ditempel.', 'compose')).toBe(true);
    expect(meaningfulOriginal('Teks lama yang ditempel.', undefined)).toBe(true);
    expect(meaningfulOriginal('Pembuka\n\nPenutup', 'skeleton')).toBe(false);
    expect(meaningfulOriginal('', 'compose')).toBe(false);
    expect(meaningfulOriginal('   ', undefined)).toBe(false);
    expect(meaningfulOriginal(null, 'compose')).toBe(false);
  });

  it('compares with the Original when it means something, else the latest version, else nothing', () => {
    const later = [version('ai', 'ai_apply', '2026-10-01T09:00:00Z'), version('cp', 'checkpoint', '2026-10-01T10:00:00Z'), original];
    expect(compareDefault(later, 'orig', true)).toEqual({ a: 'orig', b: WORKING });
    expect(compareDefault(later, 'orig', false)).toEqual({ a: 'cp', b: WORKING });
    expect(compareDefault([original], 'orig', false)).toBeNull();
    expect(compareDefault([], null, false)).toBeNull();
    // The Original id is found from the list when the document does not name it.
    expect(compareDefault([original], null, true)).toEqual({ a: 'orig', b: WORKING });
  });

  it('discards only a skeleton or blank notebook that was never touched', () => {
    const outline = 'Pembuka\n\nPenutup\n';
    expect(shouldDiscard({ source: 'skeleton', revision: 0, dirty: false, text: outline, original: outline })).toBe(true);
    expect(shouldDiscard({ source: 'blank', revision: 0, dirty: false, text: '\n', original: '' })).toBe(true);
    expect(shouldDiscard({ source: 'skeleton', revision: 1, dirty: false, text: outline, original: outline })).toBe(false);
    expect(shouldDiscard({ source: 'skeleton', revision: 0, dirty: true, text: outline, original: outline })).toBe(false);
    expect(shouldDiscard({ source: 'skeleton', revision: 0, dirty: false, text: `${outline}Isi`, original: outline })).toBe(false);
    expect(shouldDiscard({ source: 'blank', revision: 0, dirty: false, text: 'Isi', original: '' })).toBe(false);
    expect(shouldDiscard({ source: 'compose', revision: 0, dirty: false, text: '', original: '' })).toBe(false);
    expect(shouldDiscard({ source: 'copy', revision: 0, dirty: false, text: outline, original: outline })).toBe(false);
    expect(shouldDiscard({ source: undefined, revision: 0, dirty: false, text: '', original: '' })).toBe(false);
    expect(shouldDiscard({ source: 'skeleton', revision: null, dirty: false, text: outline, original: outline })).toBe(false);
  });

  it('warns about structure a whole-document run would flatten', () => {
    expect(hasStructure(documentSchema.nodeFromJSON(skeletonDocument('essay', 'id')))).toBe(true);
    expect(hasStructure(documentSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Teks biasa' }] }] }))).toBe(false);
    expect(hasStructure(null)).toBe(false);
  });

  it('counts the words under each heading, nested sections included in their parent', () => {
    const sections = outlineSections([
      { type: 'heading', level: 1, text: 'Bab I', pos: 0, size: 7 },
      { type: 'paragraph', text: 'satu dua tiga', pos: 7, size: 15 },
      { type: 'heading', level: 2, text: 'Latar', pos: 22, size: 7 },
      { type: 'paragraph', text: 'empat lima', pos: 29, size: 12 },
      { type: 'heading', level: 1, text: 'Bab II', pos: 41, size: 8 },
      { type: 'paragraph', text: '', pos: 49, size: 2 },
      { type: 'heading', level: 2, text: '  ', pos: 51, size: 4 },
    ]);
    expect(sections.map(({ text, words, pos, end }) => ({ text, words, pos, end }))).toEqual([
      { text: 'Bab I', words: 5, pos: 0, end: 41 },
      { text: 'Latar', words: 2, pos: 22, end: 41 },
      { text: 'Bab II', words: 0, pos: 41, end: 55 },
    ]);
  });
});

describe('quick actions run as a one-off override', () => {
  const base = normalizeSettings({ ...defaults, mode: 'academic', styleId: 'skill', sample: 'contoh', extra: 'catatan', focus: ['clarity'], customized: false });

  it('keeps the mode, drops the skill, and sends its own format and length for this run only', () => {
    const expected: Record<QuickAction, [string, string]> = { summarize: ['short_summary', 'same'], expand: ['paragraph', 'more_detailed'], bullets: ['bullets', 'same'], table: ['table', 'same'] };
    for (const action of QUICK_ACTIONS) {
      const override = quickActionOverride(action, base);
      expect(override).toMatchObject({ mode: 'academic', customized: true, styleId: null, sample: '', extra: '', focus: [], format: expected[action][0], length: expected[action][1] });
      // The Sesuaikan block travels with the run even below Max: runtimeControls sends it because customized is set.
      expect(runtimeControls(override, 'id').custom_request).toMatchObject({ format: expected[action][0], length: expected[action][1] });
      expect(customConflict(override, [])).toBeNull();
    }
    expect(base.customized).toBe(false);
  });

  it('labels each action', () => {
    expect(QUICK_ACTIONS.map((action) => quickActionLabel(action, (id) => id))).toEqual(['Ringkas', 'Perluas', 'Jadikan poin', 'Jadikan tabel']);
  });

  it('asks the backend for 3 or 5 inline alternatives, nothing else', () => {
    expect(runtimeControls(base, 'id', 'alternatives', 5)).toEqual({ language: 'id', action: 'alternatives', n: 5 });
    expect(runtimeControls(base, 'id', 'shorter', 3)).toEqual({ language: 'id', action: 'shorter', n: 3 });
    expect(runtimeControls(base, 'id', 'alternatives')).toEqual({ language: 'id', action: 'alternatives' });
    expect(runtimeControls(base, 'id', 'alternatives', 9)).toEqual({ language: 'id', action: 'alternatives' });
  });
});

describe('reading and speaking time', () => {
  const words = (count: number) => Array.from({ length: count }, () => 'kata').join(' ');
  it('reads at 200 words a minute and speaks at 130', () => {
    expect(readingMinutes(words(200))).toBe(1);
    expect(readingMinutes(words(201))).toBe(2);
    expect(speakingSeconds('')).toBe(0);
    expect(speakingSeconds(words(130))).toBe(60);
    expect(speakingSeconds(words(65))).toBe(30);
    expect(speakingSeconds('satu')).toBe(Math.max(1, Math.round(60 / SPEAKING_WPM)));
  });
  it('formats short durations for the status bar', () => {
    const id = (value: string) => value;
    expect(formatDuration(45, id)).toBe('45 dtk');
    expect(formatDuration(80, id)).toBe('1 mnt 20 dtk');
    expect(formatDuration(180, id)).toBe('3 mnt');
    expect(formatDuration(80, (_, en) => en)).toBe('1 min 20 s');
  });
});

describe('Dokumen panel cookie', () => {
  it('keeps its own cookie, 190–360px, and lets the viewport decide until the writer chooses', () => {
    expect(parseDocPanelCookie(undefined)).toBeNull();
    expect(parseDocPanelCookie('300:1')).toEqual({ width: 300, collapsed: true });
    expect(parseDocPanelCookie('400:0')).toEqual({ width: 260, collapsed: false });
    expect(docPanelCookie({ width: 500, collapsed: false })).toMatch(/^tulis_doc_panel=360:0; Path=\/;/);
    expect(docPanelState(null, 1366)).toEqual({ width: 260, collapsed: true });
    expect(docPanelState(null, 1440)).toEqual({ width: 260, collapsed: false });
    expect(docPanelState({ width: 220, collapsed: false }, 1024)).toEqual({ width: 220, collapsed: false });
  });
});
