// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { generateJSON, type JSONContent } from '@tiptap/core';
import { documentExtensions, documentSchema } from '../../src/lib/editor/extensions';
import { normalizePastedHtml, markerKind, plainTextSlice } from '../../src/lib/editor/paste-normalize';

const parse = (html: string) => generateJSON(normalizePastedHtml(html), documentExtensions) as JSONContent;
const find = (node: JSONContent, predicate: (node: JSONContent) => boolean): JSONContent[] => [
  ...(predicate(node) ? [node] : []), ...(node.content ?? []).flatMap((child) => find(child, predicate)),
];
const textNode = (doc: JSONContent, text: string) => find(doc, (node) => node.type === 'text' && !!node.text?.includes(text))[0];
const markOf = (node: JSONContent | undefined, type: string) => node?.marks?.find((mark) => mark.type === type);

const span = (style: string, text: string) => `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;${style}">${text}</span>`;
const docsParagraph = (content: string, style = '') => `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;${style}">${content}</p>`;
const docsItem = (level: number, type: string, text: string) => `<li dir="ltr" style="list-style-type:${type};font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;" aria-level="${level}">${docsParagraph(span('', text)).replace('<p dir', '<p role="presentation" dir')}</li>`;

const GOOGLE_DOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-3c1f7a2e-7fff-4b1d-9a2c-5e8d1f0b6a11">`
  + `<h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;">${span('font-size:16pt;', 'Judul Bagian')}</h2>`
  + docsParagraph(`${span('font-weight:700;', 'Tebal')}${span('font-style:italic;', 'Miring')}${span('text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;', 'Garis')}${span('text-decoration:line-through;', 'Coret')}${span('font-size:0.6em;vertical-align:super;', 'atas')}${span('font-size:0.6em;vertical-align:sub;', 'bawah')}`, 'text-align:justify;margin-left:36pt;text-indent:-18pt;')
  + docsParagraph(`${span('font-family:\'Times New Roman\',serif;font-size:14pt;color:#ff0000;background-color:#ffff00;', 'Serif merah')}<a href="https://example.test/docs" style="text-decoration:none;">${span('color:#1155cc;text-decoration:underline;', 'tautan')}</a>`)
  + `<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${docsItem(1, 'disc', 'Satu')}<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${docsItem(2, 'circle', 'Anak')}</ul>${docsItem(1, 'disc', 'Dua')}</ul>`
  + `<ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${docsItem(1, 'lower-alpha', 'Alfa')}${docsItem(1, 'lower-alpha', 'Beta')}</ol>`
  + `<hr style="page-break-before:always;display:none;">`
  + `<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="200" /><col width="424" /></colgroup><tbody><tr style="height:0pt">`
  + `<td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;vertical-align:top;background-color:#fce5cd;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;">${docsParagraph(span('', 'Sel A'))}</td>`
  + `<td style="border-left:solid #000000 1pt;vertical-align:middle;padding:5pt 5pt 5pt 5pt;">${docsParagraph(span('', 'Sel B'))}</td>`
  + `</tr></tbody></table></div></b><br class="Apple-interchange-newline">`;

describe('review: pasting from Google Docs keeps the source formatting', () => {
  const doc = parse(GOOGLE_DOCS);

  it('unwraps the guid wrapper and turns styled spans into marks', () => {
    expect(JSON.stringify(doc)).not.toContain('docs-internal-guid');
    expect(markOf(textNode(doc, 'Tebal'), 'bold')).toBeTruthy();
    // font-weight:400 on every Docs span is the default and must not become a mark.
    expect(markOf(textNode(doc, 'Miring'), 'bold')).toBeUndefined();
    expect(markOf(textNode(doc, 'Miring'), 'italic')).toBeTruthy();
    expect(markOf(textNode(doc, 'Garis'), 'underline')).toBeTruthy();
    expect(markOf(textNode(doc, 'Coret'), 'strike')).toBeTruthy();
    expect(markOf(textNode(doc, 'atas'), 'superscript')).toBeTruthy();
    expect(markOf(textNode(doc, 'bawah'), 'subscript')).toBeTruthy();
  });

  it('keeps exact fonts, sizes and colours, and skips transparent backgrounds', () => {
    expect(markOf(textNode(doc, 'Tebal'), 'textStyle')?.attrs).toMatchObject({ fontFamily: 'Arial', fontSize: '11pt', color: '#000000' });
    expect(markOf(textNode(doc, 'Tebal'), 'textStyle')?.attrs?.backgroundColor).toBeFalsy();
    expect(markOf(textNode(doc, 'Tebal'), 'highlight')).toBeUndefined();
    const serif = textNode(doc, 'Serif merah');
    expect(markOf(serif, 'textStyle')?.attrs).toMatchObject({ fontFamily: 'Times New Roman', fontSize: '14pt', color: '#ff0000' });
    expect(markOf(serif, 'highlight')?.attrs).toEqual({ color: '#ffff00' });
    const link = textNode(doc, 'tautan');
    expect(markOf(link, 'link')?.attrs?.href).toBe('https://example.test/docs');
    expect(markOf(link, 'underline')).toBeTruthy();
    expect(markOf(link, 'textStyle')?.attrs?.color).toBe('#1155cc');
  });

  it('keeps paragraph spacing, indents, alignment and heading levels', () => {
    const heading = find(doc, (node) => node.type === 'heading')[0]!;
    expect(heading.attrs).toMatchObject({ level: 2, lineHeight: '1.38', spaceBefore: '18pt', spaceAfter: '6pt' });
    const paragraph = find(doc, (node) => node.type === 'paragraph' && !!textNode(node, 'Tebal'))[0]!;
    expect(paragraph.attrs).toMatchObject({ textAlign: 'justify', lineHeight: '1.38', spaceBefore: '0pt', spaceAfter: '0pt', indentLeft: '36pt', indentFirstLine: '-18pt' });
  });

  it('nests the sibling sub-list into its item and keeps list types', () => {
    const bullet = find(doc, (node) => node.type === 'bulletList');
    expect(bullet[0]!.attrs?.listStyle).toBe('disc');
    expect(bullet[0]!.content).toHaveLength(2);
    const nested = bullet[0]!.content![0]!.content![1]!;
    expect(nested.type).toBe('bulletList');
    expect(nested.attrs?.listStyle).toBe('circle');
    expect(textNode(nested, 'Anak')).toBeTruthy();
    expect(find(doc, (node) => node.type === 'orderedList')[0]!.attrs?.type).toBe('a');
  });

  it('keeps the page break, column widths and cell shading', () => {
    expect(find(doc, (node) => node.type === 'pageBreak')).toHaveLength(1);
    const cells = find(doc, (node) => node.type === 'tableCell');
    expect(cells.map((cell) => cell.attrs?.colwidth)).toEqual([[200], [424]]);
    expect(cells[0]!.attrs).toMatchObject({ background: '#fce5cd', verticalAlign: 'top' });
    expect(cells[1]!.attrs).toMatchObject({ background: null, verticalAlign: 'middle' });
  });

  it('turns a flattened aria-level list back into nesting', () => {
    const flat = parse(`<ol>${docsItem(1, 'decimal', 'Induk')}${docsItem(2, 'lower-roman', 'Cabang')}${docsItem(1, 'decimal', 'Induk dua')}</ol>`);
    const outer = find(flat, (node) => node.type === 'orderedList')[0]!;
    expect(outer.content).toHaveLength(2);
    expect(outer.content![0]!.content![1]).toMatchObject({ type: 'orderedList', attrs: { type: 'i' } });
  });

  it('reads Docs checklists as task lists', () => {
    const tasks = parse(`<ul><li role="checkbox" aria-checked="true">${docsParagraph(span('', 'Selesai'))}</li><li role="checkbox" aria-checked="false">${docsParagraph(span('', 'Belum'))}</li></ul>`);
    expect(find(tasks, (node) => node.type === 'taskItem').map((item) => item.attrs?.checked)).toEqual([true, false]);
  });
});

const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->
<style><!--
 /* Style Definitions */
 p.MsoNormal, li.MsoNormal, div.MsoNormal {mso-style-parent:""; margin-top:0in; margin-right:0in; margin-bottom:8.0pt; margin-left:0in; line-height:107%; font-size:11.0pt; font-family:"Calibri",sans-serif; mso-fareast-font-family:Calibri;}
 p.MsoListParagraphCxSpFirst, li.MsoListParagraphCxSpFirst {margin-top:0in; margin-right:0in; margin-bottom:0in; margin-left:.5in; line-height:107%; font-size:11.0pt; font-family:"Calibri",sans-serif;}
 p.MsoListParagraphCxSpLast {margin-top:0in; margin-right:0in; margin-bottom:8.0pt; margin-left:.5in; line-height:107%; font-size:11.0pt; font-family:"Calibri",sans-serif;}
 @page WordSection1 {size:8.5in 11.0in; margin:1.0in 1.0in 1.0in 1.0in;}
 @list l0:level1 {mso-level-number-format:alpha-lower; mso-level-text:"%1\\.";}
--></style></head><body lang=EN-US style='tab-interval:.5in'><!--StartFragment-->
<p class=MsoNormal align=center style='text-align:center'><b><span style='font-size:14.0pt;line-height:107%;font-family:"Times New Roman",serif;color:#2F5496'>Laporan</span></b><o:p></o:p></p>
<p class=MsoNormal style='line-height:150%'><span style='background:yellow;mso-highlight:yellow'>Penting</span><span style='mso-tab-count:1'>&nbsp;&nbsp;&nbsp; </span>teks biasa<o:p>&nbsp;</o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-fareast-font-family:Calibri'><span style='mso-list:Ignore'>a.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Pertama<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:1.0in;mso-add-space:auto;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Sub butir<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span><span style='mso-list:Ignore'>b.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Kedua<o:p></o:p></p>
<p class=MsoNormal><span><br clear=all style='mso-special-character:line-break;page-break-before:always'></span></p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt'><tr>
<td width=144 valign=top style='width:1.5in;border:solid windowtext 1.0pt;background:#FFF2CC;mso-shading:white;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal>Kiri<o:p></o:p></p></td>
<td width=288 colspan=2 style='width:3.0in;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal>Kanan<o:p></o:p></p></td>
</tr></table>
<!--EndFragment--></body></html>`;

describe('review: pasting from Microsoft Word keeps the source formatting', () => {
  const doc = parse(WORD);

  it('drops Office markup and resolves the Normal style into real attrs', () => {
    expect(JSON.stringify(doc)).not.toMatch(/mso-|o:p|StartFragment|OfficeDocumentSettings/u);
    const title = find(doc, (node) => node.type === 'paragraph' && !!textNode(node, 'Laporan'))[0]!;
    expect(title.attrs).toMatchObject({ textAlign: 'center', spaceAfter: '8pt', lineHeight: '107%' });
    const run = textNode(doc, 'Laporan');
    expect(markOf(run, 'bold')).toBeTruthy();
    expect(markOf(run, 'textStyle')?.attrs).toMatchObject({ fontFamily: 'Times New Roman', fontSize: '14pt', color: '#2F5496' });
    // Text without its own span inherits the Normal style's font.
    expect(markOf(textNode(doc, 'teks biasa'), 'textStyle')?.attrs).toMatchObject({ fontFamily: 'Calibri', fontSize: '11pt' });
  });

  it('keeps highlight, line height and tabs', () => {
    expect(markOf(textNode(doc, 'Penting'), 'highlight')?.attrs).toEqual({ color: 'yellow' });
    const paragraph = find(doc, (node) => node.type === 'paragraph' && !!textNode(node, 'Penting'))[0]!;
    expect(paragraph.attrs?.lineHeight).toBe('150%');
    expect(find(paragraph, (node) => node.type === 'text').map((node) => node.text).join('')).toContain('\t');
  });

  it('rebuilds mso-list paragraphs as nested typed lists without the typed markers', () => {
    const ordered = find(doc, (node) => node.type === 'orderedList');
    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.attrs).toMatchObject({ type: 'a', start: 1 });
    expect(ordered[0]!.content).toHaveLength(2);
    const nested = ordered[0]!.content![0]!.content![1]!;
    expect(nested).toMatchObject({ type: 'bulletList', attrs: { listStyle: 'circle' } });
    expect(textNode(nested, 'Sub butir')).toBeTruthy();
    const text = JSON.stringify(doc);
    expect(text).not.toContain('"a.');
    expect(text).not.toMatch(/"text":"o"/u);
    // The hanging indent belonged to the marker, not the item text.
    expect(find(ordered[0]!, (node) => node.type === 'paragraph')[0]!.attrs?.indentFirstLine).toBeNull();
  });

  it('keeps the page break, cell widths, spans and shading', () => {
    expect(find(doc, (node) => node.type === 'pageBreak')).toHaveLength(1);
    const cells = find(doc, (node) => node.type === 'tableCell');
    expect(cells[0]!.attrs).toMatchObject({ colwidth: [144], background: '#FFF2CC', verticalAlign: 'top' });
    expect(cells[1]!.attrs).toMatchObject({ colspan: 2, colwidth: [144, 144] });
  });

  it('classifies Word markers by their shape', () => {
    expect(markerKind('3.')).toMatchObject({ ordered: true, type: '1', start: 3 });
    expect(markerKind('iv.')).toMatchObject({ ordered: true, type: 'i', start: 4 });
    expect(markerKind('C)')).toMatchObject({ ordered: true, type: 'A', start: 3 });
    expect(markerKind('·')).toMatchObject({ ordered: false, bullet: 'disc' });
    expect(markerKind('§')).toMatchObject({ ordered: false, bullet: 'square' });
  });
});

describe('review: pasting web HTML is sanitized but keeps its formatting', () => {
  const html = `<div onclick="steal()"><script>alert(1)</script><style>p{color:red}</style><h3>Judul</h3><p style="text-align:center" onmouseover="x()">Halo <b>dunia</b> <a href="javascript:alert(1)">jahat</a> <a href="https://example.test/ok" target="_blank">aman</a><img src="x.png" alt="gambar"></p><iframe srcdoc="x"></iframe><form><input value="x"></form><p><font color="#336699" face="Georgia">warna</font></p></div>`;
  const output = normalizePastedHtml(html);
  const doc = generateJSON(output, documentExtensions) as JSONContent;

  it('removes scripts, handlers, frames, forms, images and unsafe links', () => {
    expect(output).not.toMatch(/script|onclick|onmouseover|iframe|<form|<input|<img|javascript:|target=/iu);
    expect(markOf(textNode(doc, 'jahat'), 'link')).toBeUndefined();
    expect(markOf(textNode(doc, 'aman'), 'link')?.attrs?.href).toBe('https://example.test/ok');
  });

  it('keeps semantic tags and inline styles', () => {
    expect(find(doc, (node) => node.type === 'heading')[0]!.attrs?.level).toBe(3);
    expect(find(doc, (node) => node.type === 'paragraph')[0]!.attrs?.textAlign).toBe('center');
    expect(markOf(textNode(doc, 'dunia'), 'bold')).toBeTruthy();
    expect(markOf(textNode(doc, 'warna'), 'textStyle')?.attrs).toMatchObject({ color: '#336699', fontFamily: 'Georgia' });
  });
});

describe('review: pasting plain text keeps blank lines and tabs', () => {
  it('makes one paragraph per line, including the empty ones', () => {
    const doc = documentSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] });
    const slice = plainTextSlice('Satu\tdua\r\n\r\nTiga\n', doc.resolve(1));
    const lines: string[] = [];
    slice.content.forEach((node) => { lines.push(`${node.type.name}:${node.textContent}`); });
    expect(lines).toEqual(['paragraph:Satu\tdua', 'paragraph:', 'paragraph:Tiga']);
    // Open ends let a single line merge into the paragraph at the cursor.
    expect(slice.openStart).toBe(1);
  });
});
