import { describe, expect, it } from 'vitest';
import { docxToEditorDocument } from '../../src/lib/docx/import';
import { documentXml, editorDocumentToDocx } from '../../src/lib/docx/export';
import { unzip } from '../../src/lib/docx/zip';
import { documentText } from '../../src/lib/editor/document';
import { jsonDocumentText, jsonDocumentTextLength, schemaProblem } from '../../src/lib/editor/validate';
import { documentSchema } from '../../src/lib/editor/extensions';
import { docCounts, docText } from '../../src/lib/editor/text-map';
import { countWords } from '../../src/lib/editor/metrics';
import { documentHtml } from '../../src/lib/editor/clipboard';
import { EditorDocumentSchema, type EditorDocument, type EditorNode } from '../../src/lib/contracts';
import { anchoredPicture, docxPackage, inlinePicture, p, r, thesisDocx, THESIS_STYLES } from '../helpers/docx';

const load = async (body: string, styles = THESIS_STYLES) => {
  const result = await docxToEditorDocument(await docxPackage(body, { styles }));
  expect(schemaProblem(result.content)).toBeNull();
  expect(() => documentSchema.nodeFromJSON(result.content).check()).not.toThrow();
  return result;
};
const types = (doc: EditorDocument) => doc.content.map((node) => node.type);
const spaces = (nodes: EditorNode[]): EditorNode[] => nodes.flatMap((node) => (node.type === 'imageSpace' ? [node] : spaces(node.content ?? [])));
const EMU = 12700;

describe('pagination follows the DOCX: explicit page breaks', () => {
  const section = (type?: string) => `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`;

  it('keeps all four kinds: a page break run, pageBreakBefore (direct and from a style), and next/odd/even-page sections', async () => {
    const styles = `${THESIS_STYLES}<w:style w:type="paragraph" w:styleId="Bab"><w:name w:val="Bab"/><w:pPr><w:pageBreakBefore/></w:pPr></w:style>`;
    const body = [
      p(r('Satu') + '<w:r><w:br w:type="page"/></w:r>' + r('Dua')),
      p(r('Tiga'), '<w:pageBreakBefore/>'),
      p(r('Empat'), '<w:pStyle w:val="Bab"/>'),
      p(r('Lima'), section('nextPage')), p(r('Enam'), section('oddPage')), p(r('Tujuh'), section('evenPage')),
      p(r('Delapan'), section('continuous')), p(r('Sembilan')), section(),
    ].join('');
    const { content } = await load(body, styles);
    expect(types(content)).toEqual(['paragraph', 'pageBreak', 'paragraph', 'pageBreak', 'paragraph', 'pageBreak', 'paragraph', 'paragraph', 'pageBreak', 'paragraph', 'pageBreak', 'paragraph', 'pageBreak', 'paragraph', 'paragraph']);
    expect(content.content.map((node) => node.content?.[0]?.text ?? null).filter(Boolean)).toEqual(['Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan']);
  });

  it('never turns a soft page break Word rendered (lastRenderedPageBreak) into a hard one', async () => {
    const { content } = await load(p(r('Awal') + '<w:r><w:lastRenderedPageBreak/><w:t>lanjut di halaman berikut</w:t></w:r>'));
    expect(types(content)).toEqual(['paragraph']);
  });

  it('takes the page setup from the first section and says so when later sections differ', async () => {
    const landscape = '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>';
    const first = '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2268" w:right="1701" w:bottom="1701" w:left="2268"/></w:sectPr>';
    const result = await load(p(r('Sampul'), first) + p(r('Lampiran lebar')) + landscape);
    expect(result).toMatchObject({ pageSize: 'a4', orientation: 'portrait', pageMargins: { top: 2268, right: 1701, bottom: 1701, left: 2268 } });
    expect(result.warnings).toContain('sectionsDiffer');
    const same = await load(p(r('Satu'), first) + p(r('Dua')) + first.replace('<w:type w:val="nextPage"/>', ''));
    expect(same.warnings).not.toContain('sectionsDiffer');
  });

  it('gives an empty paragraph the height of one line of its own font, in points', async () => {
    const { content } = await load(p(r('Isi')) + '<w:p/>' + p('', '<w:rPr><w:sz w:val="32"/></w:rPr>'));
    // Times New Roman 12 pt at 1.5 lines: 1.5 x 1.1499 x 12 = 20.7 pt; with a 16 pt paragraph mark, 27.6 pt.
    expect(content.content[1]).toMatchObject({ type: 'paragraph', attrs: { lineHeight: '20.7pt' } });
    expect(content.content[2]).toMatchObject({ type: 'paragraph', attrs: { lineHeight: '27.6pt' } });
    expect(content.content[0]!.attrs?.lineHeight).toBe('1.7248');
  });
});

describe('pictures become empty spaces of the same size, in the same place', () => {
  it('maps an inline picture to an inline imageSpace with the exact EMU-to-point size', async () => {
    const { content, warnings } = await load(p(r('Sebelum ') + inlinePicture(3_600_000, 2_400_000) + r(' sesudah')));
    const paragraph = content.content[0]!;
    expect(paragraph.content!.map((node) => node.type)).toEqual(['text', 'imageSpace', 'text']);
    expect(paragraph.content![1]).toEqual({ type: 'imageSpace', attrs: { width: Math.round((3_600_000 / EMU) * 100) / 100, height: Math.round((2_400_000 / EMU) * 100) / 100 } });
    expect(paragraph.content![1]!.attrs).toEqual({ width: 283.46, height: 188.98 });
    expect(warnings).toContain('images');
  });

  it('turns a top-and-bottom picture into a block space at the top of its paragraph, with its wrap distances', async () => {
    const { content } = await load(p(r('Teks paragraf.') + anchoredPicture(3_000_000, 1_800_000, 'topAndBottom', { dist: 114300 })));
    expect(content.content[0]!.content).toEqual([
      { type: 'imageSpace', attrs: { width: 236.22, height: 141.73, wrap: 'block', marginTop: 9, marginBottom: 9 } },
      expect.objectContaining({ type: 'text', text: 'Teks paragraf.' }),
    ]);
  });

  it('leaves no space for a picture behind or in front of the text', async () => {
    for (const wrap of ['behind', 'front', 'none'] as const) {
      const { content, warnings } = await load(p(r('Teks') + anchoredPicture(1_000_000, 1_000_000, wrap)));
      expect(spaces(content.content)).toEqual([]);
      expect(content.content[0]!.content).toEqual([expect.objectContaining({ type: 'text', text: 'Teks' })]);
      expect(warnings).toContain('images');
    }
  });

  it('floats a square or tight picture on its side, and falls back to a block for a centred one', async () => {
    const right = await load(p(r('Teks') + anchoredPicture(1_800_000, 1_200_000, 'square', { align: 'right', dist: 114300 })));
    expect(spaces(right.content.content)[0]).toEqual({ type: 'imageSpace', attrs: { width: 141.73, height: 94.49, wrap: 'right', marginTop: 9, marginRight: 9, marginBottom: 9, marginLeft: 9 } });
    const offset = await load(p(r('Teks') + anchoredPicture(1_000_000, 1_000_000, 'tight', { offset: 0 })));
    expect(spaces(offset.content.content)[0]!.attrs?.wrap).toBe('left');
    const centred = await load(p(r('Teks') + anchoredPicture(1_000_000, 1_000_000, 'square', { align: 'center' })));
    expect(spaces(centred.content.content)[0]!.attrs?.wrap).toBe('block');
    expect(centred.warnings).toContain('imageWrap');
  });

  it('reads the older VML frames too, but never a text box as a picture', async () => {
    const vml = '<w:r><w:pict><v:shape style="width:144pt;height:1in"><v:imagedata r:id="rImg1"/></v:shape></w:pict></w:r>';
    const { content } = await load(p(r('Gambar lama ') + vml));
    expect(spaces(content.content)).toEqual([{ type: 'imageSpace', attrs: { width: 144, height: 72 } }]);
    const box = '<w:r><w:pict><v:shape style="position:absolute;width:100pt;height:50pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Isi kotak</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
    const boxed = await load(p(r('Teks') + box));
    expect(spaces(boxed.content.content)).toEqual([]);
    expect(boxed.content.content.map((node) => node.content?.[0]?.text)).toEqual(['Teks', 'Isi kotak']);
  });

  it('leaves the text around a picture with all of its formatting', async () => {
    const styled = '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:i/><w:color w:val="C00000"/><w:sz w:val="28"/><w:u w:val="single"/>';
    const { content } = await load(p(r('Sebelum', styled) + inlinePicture(1_000_000, 500_000) + r('Sesudah', styled) + anchoredPicture(1_000_000, 500_000, 'topAndBottom')));
    const [block, before, inline, after] = content.content[0]!.content!;
    expect(block!.type).toBe('imageSpace'); expect(inline!.type).toBe('imageSpace');
    for (const run of [before!, after!]) {
      expect(run.marks).toEqual(expect.arrayContaining([{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '14pt', color: '#C00000' } }]));
    }
    expect(before!.marks).toEqual(after!.marks);
  });
});

describe('image spaces are not text', () => {
  const doc = EditorDocumentSchema.parse({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Satu dua' }, { type: 'imageSpace', attrs: { width: 100, height: 50 } }, { type: 'text', text: ' tiga' }] },
    { type: 'paragraph', content: [{ type: 'imageSpace', attrs: { width: 300, height: 200, wrap: 'block' } }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'empat' }] },
  ] });

  it('is ignored by documentText, the stored text length, the editor text map and the counters', () => {
    expect(documentText(doc)).toBe('Satu dua tiga\n\nempat');
    expect(jsonDocumentText(doc)).toBe('Satu dua tiga\n\nempat');
    expect(jsonDocumentTextLength(doc)).toBe('Satu dua tiga\n\nempat'.length);
    const node = documentSchema.nodeFromJSON(doc);
    expect(docText(node)).toBe('Satu dua tiga\n\nempat');
    expect(docCounts(node)).toEqual({ words: 4, characters: 'Satu dua tiga\n\nempat'.length });
    expect(countWords(documentText(doc))).toBe(4);
  });

  it('is written to HTML as an empty box of its size', () => {
    const html = documentHtml(doc);
    expect(html).toContain('data-image-space=""');
    expect(html).toMatch(/width:100pt;height:50pt/u);
    expect(html).toMatch(/display:block;width:300pt;height:200pt/u);
  });
});

describe('DOCX export keeps the empty space', () => {
  it('writes a picture-only paragraph as an empty paragraph exactly as tall as the picture', async () => {
    const doc = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Gambar 1' }] }, { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'imageSpace', attrs: { width: 283.46, height: 188.98 } }] }] });
    const { xml } = documentXml(doc, 'a4');
    expect(xml).toContain('<w:spacing w:line="3780" w:lineRule="exact"/>');
    expect(xml).not.toContain('v:rect');
    // Read back, it is an empty paragraph of the same height.
    const again = await docxToEditorDocument(await editorDocumentToDocx(doc));
    expect(again.content.content[1]).toMatchObject({ type: 'paragraph', attrs: { lineHeight: '189pt', textAlign: 'center' } });
    expect(again.content.content[1]!.content).toBeUndefined();
  });

  it('writes a space inside text, a block and a float as invisible VML frames that import back unchanged', async () => {
    const original = EditorDocumentSchema.parse({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Teks ' }, { type: 'imageSpace', attrs: { width: 72, height: 36 } }, { type: 'text', text: ' lanjut' }] },
      { type: 'paragraph', content: [{ type: 'imageSpace', attrs: { width: 200, height: 100, wrap: 'block' } }, { type: 'text', text: 'Di bawah gambar' }] },
      { type: 'paragraph', content: [{ type: 'imageSpace', attrs: { width: 120, height: 80, wrap: 'right' } }, { type: 'text', text: 'Mengalir di kiri' }] },
    ] });
    const files = await unzip(await editorDocumentToDocx(original));
    const xml = new TextDecoder().decode(files.get('word/document.xml')!);
    expect(xml).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(xml).toContain('<v:rect style="width:72pt;height:36pt" stroked="f" filled="f"/>');
    expect(xml).toMatch(/mso-position-horizontal:right[^"]*" stroked="f" filled="f"><w10:wrap type="square"\/>/u);
    expect(xml).toMatch(/<w10:wrap type="topAndBottom"\/>/u);
    const again = await docxToEditorDocument(await editorDocumentToDocx(original));
    expect(spaces(again.content.content).map((node) => node.attrs)).toEqual([
      { width: 72, height: 36 },
      { width: 200, height: 100, wrap: 'block' },
      // A VML float carries no wrap distances; Word's default 0.125 in (9 pt) on the text side is used.
      { width: 120, height: 80, wrap: 'right', marginLeft: 9 },
    ]);
    expect(jsonDocumentText(again.content)).toBe(jsonDocumentText(original));
  });
});

describe('styles survive a long import', () => {
  it('keeps every run format of a 300-page thesis: no mark, attribute or block is dropped past the old caps', async () => {
    const { bytes, stats } = await thesisDocx({ pages: 300 });
    const { content } = await docxToEditorDocument(bytes);
    const paragraphs = content.content.filter((node) => node.type === 'paragraph' && node.content?.length);
    // Body paragraphs: justified, 1.5 lines in Times New Roman, 0.5 in first-line indent, nothing after.
    const body = paragraphs.filter((node) => node.content!.length === 3);
    expect(body.length).toBeGreaterThan(2000);
    for (const node of body) {
      expect(node.attrs).toMatchObject({ textAlign: 'justify', lineHeight: '1.7248', indentFirstLine: '36pt', spaceAfter: '0pt' });
      expect(node.content![1]!.marks).toEqual([{ type: 'italic' }, { type: 'textStyle', attrs: { fontFamily: "'Times New Roman', Tinos", fontSize: '12pt' } }]);
      expect(node.content![0]!.marks).toEqual([{ type: 'textStyle', attrs: { fontFamily: "'Times New Roman', Tinos", fontSize: '12pt' } }]);
    }
    expect(content.content.filter((node) => node.type === 'heading')).toHaveLength(stats.breaks.pageBreakBefore);
    expect(jsonDocumentTextLength(content)).toBeGreaterThan(stats.characters);
  }, 120_000);
});
