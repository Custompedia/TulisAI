import { zip } from '../../src/lib/docx/zip';

// Builds .docx packages inside the tests, so no large binary is committed. `docxPackage` takes raw WordprocessingML;
// `thesisDocx` writes a long thesis the way Word lays one out (rsid attributes, split runs, Times New Roman 12 pt at
// 1.5 lines, chapters on new pages, pictures in every wrap mode).

export const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"', 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"', 'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:v="urn:schemas-microsoft-com:vml"', 'xmlns:o="urn:schemas-microsoft-com:office:office"', 'xmlns:w10="urn:schemas-microsoft-com:office:word"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"', 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
].join(' ');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const encode = (value: string) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`);

export type PackageParts = { styles?: string; media?: Array<{ id: string; name: string; bytes: Uint8Array }> };

export async function docxPackage(body: string, parts: PackageParts = {}): Promise<Uint8Array> {
  const media = parts.media ?? [];
  const rels = [
    parts.styles !== undefined && `<Relationship Id="rS" Type="${REL}/styles" Target="styles.xml"/>`,
    ...media.map((item) => `<Relationship Id="${item.id}" Type="${REL}/image" Target="media/${item.name}"/>`),
  ].filter(Boolean).join('');
  return zip([
    // Real content types, so the same package also opens in Word (the browser check compares page counts with it).
    { name: '[Content_Types].xml', data: encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' + (parts.styles !== undefined ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' : '') + '</Types>') },
    { name: '_rels/.rels', data: encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: 'word/document.xml', data: encode(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) },
    { name: 'word/_rels/document.xml.rels', data: encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`) },
    ...(parts.styles !== undefined ? [{ name: 'word/styles.xml', data: encode(`<w:styles ${NS}>${parts.styles}</w:styles>`) }] : []),
    ...media.map((item) => ({ name: `word/media/${item.name}`, data: item.bytes })),
  ]);
}

export const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
export const r = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

// DrawingML picture frames; sizes in EMU (12,700 per point).
const graphic = (id: string) => `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
export const inlinePicture = (cx: number, cy: number, id = 'rImg1') =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Gambar"/>${graphic(id)}</wp:inline></w:drawing></w:r>`;
export type AnchorWrap = 'topAndBottom' | 'square' | 'tight' | 'none' | 'behind' | 'front';
export const anchoredPicture = (cx: number, cy: number, wrap: AnchorWrap, options: { align?: 'left' | 'right' | 'center'; offset?: number; dist?: number; id?: string } = {}) => {
  const dist = options.dist ?? 0;
  const wrapXml = wrap === 'topAndBottom' ? '<wp:wrapTopAndBottom/>' : wrap === 'square' ? '<wp:wrapSquare wrapText="bothSides"/>' : wrap === 'tight' ? '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/></wp:wrapPolygon></wp:wrapTight>' : '<wp:wrapNone/>';
  const horizontal = options.align ? `<wp:align>${options.align}</wp:align>` : `<wp:posOffset>${options.offset ?? 0}</wp:posOffset>`;
  return `<w:r><w:drawing><wp:anchor distT="${dist}" distB="${dist}" distL="${dist}" distR="${dist}" simplePos="0" relativeHeight="2" behindDoc="${wrap === 'behind' ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">${horizontal}</wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrapXml}<wp:docPr id="2" name="Gambar"/>${graphic(options.id ?? 'rImg1')}</wp:anchor></w:drawing></w:r>`;
};

// Thesis defaults: Times New Roman 12 pt, 1.5 lines, nothing after, justified with a 1.27 cm first-line indent.
export const THESIS_STYLES = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="720"/></w:pPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`;

const WORDS = 'penelitian ini bertujuan untuk menganalisis pengaruh variabel kepemimpinan terhadap kinerja karyawan pada perusahaan yang diteliti dengan metode kuantitatif deskriptif serta sampel sebanyak seratus responden yang dipilih secara acak “sederhana” — hasilnya menunjukkan hubungan positif dan signifikan'.split(' ');
export function sentence(seed: number, length: number): string {
  let text = ''; let index = seed;
  while (text.length < length) { text += `${WORDS[index % WORDS.length]} `; index = (index * 7 + 3) % 9973; }
  return `${text.trim()}.`;
}

// `picture`: 'noise' gives the package a real picture's weight; 'png' a tiny valid PNG that Word can draw.
export type ThesisOptions = { pages: number; charactersPerPage?: number; pictures?: boolean; mediaBytes?: number; picture?: 'noise' | 'png' };
export type ThesisStats = { paragraphs: number; characters: number; breaks: { pageBreak: number; pageBreakBefore: number; sectionNextPage: number; sectionOddPage: number; sectionEvenPage: number }; pictures: number };

// A Word-shaped thesis: every paragraph split into three runs (one italic) with rsid attributes, as Word saves them.
// A chapter (Heading 1, pageBreakBefore) every 20 pages; a manual page break, and section breaks of the three page
// kinds, rotate through the chapters; with `pictures`, one picture every 10 paragraphs in every wrap mode.
export async function thesisDocx(options: ThesisOptions): Promise<{ bytes: Uint8Array; stats: ThesisStats }> {
  const perPage = options.charactersPerPage ?? 4000;
  const target = options.pages * perPage;
  const parts: string[] = [];
  const stats: ThesisStats = { paragraphs: 0, characters: 0, breaks: { pageBreak: 0, pageBreakBefore: 0, sectionNextPage: 0, sectionOddPage: 0, sectionEvenPage: 0 }, pictures: 0 };
  const sectPr = (type?: string) => `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2268" w:right="1701" w:bottom="1701" w:left="2268" w:header="709" w:footer="709" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
  const wraps: Array<() => string> = [
    () => inlinePicture(3_600_000, 2_400_000), () => anchoredPicture(3_000_000, 1_800_000, 'topAndBottom', { dist: 114300 }),
    () => anchoredPicture(1_800_000, 1_200_000, 'square', { align: 'right', dist: 114300 }), () => anchoredPicture(2_400_000, 2_400_000, 'behind'),
  ];
  let chapter = 0; let index = 0;
  while (stats.characters < target) {
    if (index % Math.max(1, Math.round((20 * perPage) / 600)) === 0) {
      chapter++;
      parts.push(`<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>BAB ${chapter}</w:t></w:r></w:p>`);
      stats.breaks.pageBreakBefore++; stats.paragraphs++;
    }
    const text = sentence(index, 560);
    parts.push(`<w:p w14:paraId="1A2B3C4D" w14:textId="77777777" w:rsidR="00A1B2C3" w:rsidRDefault="00D4E5F6" w:rsidP="00A1B2C3"><w:r w:rsidRPr="00D4E5F6"><w:t xml:space="preserve">${text.slice(0, 220)}</w:t></w:r><w:proofErr w:type="spellStart"/><w:r w:rsidRPr="00D4E5F6"><w:rPr><w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">${text.slice(220, 260)}</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r><w:t xml:space="preserve">${text.slice(260)}</w:t></w:r></w:p>`);
    stats.characters += text.length; stats.paragraphs++; index++;
    if (options.pictures && index % 10 === 5) { parts.push(`<w:p>${wraps[stats.pictures % wraps.length]!()}</w:p>`); stats.pictures++; stats.paragraphs++; }
    if (index % 150 === 75) {
      const kind = (index / 150 | 0) % 4;
      if (kind === 0) { parts.push(`<w:p><w:r><w:t xml:space="preserve">Akhir bagian.</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>`); stats.breaks.pageBreak++; stats.characters += 13; }
      else { const type = ['nextPage', 'oddPage', 'evenPage'][kind - 1]!; parts.push(`<w:p><w:pPr>${sectPr(type)}</w:pPr></w:p>`); stats.breaks[type === 'nextPage' ? 'sectionNextPage' : type === 'oddPage' ? 'sectionOddPage' : 'sectionEvenPage']++; }
      stats.paragraphs++;
    }
  }
  const body = parts.join('') + sectPr();
  const media = options.pictures ? [{ id: 'rImg1', name: 'image1.png', bytes: options.picture === 'png' ? PNG : noise(options.mediaBytes ?? 2_000_000) }] : [];
  return { bytes: await docxPackage(body, { styles: THESIS_STYLES, media }), stats };
}

// Incompressible bytes standing in for a picture, so the package has a picture's weight.
export function noise(size: number): Uint8Array {
  const bytes = new Uint8Array(size); let state = 0x9e3779b9;
  for (let index = 0; index < size; index++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; bytes[index] = state & 0xff; }
  return bytes;
}

// A 1 x 1 grey PNG.
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCB3UNq9AAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));
