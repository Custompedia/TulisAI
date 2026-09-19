import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { documentXml, editorDocumentToDocx } from '../../src/lib/docx/export';
import { docxToEditorDocument } from '../../src/lib/docx/import';
import { unzip } from '../../src/lib/docx/zip';
import { cssBorder, parseCssBorder } from '../../src/lib/docx/borders';
import { asRunningText, renderRunning, runningParts } from '../../src/lib/docx/running';
import { pageGeometry, pageStyle } from '../../src/lib/docx/office-defaults';
import { documentSchema } from '../../src/lib/editor/extensions';
import { applyCellBorders } from '../../src/lib/editor/extensions/table-style';
import { formatTabStops, parseTabStops } from '../../src/lib/editor/extensions/paragraph-format';
import { anchorFromText } from '../../src/lib/editor/extensions/anchors';
import { layoutPreferences, readLayout } from '../../src/components/workspace/page-layout';
import type { EditorNode } from '../../src/lib/editor/document';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = (text: string, attrs?: Record<string, unknown>) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });
const cell = (text: string, attrs?: Record<string, unknown>) => ({ type: 'tableCell', ...(attrs ? { attrs } : {}), content: [paragraph(text)] });
const table = (rows: unknown[][], attrs?: Record<string, unknown>) => ({ type: 'table', ...(attrs ? { attrs } : {}), content: rows.map((row) => ({ type: 'tableRow', content: row })) });

const decode = async (bytes: Uint8Array, name: string) => {
  const files = await unzip(bytes);
  const part = files.get(name);
  return part ? new TextDecoder().decode(part) : '';
};
const find = (nodes: EditorNode[], type: string): EditorNode | undefined => {
  for (const node of nodes) {
    if (node.type === type) return node;
    const inner = node.content ? find(node.content, type) : undefined;
    if (inner) return inner;
  }
  return undefined;
};

describe('DOCX: table borders', () => {
  it('writes only the sides a cell states, and reads them back', async () => {
    const value = doc(table([[cell('a', { borderBottom: '2.25pt dashed #ff0000' }), cell('b')]]));
    const { xml } = documentXml(value, 'a4');
    expect(xml).toContain('<w:tcBorders><w:bottom w:val="dashed" w:sz="18" w:space="0" w:color="FF0000"/></w:tcBorders>');
    // The cell that says nothing inherits the table default, so it must not carry a w:tcBorders of its own.
    expect(xml.match(/<w:tcBorders>/g)).toHaveLength(1);

    const back = await docxToEditorDocument(await editorDocumentToDocx(value));
    const cells = find(back.content.content, 'tableRow')!.content!;
    expect(cells[0]!.attrs!.borderBottom).toBe('2.25pt dashed #ff0000');
    expect(cells[1]!.attrs?.borderBottom).toBeUndefined();
  });

  it('keeps a removed line as a real "none" through a round trip', async () => {
    const value = doc(table([[cell('a', { borderTop: 'none', borderRight: 'none' }), cell('b')]]));
    expect(documentXml(value, 'a4').xml).toContain('<w:top w:val="nil"/>');
    const back = await docxToEditorDocument(await editorDocumentToDocx(value));
    expect(find(back.content.content, 'tableCell')!.attrs!.borderTop).toBe('none');
  });

  it('reads the table default onto the cells that differ from the canvas grid', async () => {
    const value = doc(table([[cell('a'), cell('b')]]));
    const bytes = await editorDocumentToDocx(value);
    const back = await docxToEditorDocument(bytes);
    // Exported tables use Word's 0.5 pt grid, which is exactly what the canvas draws, so nothing is stored.
    expect(find(back.content.content, 'tableCell')!.attrs?.borderTop).toBeUndefined();
  });

  it('parses the border shorthands a pasted table brings and normalises them', () => {
    expect(parseCssBorder('1px solid rgb(255, 0, 0)')).toEqual({ width: 0.75, style: 'solid', color: '#ff0000' });
    expect(parseCssBorder('none')).toBeNull();
    expect(parseCssBorder('0px')).toBeNull();
    expect(parseCssBorder('inherit')).toBeUndefined();
    expect(cssBorder({ width: 1.5, style: 'dotted', color: '#123ABC' })).toBe('1.5pt dotted #123abc');
  });
});

describe('editor: cell border command', () => {
  const state = () => {
    const value = documentSchema.nodeFromJSON(doc(table([[cell('a'), cell('b')], [cell('c'), cell('d')]])));
    const created = EditorState.create({ doc: value });
    // Caret inside the first cell, which is what the toolbar acts on when nothing is selected.
    return created.apply(created.tr.setSelection(TextSelection.near(created.doc.resolve(4))));
  };

  it('applies a scope to the sides of the selected cell only', () => {
    const before = state();
    const tr = before.tr;
    expect(applyCellBorders(before, tr, 'all', { width: 1, style: 'solid', color: '#000000' })).toBe(true);
    const after = before.apply(tr);
    expect(after.doc.child(0).child(0).child(0).attrs.borderTop).toBe('1pt solid #000000');
    expect(after.doc.child(0).child(0).child(1).attrs.borderTop).toBeNull();
  });

  it('paints every cell of the table when asked, and outer sides only on the edges', () => {
    const before = state();
    const tr = before.tr;
    applyCellBorders(before, tr, 'outer', null, true);
    const after = before.apply(tr);
    const topLeft = after.doc.child(0).child(0).child(0);
    const bottomRight = after.doc.child(0).child(1).child(1);
    expect([topLeft.attrs.borderTop, topLeft.attrs.borderLeft]).toEqual(['none', 'none']);
    expect(topLeft.attrs.borderBottom).toBeNull();
    expect([bottomRight.attrs.borderBottom, bottomRight.attrs.borderRight]).toEqual(['none', 'none']);
  });
});

describe('DOCX: table placement', () => {
  it('writes the alignment and the fit-to-contents width, and reads them back', async () => {
    const value = doc(table([[cell('a', { colwidth: [80] }), cell('b', { colwidth: [80] })]], { align: 'center', width: 'auto' }));
    const { xml } = documentXml(value, 'a4');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:tblW w:w="0" w:type="auto"/>');
    const back = await docxToEditorDocument(await editorDocumentToDocx(value));
    expect(find(back.content.content, 'table')!.attrs).toEqual({ align: 'center', width: 'auto' });
  });

  it('leaves a full-width table alone', async () => {
    const value = doc(table([[cell('a'), cell('b')]]));
    expect(documentXml(value, 'a4').xml).toContain('<w:tblW w:w="5000" w:type="pct"/>');
    const back = await docxToEditorDocument(await editorDocumentToDocx(value));
    expect(find(back.content.content, 'table')!.attrs).toBeUndefined();
  });
});

describe('DOCX: page setup', () => {
  it('turns the sheet for landscape and states the column count', async () => {
    const bytes = await editorDocumentToDocx(doc(paragraph('x')), { pageSize: 'a4', orientation: 'landscape', columns: 2 });
    const xml = await decode(bytes, 'word/document.xml');
    expect(xml).toContain('w:w="16838"');
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('<w:cols w:num="2" w:space="720" w:equalWidth="1"/>');
    const back = await docxToEditorDocument(bytes);
    expect([back.orientation, back.columns]).toEqual(['landscape', 2]);
  });

  it('keeps portrait and one column as the default', async () => {
    const back = await docxToEditorDocument(await editorDocumentToDocx(doc(paragraph('x'))));
    expect([back.orientation, back.columns]).toEqual(['portrait', 1]);
  });

  it('publishes the turned sheet and the column gap to the canvas', () => {
    const style = pageStyle({ size: 'a4', orientation: 'landscape', columns: 2 });
    expect(style['--page-width']).toBe('1122.53px');
    expect(style['--page-column-count']).toBe('2');
    expect(pageGeometry('a4', 'landscape').width).toBe(16838);
  });

  it('round-trips the stored layout preferences', () => {
    const layout = readLayout(layoutPreferences({
      size: 'letter', margins: { top: 720, right: 720, bottom: 720, left: 720 }, orientation: 'landscape', columns: 3,
      header: { text: 'Bab {page}', align: 'center' }, footer: null,
    }), 'id');
    expect(layout).toEqual({
      size: 'letter', margins: { top: 720, right: 720, bottom: 720, left: 720 }, orientation: 'landscape', columns: 3,
      header: { text: 'Bab {page}', align: 'center' }, footer: null,
    });
  });
});

describe('DOCX: header and footer', () => {
  it('writes a header part with a real PAGE field and reads the token back', async () => {
    const bytes = await editorDocumentToDocx(doc(paragraph('isi')), {
      header: { text: 'Skripsi', align: 'right' }, footer: { text: 'Halaman {page} dari {pages}', align: 'center' },
    });
    const files = await unzip(bytes);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['word/header1.xml', 'word/footer1.xml']));
    const footer = await decode(bytes, 'word/footer1.xml');
    expect(footer).toContain('NUMPAGES');
    expect(await decode(bytes, '[Content_Types].xml')).toContain('/word/footer1.xml');
    expect(await decode(bytes, 'word/document.xml')).toContain('<w:footerReference w:type="default" r:id="rId4"/>');

    const back = await docxToEditorDocument(bytes);
    expect(back.header).toEqual({ text: 'Skripsi', align: 'right' });
    expect(back.footer).toEqual({ text: 'Halaman {page} dari {pages}', align: 'center' });
  });

  it('writes no header part when there is no header', async () => {
    const files = await unzip(await editorDocumentToDocx(doc(paragraph('isi'))));
    expect(files.has('word/header1.xml')).toBe(false);
  });

  it('renders the tokens for a given sheet and splits them for the writer', () => {
    expect(renderRunning('Hal {page}/{pages}', 3, 9)).toBe('Hal 3/9');
    expect(runningParts('a{page}b').map((part) => part.kind)).toEqual(['text', 'field', 'text']);
    expect(asRunningText('   ', 'center')).toBeNull();
    expect(asRunningText('Judul\nbaris', 'nonsense')).toEqual({ text: 'Judul baris', align: 'left' });
  });
});

describe('DOCX: footnotes', () => {
  it('writes the note into footnotes.xml and brings it back on the marker', async () => {
    const value = doc({ type: 'paragraph', content: [{ type: 'text', text: 'Klaim' }, { type: 'footnote', attrs: { text: 'Sumber, 2020.' } }] });
    const bytes = await editorDocumentToDocx(value);
    const notes = await decode(bytes, 'word/footnotes.xml');
    expect(notes).toContain('w:type="separator"');
    expect(notes).toContain('Sumber, 2020.');
    expect(await decode(bytes, 'word/document.xml')).toContain('<w:footnoteReference w:id="1"/>');

    const back = await docxToEditorDocument(bytes);
    const note = find(back.content.content, 'footnote');
    expect(note!.attrs!.text).toBe('Sumber, 2020.');
  });
});

describe('DOCX: table of contents and bookmarks', () => {
  it('exports the entries inside a TOC field and bookmarks every heading it links to', async () => {
    const value = doc(
      { type: 'tableOfContents', content: [paragraph('Pendahuluan'), paragraph('Metode', { indentLeft: '18pt' })] },
      { type: 'heading', attrs: { level: 1, id: '_pendahuluan' }, content: [{ type: 'text', text: 'Pendahuluan' }] },
    );
    const { xml } = documentXml(value, 'a4');
    expect(xml).toContain('TOC \\o "1-3" \\h \\z \\u');
    expect(xml).toContain('w:fldCharType="separate"');
    expect(xml).toContain('<w:bookmarkStart w:id="1" w:name="_pendahuluan"/>');

    const back = await docxToEditorDocument(await editorDocumentToDocx(value));
    const toc = find(back.content.content, 'tableOfContents');
    expect(toc!.content!.map((entry) => entry.content![0]!.text)).toEqual(['Pendahuluan', 'Metode']);
    expect(find(back.content.content, 'heading')!.attrs!.id).toBe('_pendahuluan');
  });

  it('builds a unique anchor per heading text', () => {
    const taken = new Set<string>();
    expect(anchorFromText('Bab I: Pendahuluan', taken)).toBe('_bab_i_pendahuluan');
    expect(anchorFromText('Bab I: Pendahuluan', taken)).toBe('_bab_i_pendahuluan_2');
    expect(anchorFromText('※', taken)).toBe('_heading');
  });
});

describe('DOCX: tab stops', () => {
  it('writes the stops in twips and reads them back in points', async () => {
    const value = doc(paragraph('a\tb', { tabStops: '36pt:left,180pt:right' }));
    expect(documentXml(value, 'a4').xml).toContain('<w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:pos="3600"/></w:tabs>');
    const back = await docxToEditorDocument(await editorDocumentToDocx(value));
    expect(back.content.content[0]!.attrs!.tabStops).toBe('36pt:left,180pt:right');
  });

  it('sorts, dedupes and caps what it stores', () => {
    expect(formatTabStops([{ position: 180, align: 'right' }, { position: 36, align: 'left' }, { position: 36, align: 'center' }])).toBe('36pt:center,180pt:right');
    expect(formatTabStops([])).toBeNull();
    expect(parseTabStops('36pt:left')).toEqual([{ position: 36, align: 'left' }]);
    expect(parseTabStops('nonsense')).toEqual([]);
  });
});
