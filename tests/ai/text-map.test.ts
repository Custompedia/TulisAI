import { describe, expect, it } from 'vitest';
import { documentSchema } from '../../src/lib/editor/extensions';
import { documentText, protectedRanges, selectionOffsets } from '../../src/lib/editor/document';
import { docCounts, docText, plainOffset, protectedRangesIn, selectionOffsetsIn, topBlocks } from '../../src/lib/editor/text-map';
import { jsonDocumentText, jsonDocumentTextLength, schemaProblem } from '../../src/lib/editor/validate';
import { countCharacters, countWords } from '../../src/lib/editor/metrics';
import { editorDocumentProblem, EditorDocumentSchema, type EditorDocument } from '../../src/lib/contracts';
import { changedTopRange } from '../../src/lib/editor/changed-range';

// The editor no longer serializes the document to measure it: these hold the cached, block-by-block text map to
// exactly the answers of documentText / selectionOffsets / protectedRanges, on documents with every kind of node.
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const SAMPLE = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Bab Satu')] },
    para(text('Menurut (Davis, 1989) model '), text('TAM', [{ type: 'bold' }]), { type: 'hardBreak' }, text('baris dua'), { type: 'footnote', attrs: { text: 'Catatan' } }),
    { type: 'pageBreak' },
    para(),
    para({ type: 'imageSpace', attrs: { width: 100, height: 40, wrap: 'block' } }, text('di bawah gambar')),
    { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('butir satu'))] }, { type: 'listItem', content: [para(text('butir dua')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('anak'))] }] }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [para(text('A'))] }, { type: 'tableHeader', content: [para(text('B'))] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [para(text('1'))] }, { type: 'tableCell', content: [para()] }] }] },
    { type: 'horizontalRule' },
    { type: 'blockquote', content: [para(text('kutipan Davis (1989) panjang'))] },
    para(text('akhir 😀 dokumen')),
  ],
};

describe('text map', () => {
  const json = EditorDocumentSchema.parse(structuredClone(SAMPLE));
  const doc = documentSchema.nodeFromJSON(json);

  it('flattens exactly like documentText, from ProseMirror and from JSON', () => {
    const expected = documentText(json);
    expect(docText(doc)).toBe(expected);
    expect(jsonDocumentText(json)).toBe(expected);
    expect(jsonDocumentTextLength(json)).toBe(expected.length);
    expect(docCounts(doc)).toEqual({ words: countWords(expected), characters: countCharacters(expected) });
  });

  it('maps every document position to the same plain offset as selectionOffsets', () => {
    for (let from = 0; from <= doc.content.size; from++) {
      expect(plainOffset(doc, from), `position ${from}`).toBe(selectionOffsets(json, from, from).from);
    }
    expect(selectionOffsetsIn(doc, 3, 40)).toEqual(selectionOffsets(json, 3, 40));
    expect(() => selectionOffsetsIn(doc, 5, 2)).toThrow();
  });

  it('finds protected terms at the same document ranges as protectedRanges', () => {
    const terms = ['Davis', 'TAM', 'baris', '(Davis, 1989)', 'butir', 'dua', 'tidak ada'];
    expect(protectedRangesIn(doc, terms)).toEqual(protectedRanges(json, terms));
  });

  it('reuses block results between versions and lists top-level blocks with their words', () => {
    const blocks = topBlocks(doc);
    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'Bab Satu', words: 2, level: 1 });
    expect(topBlocks(doc)).toBe(blocks);
    const edited = doc.replace(doc.content.size - 2, doc.content.size - 1, doc.slice(0, 0));
    expect(docText(edited)).toBe(documentText(edited.toJSON()));
    const changed = changedTopRange(doc, edited);
    expect(changed).toMatchObject({ fromIndex: doc.childCount - 1, toIndex: doc.childCount - 1, removed: 1 });
    expect(changedTopRange(doc, doc)).toBeNull();
  });
});

describe('stored-document checks without Zod or ProseMirror nodes', () => {
  const check = (value: unknown) => { const copy = structuredClone(value); const contract = editorDocumentProblem(copy); return contract ?? schemaProblem(copy as EditorDocument); };
  const prosemirror = (value: unknown) => { try { const parsed = EditorDocumentSchema.parse(structuredClone(value)); if (!parsed.content.length) return null; documentSchema.nodeFromJSON(parsed).check(); return null; } catch (error) { return String(error); } };

  it('agrees with ProseMirror on valid and invalid documents', () => {
    const cases: unknown[] = [
      SAMPLE,
      { type: 'doc', content: [] },
      { type: 'doc', content: [text('loose text')] },
      { type: 'doc', content: [para(para(text('nested')))] },
      { type: 'doc', content: [{ type: 'bulletList', content: [para(text('not an item'))] }] },
      { type: 'doc', content: [{ type: 'listItem', content: [para(text('item at top'))] }] },
      { type: 'doc', content: [para(text(''))] },
      { type: 'doc', content: [para(text('x', [{ type: 'bold' }, { type: 'bold' }]))] },
      { type: 'doc', content: [para(text('x', [{ type: 'subscript' }, { type: 'superscript' }]))] },
      { type: 'doc', content: [{ type: 'table', content: [] }] },
      { type: 'doc', content: [{ type: 'pageBreak', content: [para()] }] },
      { type: 'doc', content: [para({ type: 'imageSpace', attrs: { width: 10, height: 10 } })] },
      { type: 'doc', content: [{ type: 'imageSpace', attrs: { width: 10, height: 10 } }] },
    ];
    for (const value of cases) expect(check(value) === null, JSON.stringify(value).slice(0, 80)).toBe(prosemirror(value) === null);
  });

  it('keeps the old contract rules: strict keys, known types, bounded attributes, HTTP links only', () => {
    expect(editorDocumentProblem({ type: 'doc', content: [{ type: 'paragraph', extra: 1 }] })).toMatch(/Unknown node field/);
    expect(editorDocumentProblem({ type: 'doc', content: [{ type: 'image' }] })).toMatch(/Unknown node type/);
    expect(editorDocumentProblem({ type: 'doc', content: [para(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))] })).toMatch(/HTTP/);
    expect(editorDocumentProblem({ type: 'doc', content: [{ type: 'paragraph', attrs: { lineHeight: 'x'.repeat(2049) } }] })).toMatch(/2,048/);
    expect(editorDocumentProblem({ type: 'doc', content: [{ type: 'paragraph', text: 'no' }] })).toMatch(/Only text nodes/);
    expect(editorDocumentProblem({ type: 'doc', content: [{ type: 'text' }] })).toMatch(/require text/);
    // Null attributes are dropped in place, like the old preprocess did.
    const value = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null, lineHeight: '2' } }, { type: 'paragraph', attrs: { textAlign: null } }] };
    expect(editorDocumentProblem(value)).toBeNull();
    expect(value.content).toEqual([{ type: 'paragraph', attrs: { lineHeight: '2' } }, { type: 'paragraph' }]);
  });
});
