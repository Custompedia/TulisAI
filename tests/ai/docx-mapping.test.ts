import { describe, expect, it } from 'vitest';
import { documentXml, editorDocumentToDocx, docxFilename } from '../../src/lib/docx/export';
import { docxToEditorDocument, DocxError, looksLikeDocx } from '../../src/lib/docx/import';
import { contentWidth, LINE_HEIGHT, LINE_RULE_AUTO, PAGES, pageStyle, SPACE_AFTER_TWIPS, twipsToMm, twipsToPx } from '../../src/lib/docx/office-defaults';
import { unzip, zip } from '../../src/lib/docx/zip';
import { EditorDocumentSchema } from '../../src/lib/contracts';
import { readFileSync } from 'node:fs';

const doc = (...content: unknown[]) => EditorDocumentSchema.parse({ type: 'doc', content });
const paragraph = (text: string, attrs?: Record<string, unknown>) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });
const roundTrip = async (value: unknown, language = 'id') => docxToEditorDocument(await editorDocumentToDocx(value, { language }), { language });
const decode = async (bytes: Uint8Array, name: string) => new TextDecoder().decode((await unzip(bytes)).get(name)!);

describe('Word defaults', () => {
  it('uses the real page geometry for A4 and Letter', () => {
    expect(twipsToMm(PAGES.a4.width)).toBeCloseTo(210, 1);
    expect(twipsToMm(PAGES.a4.height)).toBeCloseTo(297, 1);
    expect(twipsToPx(PAGES.letter.width)).toBe(816);
    expect(twipsToPx(PAGES.letter.height)).toBe(1056);
    // Word 2007+ Normal is a one-inch margin on all four sides.
    for (const size of ['a4', 'letter'] as const) for (const side of ['top', 'right', 'bottom', 'left'] as const) expect(PAGES[size].margin[side]).toBe(1440);
    expect(twipsToPx(contentWidth('letter'))).toBe(624);
  });
  it('derives the line height from the font metrics, not from the 1.08 multiple alone', () => {
    // Word multiplies the font's single-line height (2500/2048 em for Calibri and Carlito) by 1.08.
    expect(LINE_HEIGHT).toBeCloseTo(1.3184, 3);
    expect(LINE_RULE_AUTO).toBe(259);
    expect(SPACE_AFTER_TWIPS).toBe(160);
  });
  it('publishes the same numbers to the preview as CSS values', () => {
    const style = pageStyle({ size: 'a4' });
    expect(style['--page-width']).toBe('793.73px');
    expect(style['--page-margin-left']).toBe('96.00px');
    expect(style['--page-line-height']).toBe(String(LINE_HEIGHT));
  });
});

describe('DOCX export shape', () => {
  it('writes the section properties from the shared defaults', () => {
    const { xml } = documentXml(doc(paragraph('Teks')), 'a4');
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(xml).toContain('w:top="1440"');
    expect(xml).toContain('w:left="1440"');
  });
  it('writes justification and right alignment the way OOXML spells them', () => {
    const { xml } = documentXml(doc(paragraph('Rata kanan', { textAlign: 'right' }), paragraph('Rata penuh', { textAlign: 'justify' })), 'a4');
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain('<w:jc w:val="both"/>');
  });
  it('preserves significant whitespace and escapes text', () => {
    const { xml } = documentXml(doc(paragraph('a & b < c  ')), 'a4');
    expect(xml).toContain('xml:space="preserve"');
    expect(xml).toContain('a &amp; b &lt; c  ');
  });
  it('registers one external relationship per hyperlink', () => {
    const { xml, relationships } = documentXml(doc({ type: 'paragraph', content: [{ type: 'text', text: 'situs', marks: [{ type: 'link', attrs: { href: 'https://example.test/x' } }] }] }), 'a4');
    expect(relationships).toHaveLength(1);
    expect(xml).toContain(`<w:hyperlink r:id="${relationships[0]!.id}">`);
  });
  it('produces a package with the parts Word requires', async () => {
    const files = await unzip(await editorDocumentToDocx(doc(paragraph('Teks')), { title: 'Judul' }));
    for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']) {
      expect(files.has(name)).toBe(true);
    }
    const styles = new TextDecoder().decode(files.get('word/styles.xml')!);
    expect(styles).toContain('w:ascii="Calibri"');
    expect(styles).toContain('w:val="22"');
    expect(styles).toContain('w:line="259"');
  });
  it('picks the page size Word would pick for the locale', async () => {
    expect(await decode(await editorDocumentToDocx(doc(paragraph('x')), { language: 'en' }), 'word/document.xml')).toContain('w:w="12240"');
    expect(await decode(await editorDocumentToDocx(doc(paragraph('x')), { language: 'id' }), 'word/document.xml')).toContain('w:w="11906"');
  });
  it('builds a safe download filename', () => {
    expect(docxFilename('Skripsi/Bab 1: Metode')).toBe('Skripsi Bab 1 Metode.docx');
    expect(docxFilename('***')).toBe('document.docx');
  });
});

describe('DOCX round trip', () => {
  it('keeps headings, marks, alignment and links', async () => {
    const source = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Metode' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'tebal', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' dan ' },
        { type: 'text', text: 'miring', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' plus ' },
        { type: 'text', text: 'garis', marks: [{ type: 'underline' }] },
      ] },
      paragraph('Rata kanan', { textAlign: 'right' }),
      { type: 'paragraph', content: [{ type: 'text', text: 'situs', marks: [{ type: 'link', attrs: { href: 'https://example.test/x' } }] }] },
    );
    const result = await roundTrip(source);
    expect(result.content.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    const marks = (result.content.content[1]!.content ?? []).flatMap((node) => (node.marks ?? []).map((mark) => mark.type));
    expect(marks).toEqual(['bold', 'italic', 'underline']);
    expect(result.content.content[2]).toMatchObject({ attrs: { textAlign: 'right' } });
    expect((result.content.content[3]!.content ?? [])[0]!.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.test/x' } });
  });

  it('keeps bullet and ordered lists as lists, not as numbered prose', async () => {
    const list = (type: 'bulletList' | 'orderedList', ...items: string[]) => ({ type, content: items.map((text) => ({ type: 'listItem', content: [paragraph(text)] })) });
    const result = await roundTrip(doc(list('bulletList', 'Satu', 'Dua'), list('orderedList', 'Pertama', 'Kedua')));
    expect(result.content.content[0]).toMatchObject({ type: 'bulletList' });
    expect(result.content.content[0]!.content).toHaveLength(2);
    expect(result.content.content[1]).toMatchObject({ type: 'orderedList' });
    expect(result.content.content[1]!.content).toHaveLength(2);
  });

  it('keeps a table with its header row', async () => {
    const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({ type, content: [paragraph(text)] });
    const source = doc({ type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Paket'), cell('tableHeader', 'Biaya')] },
      { type: 'tableRow', content: [cell('tableCell', 'Pro'), cell('tableCell', '99rb')] },
    ] });
    const result = await roundTrip(source);
    const table = result.content.content[0]!;
    expect(table.type).toBe('table');
    expect(table.content).toHaveLength(2);
    expect(table.content![0]!.content![0]!.type).toBe('tableHeader');
    expect(table.content![1]!.content![0]!.type).toBe('tableCell');
  });

  it('keeps blockquotes, rules and hard breaks', async () => {
    const source = doc(
      { type: 'blockquote', content: [paragraph('Kutipan')] },
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [{ type: 'text', text: 'satu' }, { type: 'hardBreak' }, { type: 'text', text: 'dua' }] },
    );
    const result = await roundTrip(source);
    expect(result.content.content.map((node) => node.type)).toEqual(['blockquote', 'horizontalRule', 'paragraph']);
    expect((result.content.content[2]!.content ?? []).map((node) => node.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('carries the page size and the title through the file', async () => {
    const letter = await docxToEditorDocument(await editorDocumentToDocx(doc(paragraph('x')), { language: 'en', title: 'Thesis Draft' }), { language: 'id' });
    expect(letter.pageSize).toBe('letter');
    expect(letter.title).toBe('Thesis Draft');
  });

  it('names the notebook from the first heading when the file has no title', async () => {
    const bytes = await editorDocumentToDocx(doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Bab Satu' }] }, paragraph('Isi')), { title: '' });
    expect((await docxToEditorDocument(bytes)).title).toBe('Bab Satu');
  });
});

describe('DOCX import safety', () => {
  const encode = (value: string) => new TextEncoder().encode(value);

  it('refuses anything that is not a ZIP, whatever it claims to be', async () => {
    await expect(docxToEditorDocument(encode('%PDF-1.7 not a docx'))).rejects.toBeInstanceOf(DocxError);
    expect(looksLikeDocx(encode('PK'))).toBe(false);
  });

  it('refuses a ZIP that is not an OOXML package', async () => {
    const bytes = await zip([{ name: 'hello.txt', data: encode('hi') }]);
    expect(looksLikeDocx(bytes)).toBe(true);
    await expect(docxToEditorDocument(bytes)).rejects.toThrowError(/not a .docx/);
  });

  it('refuses a package with no document body', async () => {
    const bytes = await zip([{ name: '[Content_Types].xml', data: encode('<Types/>') }]);
    await expect(docxToEditorDocument(bytes)).rejects.toThrowError(/no document body/);
  });

  it('stops a package that would unpack to more than the allowed size', async () => {
    const bytes = await zip([{ name: '[Content_Types].xml', data: encode('<Types/>') }, { name: 'word/document.xml', data: encode('x'.repeat(5000)) }]);
    await expect(docxToEditorDocument(bytes, { limits: { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 1000 } })).rejects.toBeInstanceOf(DocxError);
  });

  it('drops a javascript link but keeps its text', async () => {
    const files = await unzip(await editorDocumentToDocx(doc(paragraph('aman'))));
    const rels = new TextDecoder().decode(files.get('word/_rels/document.xml.rels')!)
      .replace('</Relationships>', '<Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>');
    const body = new TextDecoder().decode(files.get('word/document.xml')!)
      .replace('<w:p>', '<w:p><w:hyperlink r:id="rIdX"><w:r><w:t>klik</w:t></w:r></w:hyperlink>');
    const rebuilt = await zip([...files].map(([name, data]) =>
      name === 'word/_rels/document.xml.rels' ? { name, data: encode(rels) } : name === 'word/document.xml' ? { name, data: encode(body) } : { name, data }));
    const result = await docxToEditorDocument(rebuilt);
    const text = JSON.stringify(result.content);
    expect(text).toContain('klik');
    expect(text).not.toContain('javascript:');
  });

  it('skips images and tracked deletions silently instead of failing', async () => {
    const files = await unzip(await editorDocumentToDocx(doc(paragraph('teks'))));
    const body = new TextDecoder().decode(files.get('word/document.xml')!)
      .replace('<w:body>', '<w:body><w:p><w:r><w:drawing/></w:r></w:p><w:p><w:del><w:r><w:t>dibuang</w:t></w:r></w:del></w:p>');
    const rebuilt = await zip([...files].map(([name, data]) => name === 'word/document.xml' ? { name, data: encode(body) } : { name, data }));
    const result = await docxToEditorDocument(rebuilt);
    expect(JSON.stringify(result.content)).toContain('teks');
    expect(JSON.stringify(result.content)).not.toContain('dibuang');
  });
});

// A real .docx written by another tool (python-docx, Word's own default template), committed as a fixture.
// It uses style-based lists with no w:numPr, which our own exporter never produces, so a round trip alone
// would never have caught them.
describe('DOCX written by another tool', () => {
  const fixture = () => new Uint8Array(readFileSync('fixtures/docx/third-party.docx'));

  it('reads its structure, not just its text', async () => {
    const result = await docxToEditorDocument(fixture());
    expect(result.content.content.map((node) => node.type)).toEqual([
      'heading', 'heading', 'paragraph', 'paragraph', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'table', 'paragraph',
    ]);
    expect(result.content.content[0]).toMatchObject({ attrs: { level: 1 } });
    expect(result.content.content[1]).toMatchObject({ attrs: { level: 2 } });
  });

  it('recognises a list marked only by its Word style', async () => {
    const result = await docxToEditorDocument(fixture());
    const bullets = result.content.content.find((node) => node.type === 'bulletList');
    const ordered = result.content.content.find((node) => node.type === 'orderedList');
    expect(bullets!.content).toHaveLength(2);
    expect(ordered!.content).toHaveLength(2);
  });

  it('keeps marks, alignment, the table and Unicode', async () => {
    const result = await docxToEditorDocument(fixture());
    const marks = (result.content.content[2]!.content ?? []).flatMap((node) => (node.marks ?? []).map((mark) => mark.type)).filter((type) => type !== 'textStyle');
    expect(marks).toEqual(['bold', 'italic', 'underline']);
    // The file's theme sets Cambria as the body font, so the text carries it the way Word shows it.
    expect(result.content.content[2]!.content![0]!.marks).toContainEqual({ type: 'textStyle', attrs: { fontFamily: 'Cambria, Caladea' } });
    expect(result.content.content[3]).toMatchObject({ attrs: { textAlign: 'justify' } });
    expect(result.content.content[4]).toMatchObject({ attrs: { textAlign: 'right' } });
    const table = result.content.content.find((node) => node.type === 'table')!;
    // No w:tblHeader in this file, so Word shows the first row as an ordinary row.
    expect(table.content![0]!.content![0]!.type).toBe('tableCell');
    expect(JSON.stringify(result.content)).toContain('ñ é ü');
  });

  it('takes the page size and title from the file, not from the locale', async () => {
    const result = await docxToEditorDocument(fixture(), { language: 'id' });
    expect(result.pageSize).toBe('letter');
    expect(result.title).toBe('Dokumen Word Asli');
  });

  it('survives a second trip through our own writer', async () => {
    const first = await docxToEditorDocument(fixture());
    const again = await docxToEditorDocument(await editorDocumentToDocx(first.content, { title: first.title, pageSize: first.pageSize }));
    expect(again.content.content.map((node) => node.type)).toEqual(first.content.content.map((node) => node.type));
    expect(again.pageSize).toBe('letter');
  });
});
