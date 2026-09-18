import { describe, expect, it } from "vitest";
import { documentText, plainTextDocument, replaceTextInDocument, selectionOffsets } from "../../src/lib/editor/document";
import { EditorDocumentSchema } from "../../src/lib/contracts";
import { documentSchema } from "../../src/lib/editor/extensions";

describe("editor document serialization", () => {
  it("serializes blocks, adjacent marks, unicode, lists and tables deterministically", () => {
    const doc = { type: "doc" as const, content: [
      { type: "paragraph" as const, content: [{ type: "text" as const, text: "Halo ", marks: [{ type: "bold" as const }] }, { type: "text" as const, text: "dunia 🌏" }] },
      { type: "bulletList" as const, content: [{ type: "listItem" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Satu" }] }] }, { type: "listItem" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Dua" }] }] }] },
      { type: "table" as const, content: [{ type: "tableRow" as const, content: [{ type: "tableCell" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "A" }] }] }, { type: "tableCell" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "B" }] }] }] }] },
    ] };
    expect(documentText(doc)).toBe("Halo dunia 🌏\nSatu\nDua\nA | B");
  });
  it("maps ProseMirror text positions to plain offsets", () => {
    const doc = plainTextDocument("Pertama\n\nKedua");
    expect(selectionOffsets(doc, 1, 8)).toEqual({ from: 0, to: 7 });
    expect(selectionOffsets(doc, 10, 15)).toEqual({ from: 8, to: 12 });
  });
  it("replaces local text while retaining unaffected marks", () => {
    const doc = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Satu ", marks: [{ type: "bold" as const }] }, { type: "text" as const, text: "lama" }, { type: "text" as const, text: " 🌏" }] }] };
    const result = replaceTextInDocument(doc, 5, 9, "baru");
    expect(documentText(result)).toBe("Satu baru 🌏");
    expect(result.content[0]?.content?.[0]).toMatchObject({ text: "Satu ", marks: [{ type: "bold" }] });
  });
  it("replaces across paragraphs without losing surrounding text", () => {
    const doc = plainTextDocument("Satu paragraf\n\nKedua paragraf");
    const result = replaceTextInDocument(doc, 5, 20, "teks baru");
    expect(documentText(result)).toBe("Satu teks baru paragraf");
  });
  it("retains marks outside a cross-paragraph selection", () => {
    const doc = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Awal ", marks: [{ type: "bold" as const }] }, { type: "text" as const, text: "hapus" }] }, { type: "paragraph" as const, content: [{ type: "text" as const, text: "target " }, { type: "text" as const, text: "akhir", marks: [{ type: "italic" as const }] }] }] };
    const result = replaceTextInDocument(doc, 5, 14, "baru");
    expect(documentText(result)).toBe("Awal baruget akhir");
    expect(result.content[0]?.content?.[0]).toMatchObject({ text: "Awal ", marks: [{ type: "bold" }] });
    expect(JSON.stringify(result)).toContain('"text":"akhir"');
    expect(JSON.stringify(result)).toContain('"type":"italic"');
  });
  it("parses explicit output formats", () => {
    expect(documentText(replaceTextInDocument(plainTextDocument("old"), 0, 3, "Satu\nDua", "bullets"))).toBe("Satu\nDua");
    expect(documentText(replaceTextInDocument(plainTextDocument("old"), 0, 3, "A | B", "table"))).toBe("A | B");
    const scoped = replaceTextInDocument(plainTextDocument("Awal\n\nold\n\nAkhir"), 6, 9, "- Satu\n- Dua", "bullets");
    expect(documentText(scoped)).toBe("Awal\n\nSatu\nDua\n\nAkhir");
    const table = replaceTextInDocument(plainTextDocument("old"), 0, 3, "| A | B |\n|---|---|\n| 1 | 2 |", "table");
    expect(documentText(table)).toBe("A | B\n1 | 2");
  });
  it("maps list and table separators to plain offsets", () => {
    const list = { type: "doc" as const, content: [{ type: "bulletList" as const, content: [{ type: "listItem" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Satu" }] }] }, { type: "listItem" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Dua" }] }] }] }] };
    expect(documentText(list)).toBe("Satu\nDua");
    expect(selectionOffsets(list, 11, 14)).toEqual({ from: 5, to: 8 });
    const table = { type: "doc" as const, content: [{ type: "table" as const, content: [{ type: "tableRow" as const, content: [{ type: "tableCell" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "A" }] }] }, { type: "tableCell" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "B" }] }] }] }] }] };
    expect(selectionOffsets(table, 9, 10)).toEqual({ from: 4, to: 5 });
  });
  it("preserves heading and link marks outside a multiline replacement", () => {
    const doc = { type: "doc" as const, content: [{ type: "heading" as const, attrs: { level: 2 }, content: [{ type: "text" as const, text: "Judul", marks: [{ type: "bold" as const }] }] }, { type: "paragraph" as const, content: [{ type: "text" as const, text: "Baca " }, { type: "text" as const, text: "tautan", marks: [{ type: "link" as const, attrs: { href: "https://example.com" } }] }] }, { type: "paragraph" as const, content: [{ type: "text" as const, text: "lama\nbaris" }] }] };
    const result = replaceTextInDocument(doc, 18, 28, "baru\nlebih baru");
    expect(documentText(result)).toBe("Judul\nBaca tautan\nbaru\nlebih baru");
    expect(result.content[0]).toEqual(doc.content[0]);
    expect(JSON.stringify(result.content[1])).toContain('"href":"https://example.com"');
  });
  it("maps empty paragraph cursors to the paragraph boundary", () => {
    const doc = plainTextDocument("Atas\n\nBawah");
    expect(selectionOffsets(doc, 6, 6)).toEqual({ from: 5, to: 5 });
  });
  it("keeps headings when a later scope is formatted", () => {
    const doc = { type: "doc" as const, content: [{ type: "heading" as const, attrs: { level: 1 }, content: [{ type: "text" as const, text: "Tetap" }] }, { type: "paragraph" as const, content: [{ type: "text" as const, text: "ubah" }] }] };
    const result = replaceTextInDocument(doc, 6, 10, "- satu\n- dua", "bullets");
    expect(documentText(result)).toBe("Tetap\nsatu\ndua");
    expect(result.content[0]).toEqual(doc.content[0]);
  });
});

// The formatting toolbar may only offer what the document schema can actually store and the DOCX writer can
// carry. A control for something outside this set would silently lose the writer's work on save.
describe('formatting the toolbar is allowed to offer', () => {
  const parse = (node: unknown) => EditorDocumentSchema.parse({ type: 'doc', content: [node] });
  const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });

  it('accepts every block the toolbar can insert', () => {
    for (const level of [1, 2, 3]) expect(() => parse({ type: 'heading', attrs: { level }, content: [text('Judul')] })).not.toThrow();
    expect(() => parse({ type: 'blockquote', content: [{ type: 'paragraph', content: [text('Kutipan')] }] })).not.toThrow();
    expect(() => parse({ type: 'horizontalRule' })).not.toThrow();
    expect(() => parse({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('a')] }] }] })).not.toThrow();
    expect(() => parse({ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('a')] }] }] })).not.toThrow();
    expect(() => parse({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [text('h')] }] }] }] })).not.toThrow();
  });

  it('accepts every mark and alignment the toolbar can apply', () => {
    for (const type of ['bold', 'italic', 'underline']) expect(() => parse({ type: 'paragraph', content: [text('x', [{ type }])] })).not.toThrow();
    expect(() => parse({ type: 'paragraph', content: [text('x', [{ type: 'link', attrs: { href: 'https://example.test' } }])] })).not.toThrow();
    for (const textAlign of ['left', 'center', 'right', 'justify']) expect(() => parse({ type: 'paragraph', attrs: { textAlign }, content: [text('x')] })).not.toThrow();
  });

  it('accepts run styles and paragraph formatting, and still refuses non-http links', () => {
    expect(() => parse({ type: 'paragraph', attrs: { lineHeight: '1.5', spaceAfter: '8pt', indentFirstLine: '36pt' }, content: [text('x', [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '12pt', color: '#1f3763' } }, { type: 'highlight', attrs: { color: '#ffff00' } }, { type: 'strike' }, { type: 'superscript' }])] })).not.toThrow();
    expect(() => parse({ type: 'paragraph', content: [text('x', [{ type: 'fontSize', attrs: { size: '18pt' } }])] })).toThrow();
    expect(() => parse({ type: 'paragraph', content: [text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])] })).toThrow();
  });
});

// Regression: the editor's own JSON (every attribute, defaults included) must pass the server schema,
// otherwise loading a notebook is cancelled and the canvas stays blank.
describe('editor JSON round-trip', () => {
  it('accepts what ProseMirror emits for lists, links, tables and styled runs', () => {
    const doc = { type: 'doc', content: [
      { type: 'orderedList', attrs: { start: 3, type: 'i' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Satu' }] }, { type: 'bulletList', attrs: { listStyle: 'circle' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Anak' }] }] }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'tautan', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'textStyle', attrs: { fontFamily: 'Times New Roman' } }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Selesai' }] }] }] },
      { type: 'pageBreak' },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { background: '#eeeeee', colwidth: [120] }, content: [{ type: 'paragraph' }] }] }] },
    ] };
    const emitted = documentSchema.nodeFromJSON(doc).toJSON();
    expect(JSON.stringify(emitted)).toContain('"title":null');
    const parsed = EditorDocumentSchema.parse(emitted);
    expect(JSON.stringify(parsed)).not.toContain('null');
    expect(documentText(parsed)).toBe('Satu\nAnak\ntautan\nSelesai\n\n');
  });
});

// Regression: a multi-line P08 result is applied with the 'paragraph' format; a selection that starts and ends
// mid-paragraph must splice into the surrounding text, not strand "Alpha " and " delta" as paragraphs of their own.
describe('paragraph-format replacement of a partial range', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const span = (doc: unknown) => { const text = documentText(doc); return [text.indexOf('beta'), text.indexOf('Gamma') + 5] as const; };

  it('joins the first and last lines to the text around the selection', () => {
    const doc = { type: 'doc', content: [p('Alpha beta'), { ...p('Gamma delta'), attrs: { textAlign: 'center' } }] };
    const result = replaceTextInDocument(doc, ...span(doc), 'X one\nY two', 'paragraph');
    expect(result.content).toEqual([p('Alpha X one'), { ...p('Y two delta'), attrs: { textAlign: 'center' } }]);
  });

  it('keeps the heading, list and table around the selection valid', () => {
    const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
    const docs = [
      { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Alpha beta' }] }, p('Gamma delta')] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha beta' }, { type: 'hardBreak' }, { type: 'text', text: 'Gamma delta' }] }] },
      { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('Alpha beta')] }, { type: 'listItem', content: [p('Gamma delta')] }] }] },
      { type: 'doc', content: [p('Alpha beta'), { type: 'pageBreak' }, p('Gamma delta')] },
      { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell('Alpha beta'), cell('A2')] }, { type: 'tableRow', content: [cell('Gamma delta'), cell('B2')] }] }] },
    ];
    for (const doc of docs) {
      const result = replaceTextInDocument(doc, ...span(doc), 'X one\nY two', 'paragraph');
      expect(() => documentSchema.nodeFromJSON(result).check()).not.toThrow();
      expect(documentText(result)).toContain('Alpha X one\nY two delta');
    }
    const single = replaceTextInDocument(docs[0]!, ...span(docs[0]!), 'Satu baris', 'paragraph');
    expect(documentText(single)).toBe('Alpha Satu baris delta');
    expect(single.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });
});

// Regression: the inline limit counted UTF-16 units, so a non-ASCII body could pass it yet exceed D1's 2 MB row size.
describe('stored body size limit', () => {
  const body = (char: string) => ({ type: 'doc', content: Array.from({ length: 4 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: char.repeat(180_000) }] })) });
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(() => EditorDocumentSchema.parse(body('a'))).not.toThrow();
    expect(() => EditorDocumentSchema.parse(body('中'))).toThrow(/inline safety limit/);
  });
});
