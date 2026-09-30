import { describe, expect, it } from 'vitest';
import { DocumentCreateSchema, EditorDocumentSchema } from '@/lib/contracts';
import { documentText } from '@/lib/editor/document';
import { ADVANCED_PREFERENCE, PAGE_LAYOUT_PREFERENCES } from '@/lib/plans';
import { DEFAULT_ACTIONS, DOC_TYPES, defaultTitle, docTypeSettings, isSpoken, orderActions, orderModes, skeletonDocument, skeletonOrder } from '@/lib/writing/doc-types';
import { newNotebookBody } from '@/lib/writing/new-notebook';
import { copyPreferences, storedParts } from '@/lib/writing/notebook-meta';
import { MODES } from '@/components/writing/modes';

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
  const stored = { mode: 'academic', styleId: 'skill-1', pageSize: 'letter', pageMargins: '1440,1440,1440,1440', advanced: true, docType: 'essay', briefCta: 'Daftar', notes: 'x'.repeat(900), unknown: 'dropped' };

  it('keeps settings and notebook facts but leaves out what create would refuse', () => {
    const free = copyPreferences(storedParts(stored), { advancedNotebook: false, savedStyles: false });
    for (const key of [ADVANCED_PREFERENCE, ...PAGE_LAYOUT_PREFERENCES]) expect(Object.hasOwn(free, key), key).toBe(false);
    expect(free).toMatchObject({ mode: 'academic', styleId: null, docType: 'essay', briefCta: 'Daftar', docSource: 'copy' });
    expect((free.notes as string).length).toBe(500);
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
