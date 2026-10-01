// A tiny PDF writer for tests: Helvetica text at fixed positions, optional inline images, metadata and a fake
// /Encrypt dictionary. It writes a correct xref table, so the reader takes the normal path, not its repair path.

export type PdfText = { x: number; y: number; text: string; size?: number };
export type PdfPage = { texts?: PdfText[]; image?: boolean; width?: number; height?: number };
export type PdfOptions = { title?: string; encrypted?: boolean };

// WinAnsiEncoding for the few non-Latin-1 characters the tests use; Latin-1 maps to itself.
const WIN_ANSI: Record<string, number> = { '•': 0x95, '–': 0x96, '—': 0x97, '“': 0x93, '”': 0x94, '’': 0x92 };
const encode = (text: string) => [...text].map((char) => String.fromCharCode(WIN_ANSI[char] ?? char.charCodeAt(0))).join('');
const literal = (text: string) => `(${encode(text).replace(/[\\()]/g, (char) => `\\${char}`)})`;

function contentStream(page: PdfPage): string {
  const parts: string[] = [];
  for (const item of page.texts ?? []) parts.push(`BT /F1 ${item.size ?? 11} Tf 1 0 0 1 ${item.x} ${item.y} Tm ${literal(item.text)} Tj ET`);
  // A one-pixel grey image stretched over most of the page stands in for a scanned sheet.
  if (page.image) parts.push('q 500 0 0 700 50 70 cm BI /W 1 /H 1 /CS /G /BPC 8 ID \x80 EI Q');
  return parts.join('\n');
}

export function buildPdf(pages: PdfPage[], options: PdfOptions = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add('');
  const pagesRef = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const page of pages) {
    const stream = contentStream(page);
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${page.width ?? 595} ${page.height ?? 842}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`;
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = options.title ? add(`<< /Title ${literal(options.title)} >>`) : 0;
  // Standard security handler values that no password opens: the reader asks for a password, as with a real locked file.
  const encrypt = options.encrypted ? add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> >>`) : 0;

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  const id = '0123456789abcdef0123456789abcdef';
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''}${encrypt ? ` /Encrypt ${encrypt} 0 R` : ''} /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (char) => char.charCodeAt(0));
}
