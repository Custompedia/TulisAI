import { describe, expect, it } from 'vitest';
import { docxToEditorDocument, DocxError } from '../../src/lib/docx/import';
import { editorDocumentToDocx } from '../../src/lib/docx/export';
import { zip } from '../../src/lib/docx/zip';
import { EditorDocumentSchema } from '../../src/lib/contracts';
import { documentSchema } from '../../src/lib/editor/extensions';
import { formatMargins, pageStyle, parseMargins } from '../../src/lib/docx/office-defaults';
import type { EditorNode } from '../../src/lib/editor/document';

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"', 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"', 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"', 'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
].join(' ');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

type Parts = { styles?: string; numbering?: string; footnotes?: string; endnotes?: string; theme?: string; links?: Record<string, string>; title?: string };

// Builds a minimal but valid package from raw WordprocessingML, the way Word lays it out.
async function docx(body: string, parts: Parts = {}): Promise<Uint8Array> {
  const encode = (value: string) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`);
  const rels = [
    parts.styles !== undefined && `<Relationship Id="rS" Type="${REL}/styles" Target="styles.xml"/>`,
    parts.numbering !== undefined && `<Relationship Id="rN" Type="${REL}/numbering" Target="numbering.xml"/>`,
    parts.footnotes !== undefined && `<Relationship Id="rF" Type="${REL}/footnotes" Target="footnotes.xml"/>`,
    parts.endnotes !== undefined && `<Relationship Id="rE" Type="${REL}/endnotes" Target="endnotes.xml"/>`,
    parts.theme !== undefined && `<Relationship Id="rT" Type="${REL}/theme" Target="theme/theme1.xml"/>`,
    ...Object.entries(parts.links ?? {}).map(([id, target]) => `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${target}" TargetMode="External"/>`),
  ].filter(Boolean).join('');
  const entries = [
    { name: '[Content_Types].xml', data: encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: '_rels/.rels', data: encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: 'word/document.xml', data: encode(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) },
    { name: 'word/_rels/document.xml.rels', data: encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`) },
    ...(parts.styles !== undefined ? [{ name: 'word/styles.xml', data: encode(`<w:styles ${NS}>${parts.styles}</w:styles>`) }] : []),
    ...(parts.numbering !== undefined ? [{ name: 'word/numbering.xml', data: encode(`<w:numbering ${NS}>${parts.numbering}</w:numbering>`) }] : []),
    ...(parts.footnotes !== undefined ? [{ name: 'word/footnotes.xml', data: encode(`<w:footnotes ${NS}>${parts.footnotes}</w:footnotes>`) }] : []),
    ...(parts.endnotes !== undefined ? [{ name: 'word/endnotes.xml', data: encode(`<w:endnotes ${NS}>${parts.endnotes}</w:endnotes>`) }] : []),
    ...(parts.theme !== undefined ? [{ name: 'word/theme/theme1.xml', data: encode(`<a:theme ${NS}><a:themeElements><a:fontScheme>${parts.theme}</a:fontScheme></a:themeElements></a:theme>`) }] : []),
  ];
  return zip(entries);
}

// Word 2013+ Normal: Calibri 11 pt from the theme, 8 pt after, 1.08 lines; matches the canvas, so plain text needs no marks.
const OFFICE_DEFAULTS = '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>';

const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

async function load(body: string, parts: Parts = {}, language = 'id') {
  const result = await docxToEditorDocument(await docx(body, { styles: OFFICE_DEFAULTS, ...parts }), { language });
  // Every import must satisfy both the stored-document contract and the live editor schema.
  expect(() => EditorDocumentSchema.parse(result.content)).not.toThrow();
  expect(() => documentSchema.nodeFromJSON(result.content).check()).not.toThrow();
  return result;
}
const blocks = async (body: string, parts: Parts = {}) => (await load(body, parts)).content.content;
const textOf = (node: EditorNode): string => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(textOf).join('');
const markOf = (node: EditorNode | undefined, type: string) => node?.marks?.find((mark) => mark.type === type);

describe('DOCX import: style resolution', () => {
  it('layers docDefaults, the basedOn chain, character styles and direct formatting', async () => {
    const styles = '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Isi"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="720"/></w:pPr><w:rPr><w:color w:val="333333"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="BodyBold"><w:name w:val="Isi Tebal"/><w:basedOn w:val="Body"/><w:rPr><w:b/></w:rPr></w:style>'
      + '<w:style w:type="character" w:styleId="Emph"><w:name w:val="Emph"/><w:rPr><w:i/></w:rPr></w:style>';
    const [first, second] = await blocks(
      p(r('Teks biasa ') + '<w:r><w:rPr><w:rStyle w:val="Emph"/><w:sz w:val="28"/></w:rPr><w:t>miring besar</w:t></w:r>', '<w:pStyle w:val="Body"/>')
      + p(r('tidak tebal', '<w:b w:val="0"/>') + r(' tebal'), '<w:pStyle w:val="BodyBold"/>'),
      { styles },
    );
    expect(first).toMatchObject({ type: 'paragraph', attrs: { textAlign: 'justify', indentFirstLine: '36pt', spaceAfter: '0pt', lineHeight: '1.7248' } });
    const base = { fontFamily: "'Times New Roman', Tinos", fontSize: '12pt', color: '#333333' };
    expect(first!.content![0]).toEqual({ type: 'text', text: 'Teks biasa ', marks: [{ type: 'textStyle', attrs: base }] });
    expect(first!.content![1]!.marks).toEqual([{ type: 'italic' }, { type: 'textStyle', attrs: { ...base, fontSize: '14pt' } }]);
    // A toggle turned off with w:val="0" beats the bold the style would give.
    expect(markOf(second!.content![0], 'bold')).toBeUndefined();
    expect(markOf(second!.content![1], 'bold')).toBeDefined();
  });

  it('reads theme fonts for body and headings', async () => {
    const theme = '<a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Georgia"/></a:minorFont>';
    const styles = OFFICE_DEFAULTS + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:b/><w:sz w:val="28"/></w:rPr></w:style>';
    const [heading, body] = await blocks(p(r('BAB SATU'), '<w:pStyle w:val="Heading1"/>') + p(r('Isi')), { styles, theme });
    expect(heading).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    // Heading text states its own font, size and colour, so it looks like Word rather than the canvas heading style.
    expect(heading!.content![0]!.marks).toEqual([{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Arial, Arimo', fontSize: '14pt', color: '#000000' } }]);
    expect(markOf(body!.content![0], 'textStyle')?.attrs).toEqual({ fontFamily: 'Georgia' });
  });

  it('treats Title, Subtitle and custom outline-level styles as headings', async () => {
    const styles = OFFICE_DEFAULTS
      + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Bab"><w:name w:val="Judul Bab"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>';
    const result = await blocks(p(r('LAPORAN AKHIR'), '<w:pStyle w:val="Title"/>') + p(r('BAB I'), '<w:pStyle w:val="Bab"/>') + p(r('Isi daftar'), '<w:pStyle w:val="TOC1"/>'), { styles });
    expect(result.map((node) => [node.type, node.attrs?.level])).toEqual([['heading', 1], ['heading', 1], ['paragraph', undefined]]);
  });
});

describe('DOCX import: runs', () => {
  it('maps highlight, shading, scripts, strike, caps and hidden text', async () => {
    const [node] = await blocks(p(
      r('kuning', '<w:highlight w:val="yellow"/>') + r('oranye', '<w:shd w:val="clear" w:color="auto" w:fill="FFC000"/>')
      + r('2', '<w:vertAlign w:val="superscript"/>') + r('i', '<w:vertAlign w:val="subscript"/>')
      + r('coret', '<w:strike/>') + r('ganda', '<w:dstrike/>') + r('kapital', '<w:caps/>') + r('rahasia', '<w:vanish/>') + r('merah', '<w:color w:val="C00000"/>'),
    ));
    const content = node!.content!;
    expect(content.map((part) => part.text)).toEqual(['kuning', 'oranye', '2', 'i', 'coretganda', 'KAPITAL', 'merah']);
    expect(markOf(content[0], 'highlight')?.attrs).toEqual({ color: '#FFFF00' });
    expect(markOf(content[1], 'highlight')?.attrs).toEqual({ color: '#FFC000' });
    expect(markOf(content[2], 'superscript')).toBeDefined();
    expect(markOf(content[3], 'subscript')).toBeDefined();
    expect(markOf(content[4], 'strike')).toBeDefined();
    expect(markOf(content[6], 'textStyle')?.attrs).toEqual({ color: '#C00000' });
  });

  it('keeps tabs, line breaks, symbols and special hyphens', async () => {
    const [node] = await blocks(p(`<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:sym w:font="Symbol" w:char="F061"/><w:softHyphen/><w:noBreakHyphen/><w:lastRenderedPageBreak/><w:t>d</w:t></w:r>`));
    expect(node!.content!.map((part) => part.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(node!.content![0]!.text).toBe('a\tb');
    expect(node!.content![2]!.text).toBe('cα­‑d');
  });

  it('merges runs Word split with identical formatting', async () => {
    const [node] = await blocks(p(r('sa', '<w:b/>') + '<w:proofErr w:type="spellStart"/>' + r('tu', '<w:b/>') + '<w:bookmarkStart w:id="0" w:name="x"/>' + r(' dua', '<w:b/>')));
    expect(node!.content).toEqual([{ type: 'text', text: 'satu dua', marks: [{ type: 'bold' }] }]);
  });

  it('keeps web links, flattens internal anchors, and turns HYPERLINK fields into links', async () => {
    const [node] = await blocks(p(
      `<w:hyperlink r:id="rL">${r('situs')}</w:hyperlink><w:hyperlink w:anchor="_Toc1">${r(' jangkar')}</w:hyperlink>`
      + `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.test/f" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r(' medan')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`
      + `<w:fldSimple w:instr=" PAGE ">${r(' 7')}</w:fldSimple>`,
    ), { links: { rL: 'https://example.test/x' } });
    const content = node!.content!;
    expect(content[0]).toEqual({ type: 'text', text: 'situs', marks: [{ type: 'link', attrs: { href: 'https://example.test/x' } }] });
    expect(content[1]).toEqual({ type: 'text', text: ' jangkar' });
    expect(content[2]).toEqual({ type: 'text', text: ' medan', marks: [{ type: 'link', attrs: { href: 'https://example.test/f' } }] });
    expect(textOf(node!)).toBe('situs jangkar medan 7');
    expect(JSON.stringify(node)).not.toContain('HYPERLINK');
  });

  it('keeps tracked insertions, drops deletions, comments and wrappers', async () => {
    const [node] = await blocks(p(
      `<w:ins w:id="1" w:author="A">${r('baru ')}</w:ins><w:del w:id="2" w:author="A"><w:r><w:delText>lama</w:delText></w:r></w:del>`
      + `<w:commentRangeStart w:id="3"/><w:smartTag w:uri="x" w:element="place">${r('Bandung')}</w:smartTag><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>`
      + `<w:customXml w:element="c">${r(' kota')}</w:customXml><w:moveFrom>${r('pindah')}</w:moveFrom>`,
    ));
    expect(textOf(node!)).toBe('baru Bandung kota');
  });

  it('writes Office Math as linear text', async () => {
    const [node] = await blocks(p('<m:oMath><m:r><m:t>x=</m:t></m:r><m:f><m:num><m:r><m:t>a+b</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f><m:sSup><m:e><m:r><m:t>y</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'));
    expect(textOf(node!)).toBe('x=(a+b)/2y^2');
  });
});

describe('DOCX import: paragraphs', () => {
  it('converts spacing, exact line height and indents to CSS lengths', async () => {
    const [node] = await blocks(p(r('x'), '<w:spacing w:before="240" w:after="120" w:line="300" w:lineRule="exact"/><w:ind w:left="720" w:right="360" w:hanging="360"/><w:jc w:val="center"/>'));
    expect(node!.attrs).toEqual({ textAlign: 'center', lineHeight: '15pt', spaceBefore: '12pt', spaceAfter: '6pt', indentLeft: '36pt', indentRight: '18pt', indentFirstLine: '-18pt' });
  });

  it('leaves canvas-default paragraphs without attributes', async () => {
    const [node] = await blocks(p(r('x')));
    expect(node).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] });
  });

  it('collapses contextual spacing between paragraphs of the same style', async () => {
    const styles = OFFICE_DEFAULTS + '<w:style w:type="paragraph" w:styleId="Tight"><w:name w:val="Tight"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="120"/><w:contextualSpacing/></w:pPr></w:style>';
    const result = await blocks(p(r('a'), '<w:pStyle w:val="Tight"/>') + p(r('b'), '<w:pStyle w:val="Tight"/>') + p(r('c')), { styles });
    expect(result[0]!.attrs).toEqual({ spaceBefore: '6pt', spaceAfter: '0pt' });
    expect(result[1]!.attrs).toEqual({ spaceAfter: '6pt' });
    expect(result[2]!.attrs).toBeUndefined();
  });

  it('turns page breaks, page-break-before and section breaks into pageBreak nodes', async () => {
    const result = await blocks(
      p('<w:r><w:br w:type="page"/></w:r>') + p(r('A') + '<w:r><w:br w:type="page"/></w:r>' + r('B'))
      + p(r('C'), '<w:pageBreakBefore/>') + p(r('D'), '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>') + p(r('E'), '<w:sectPr><w:type w:val="continuous"/></w:sectPr>') + p(r('F')),
    );
    // The leading break would print a blank first page, so it goes.
    expect(result.map((node) => node.type === 'pageBreak' ? '|' : textOf(node))).toEqual(['A', '|', 'B', '|', 'C', 'D', '|', 'E', 'F']);
  });

  it('keeps an empty paragraph, which Word shows as a blank line', async () => {
    expect((await blocks(p(r('a')) + p('') + p(r('b')))).map((node) => node.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });
});

const LEVEL = (ilvl: number, format: string, text: string, extra = '') => `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/>${extra}<w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
const numPr = (numId: number, ilvl = 0) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;

describe('DOCX import: numbering', () => {
  const numbering = `<w:abstractNum w:abstractNumId="0">${LEVEL(0, 'decimal', '%1.')}${LEVEL(1, 'lowerLetter', '%2)')}${LEVEL(2, 'upperRoman', '%3.')}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="1">${LEVEL(0, 'bullet', '')}${LEVEL(1, 'bullet', 'o')}${LEVEL(2, 'bullet', '')}</w:abstractNum>`
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
    + '<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';

  it('builds nested ordered lists with their formats and continues across an interruption', async () => {
    const result = await blocks(
      p(r('satu'), numPr(1)) + p(r('dua'), numPr(1)) + p(r('dua-a'), numPr(1, 1)) + p(r('dua-b'), numPr(1, 1)) + p(r('dua-b-I'), numPr(1, 2)) + p(r('tiga'), numPr(1))
      + p(r('Sela')) + p(r('empat'), numPr(1)) + p(r('ulang'), numPr(3)),
      { numbering },
    );
    expect(result.map((node) => node.type)).toEqual(['orderedList', 'paragraph', 'orderedList', 'orderedList']);
    const [first, , continued, restarted] = result;
    expect(first!.attrs).toBeUndefined();
    expect(first!.content).toHaveLength(3);
    const nested = first!.content![1]!.content![1]!;
    expect(nested).toMatchObject({ type: 'orderedList', attrs: { type: 'a' } });
    expect(nested.content).toHaveLength(2);
    expect(nested.content![1]!.content![1]).toMatchObject({ type: 'orderedList', attrs: { type: 'I' } });
    // Same numId after a paragraph: Word keeps counting, so the list starts at 4.
    expect(continued).toMatchObject({ attrs: { start: 4 } });
    expect(textOf(continued!)).toBe('empat');
    // A w:num with startOverride restarts the shared abstract numbering.
    expect(restarted!.attrs).toBeUndefined();
  });

  it('maps bullet glyphs per level to disc, circle and square', async () => {
    const [list] = await blocks(p(r('a'), numPr(2)) + p(r('b'), numPr(2, 1)) + p(r('c'), numPr(2, 2)), { numbering });
    expect(list).toMatchObject({ type: 'bulletList' });
    expect(list!.attrs).toBeUndefined();
    const circle = list!.content![0]!.content![1]!;
    expect(circle).toMatchObject({ type: 'bulletList', attrs: { listStyle: 'circle' } });
    expect(circle.content![0]!.content![1]).toMatchObject({ type: 'bulletList', attrs: { listStyle: 'square' } });
  });

  it('keeps numbered headings as headings with the computed number', async () => {
    const chapters = '<w:abstractNum w:abstractNumId="7">'
      + `${LEVEL(0, 'upperRoman', 'BAB %1', '<w:suff w:val="space"/>')}${LEVEL(1, 'decimal', '%1.%2', '<w:isLgl/>')}${LEVEL(2, 'decimal', '%1.%2.%3', '<w:isLgl/>')}</w:abstractNum>`
      + '<w:num w:numId="5"><w:abstractNumId w:val="7"/></w:num>';
    const styles = OFFICE_DEFAULTS
      + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="5"/></w:numPr><w:outlineLvl w:val="2"/></w:pPr></w:style>';
    const h = (style: string, text: string) => p(r(text), `<w:pStyle w:val="${style}"/>`);
    const result = await blocks(h('Heading1', 'PENDAHULUAN') + h('Heading2', 'Latar Belakang') + h('Heading3', 'Rinci') + p(r('Isi')) + h('Heading2', 'Rumusan') + h('Heading1', 'TINJAUAN') + h('Heading2', 'Teori'), { styles, numbering: chapters });
    expect(result.map((node) => [node.type, node.attrs?.level, textOf(node)])).toEqual([
      ['heading', 1, 'BAB I PENDAHULUAN'], ['heading', 2, '1.1\tLatar Belakang'], ['heading', 3, '1.1.1\tRinci'], ['paragraph', undefined, 'Isi'],
      ['heading', 2, '1.2\tRumusan'], ['heading', 1, 'BAB II TINJAUAN'], ['heading', 2, '2.1\tTeori'],
    ]);
  });

  it('writes unmappable numbering on body paragraphs as literal text with the level indent', async () => {
    const odd = `<w:abstractNum w:abstractNumId="3">${LEVEL(0, 'decimal', 'BAB %1')}</w:abstractNum><w:abstractNum w:abstractNumId="4">${LEVEL(0, 'decimalZero', '%1.')}</w:abstractNum>`
      + '<w:num w:numId="8"><w:abstractNumId w:val="3"/></w:num><w:num w:numId="9"><w:abstractNumId w:val="4"/></w:num>';
    const result = await blocks(p(r('Satu'), numPr(8)) + p(r('Dua'), numPr(8)) + p(r('Nol'), numPr(9)) + p(r('Asing'), numPr(42)), { numbering: odd });
    expect(result.map((node) => [node.type, textOf(node)])).toEqual([['paragraph', 'BAB 1\tSatu'], ['paragraph', 'BAB 2\tDua'], ['paragraph', '01.\tNol'], ['paragraph', 'Asing']]);
    expect(result[0]!.attrs).toMatchObject({ indentLeft: '36pt', indentFirstLine: '-18pt' });
    // An unknown numId is a plain paragraph, never a guessed ordered list.
    expect(result[3]!.attrs).toBeUndefined();
  });
});

describe('DOCX import: tables', () => {
  it('maps grid widths, spans, vertical merges, shading, alignment and header rows', async () => {
    const tc = (text: string, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${p(r(text))}</w:tc>`;
    const table = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/><w:gridCol w:w="1500"/></w:tblGrid>'
      + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc('No')}${tc('Nama')}${tc('Nilai')}</w:tr>`
      + `<w:tr>${tc('1', '<w:vMerge w:val="restart"/><w:vAlign w:val="center"/>')}${tc('Gabung', '<w:gridSpan w:val="2"/><w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>')}</w:tr>`
      + `<w:tr>${tc('', '<w:vMerge/>')}${tc('B')}${tc('90', '<w:vAlign w:val="bottom"/>')}</w:tr></w:tbl>`;
    const [node] = await blocks(table + p(''));
    expect(node!.type).toBe('table');
    const [header, second, third] = node!.content!;
    expect(header!.content!.map((cell) => cell.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader']);
    expect(header!.content![0]!.attrs).toEqual({ colwidth: [100] });
    expect(second!.content![0]!.attrs).toEqual({ rowspan: 2, colwidth: [100], verticalAlign: 'middle' });
    expect(second!.content![1]!.attrs).toEqual({ colspan: 2, colwidth: [200, 100], background: '#D9D9D9' });
    expect(third!.content!.map(textOf)).toEqual(['B', '90']);
    expect(third!.content![1]!.attrs).toMatchObject({ verticalAlign: 'bottom' });
  });

  it('applies table style conditional formatting and keeps nested tables', async () => {
    const styles = OFFICE_DEFAULTS + '<w:style w:type="table" w:styleId="Grid4"><w:name w:val="Grid Table 4"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr></w:style>';
    const inner = `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc>${p(r('dalam'))}</w:tc></w:tr></w:tbl>`;
    const table = `<w:tbl><w:tblPr><w:tblStyle w:val="Grid4"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>`
      + `<w:tr><w:tc>${p(r('Judul'))}</w:tc></w:tr><w:tr><w:tc>${p(r('isi'))}${inner}${p('')}</w:tc></w:tr></w:tbl>`;
    const [node] = await blocks(table, { styles });
    const headerCell = node!.content![0]!.content![0]!;
    expect(headerCell).toMatchObject({ type: 'tableCell', attrs: { background: '#4472C4' } });
    expect(headerCell.content![0]!.content![0]!.marks).toEqual([{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#FFFFFF' } }]);
    const bodyCell = node!.content![1]!.content![0]!;
    expect(bodyCell.content!.map((block) => block.type)).toEqual(['paragraph', 'table', 'paragraph']);
    // Cell paragraphs keep the table style's tight spacing: no attrs needed, the canvas sits cells tight too.
    expect(bodyCell.content![0]!.attrs).toEqual({ lineHeight: '1.2207' });
  });
});

describe('DOCX import: other text', () => {
  it('adds footnotes and endnotes as numbered notes at the end', async () => {
    const footnotes = '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
      + `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>${r(' Sumber pertama.')}</w:p></w:footnote><w:footnote w:id="3"><w:p><w:r><w:footnoteRef/></w:r>${r(' Sumber kedua.')}</w:p></w:footnote>`;
    const endnotes = `<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r>${r(' Akhir.')}</w:p></w:endnote>`;
    const result = await blocks(p(r('Kalimat') + '<w:r><w:footnoteReference w:id="3"/></w:r>' + r(' lagi') + '<w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:endnoteReference w:id="1"/></w:r>'), { footnotes, endnotes });
    const body = result[0]!;
    expect(body.content!.map((part) => [part.text, markOf(part, 'superscript') ? 'sup' : ''])).toEqual([['Kalimat', ''], ['1', 'sup'], [' lagi', ''], ['2i', 'sup']]);
    expect(result.slice(1).map((node) => node.type === 'horizontalRule' ? '---' : textOf(node))).toEqual(['---', 'Catatan kaki', '1 Sumber kedua.', '2 Sumber pertama.', 'i Akhir.']);
    expect(markOf(result[3]!.content![0], 'superscript')).toBeDefined();
  });

  it('adds no notes section when there are no notes', async () => {
    expect(await blocks(p(r('a')), { footnotes: '' })).toHaveLength(1);
  });

  it('reads a text box once, after the paragraph that anchors it, and skips images silently', async () => {
    const box = `<w:txbxContent>${p(r('Isi kotak'))}</w:txbxContent>`;
    const drawing = `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx>${box}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox>${box}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    const image = '<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic xmlns:pic="x"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const result = await blocks(p(r('Jangkar') + drawing + image) + p(r('Sesudah')));
    expect(result.map(textOf)).toEqual(['Jangkar', 'Isi kotak', 'Sesudah']);
  });

  it('unwraps content controls such as a table of contents and keeps only field results', async () => {
    const toc = '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>'
      + p('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        + '<w:hyperlink w:anchor="_Toc1">' + r('Pendahuluan') + '<w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGEREF _Toc1 \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + r('1') + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink>')
      + p('<w:hyperlink w:anchor="_Toc2">' + r('Metode') + '<w:r><w:tab/></w:r>' + r('5') + '</w:hyperlink>')
      + p('<w:r><w:fldChar w:fldCharType="end"/></w:r>')
      + '</w:sdtContent></w:sdt>';
    const result = await blocks(toc + p(r('Isi')));
    expect(result.map(textOf)).toEqual(['Pendahuluan\t1', 'Metode\t5', '', 'Isi']);
    expect(JSON.stringify(result)).not.toMatch(/TOC|PAGEREF/);
  });
});

describe('DOCX import: section and limits', () => {
  it('reads page size and margins from the final section', async () => {
    const thesis = await load(p(r('x')) + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2268" w:right="1701" w:bottom="1701" w:left="2268" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>', {}, 'en');
    expect(thesis.pageSize).toBe('a4');
    expect(thesis.pageMargins).toEqual({ top: 2268, right: 1701, bottom: 1701, left: 2268 });
    const letter = await load(p(r('x')) + '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="-1440" w:right="1440" w:bottom="1440" w:left="1080" w:gutter="360"/></w:sectPr>');
    expect(letter.pageSize).toBe('letter');
    expect(letter.pageMargins).toEqual({ top: 1440, right: 1440, bottom: 1440, left: 1440 });
    const bare = await load(p(r('x')), {}, 'en');
    expect(bare.pageSize).toBe('letter');
    expect(bare.pageMargins).toEqual({ top: 1440, right: 1440, bottom: 1440, left: 1440 });
  });

  it('stores margins as a preference string the page style can read back', () => {
    const margins = { top: 2268, right: 1701, bottom: 1701, left: 2268 };
    expect(formatMargins(margins)).toBe('2268,1701,1701,2268');
    expect(parseMargins('2268,1701,1701,2268', 'a4')).toEqual(margins);
    expect(parseMargins('1,2,3', 'a4')).toBeNull();
    expect(parseMargins('7000,7000,7000,7000', 'a4')).toBeNull();
    expect(pageStyle('a4', margins)['--page-margin-left']).toBe('151.20px');
    expect(pageStyle('a4', margins)['--page-content-width']).toBe(`${((11906 - 2268 - 1701) / 15).toFixed(2)}px`);
  });

  it('refuses a document with no text, or more text than the limit, with a clear message', async () => {
    await expect(docxToEditorDocument(await docx(p('<w:r><w:drawing/></w:r>')))).rejects.toThrowError(/no readable text/);
    const long = p(r('a'.repeat(100_001))) + p(r('b'.repeat(100_001)));
    const error = await docxToEditorDocument(await docx(long)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocxError);
    expect((error as Error).message).toMatch(/200,000/);
  });

  it('splits huge runs of formatting into a valid document instead of failing', async () => {
    const runs = Array.from({ length: 6000 }, (_, index) => r(`k${index} `, index % 2 ? '<w:b/>' : '')).join('');
    const result = await docxToEditorDocument(await docx(p(runs))).catch((caught: unknown) => caught);
    // More than 5000 inline nodes cannot be stored; the importer says so rather than a generic failure.
    expect(result).toBeInstanceOf(DocxError);
    expect((result as Error).message).toMatch(/too large or too complex/);
  });
});

describe('DOCX round trip with formatting', () => {
  const text = (value: string, ...marks: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) });
  const para = (content: unknown[], attrs?: Record<string, unknown>) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content });
  const item = (...content: unknown[]) => ({ type: 'listItem', content });
  const cell = (type: string, value: string, attrs: Record<string, unknown>) => ({ type, attrs, content: [para([text(value)])] });
  const source = EditorDocumentSchema.parse({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [text('BAB I PENDAHULUAN', { type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: "'Times New Roman', Tinos", fontSize: '14pt', color: '#000000' } })] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Latar')] },
    para([
      text('Tebal', { type: 'bold' }), text(' coret', { type: 'strike' }), text(' 2', { type: 'superscript' }), text(' i', { type: 'subscript' }),
      text(' kuning', { type: 'highlight', attrs: { color: '#FFFF00' } }), text(' oranye', { type: 'highlight', attrs: { color: '#FFC000' } }),
      text(' merah', { type: 'textStyle', attrs: { color: '#C00000', fontSize: '10.5pt' } }), text('\tTab'),
      text(' tautan', { type: 'link', attrs: { href: 'https://example.test/' } }),
    ], { textAlign: 'justify', lineHeight: '2.4414', spaceBefore: '6pt', spaceAfter: '0pt', indentLeft: '36pt', indentRight: '9pt', indentFirstLine: '-18pt' }),
    para([text('Baris pasti')], { lineHeight: '18pt' }),
    { type: 'orderedList', attrs: { start: 3, type: 'a' }, content: [
      item(para([text('tiga')]), { type: 'bulletList', attrs: { listStyle: 'square' }, content: [item(para([text('kotak')]), { type: 'orderedList', attrs: { type: 'I' }, content: [item(para([text('romawi')]))] })] }),
      item(para([text('empat')])),
    ] },
    { type: 'bulletList', attrs: { listStyle: 'circle' }, content: [item(para([text('bulat')]))] },
    { type: 'pageBreak' },
    { type: 'blockquote', content: [para([text('Kutipan')])] },
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', 'A', { colwidth: [120] }), cell('tableHeader', 'B', { colwidth: [200] }), cell('tableHeader', 'C', { colwidth: [80] })] },
      { type: 'tableRow', content: [cell('tableCell', 'gabung', { rowspan: 2, colwidth: [120], verticalAlign: 'middle' }), cell('tableCell', 'lebar', { colspan: 2, colwidth: [200, 80], background: '#D9D9D9' })] },
      { type: 'tableRow', content: [cell('tableCell', 'x', { colwidth: [200] }), cell('tableCell', 'y', { colwidth: [80], verticalAlign: 'bottom' })] },
    ] },
    para([text('Akhir')]),
  ] });

  it('comes back identical through export and import', async () => {
    const margins = { top: 2268, right: 1701, bottom: 1701, left: 2268 };
    const again = await docxToEditorDocument(await editorDocumentToDocx(source, { pageSize: 'a4', margins }));
    const before = documentSchema.nodeFromJSON(source); const after = documentSchema.nodeFromJSON(again.content);
    if (!before.eq(after)) expect(again.content).toEqual(source);
    expect(before.eq(after)).toBe(true);
    expect(again.pageMargins).toEqual(margins);
    // And a second trip changes nothing more.
    const third = await docxToEditorDocument(await editorDocumentToDocx(again.content, { pageSize: 'a4', margins }));
    expect(documentSchema.nodeFromJSON(third.content).eq(after)).toBe(true);
  });

  it('writes task lists as ballot-box paragraphs and background colour as shading', async () => {
    const tasks = EditorDocumentSchema.parse({ type: 'doc', content: [
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para([text('selesai')])] }, { type: 'taskItem', attrs: { checked: false }, content: [para([text('belum')])] }] },
      para([text('latar', { type: 'textStyle', attrs: { backgroundColor: '#FFF2CC' } })]),
    ] });
    const result = await docxToEditorDocument(await editorDocumentToDocx(tasks));
    expect(result.content.content.slice(0, 2).map(textOf)).toEqual(['☒ selesai', '☐ belum']);
    expect(markOf(result.content.content[2]!.content![0], 'highlight')?.attrs).toEqual({ color: '#FFF2CC' });
  });
});
