import { describe, expect, it } from "vitest";
import { documentText, plainTextDocument, replaceTextInDocument, selectionOffsets } from "../../src/lib/editor/document";

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
