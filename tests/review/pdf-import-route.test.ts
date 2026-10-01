import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnv } from '../helpers/d1';
import { buildPdf } from '../helpers/pdf';

// The import route against a real (in-memory) D1: real entitlements, real plan periods, real portability evidence.
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown>, user: 'pro' }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));
vi.mock('@/server/auth/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/auth/auth')>()), requireUser: async () => ({ id: state.user }) }));

import { POST } from '@/app/api/documents/import/route';
import { adminActivatePlan } from '@/server/access/periods';
import { createDocument } from '@/server/documents/service';
import { zip } from '@/lib/docx/zip';

let db: ReturnType<typeof testEnv>['db'];
beforeEach(async () => {
  const setup = testEnv();
  state.env = setup.env; db = setup.db;
  setup.addUser('admin', 'admin'); setup.addUser('free'); setup.addUser('plus'); setup.addUser('pro');
  await adminActivatePlan({ actorId: 'admin', ownerId: 'plus', plan: 'plus' });
  await adminActivatePlan({ actorId: 'admin', ownerId: 'pro', plan: 'pro' });
  state.user = 'pro';
});

const call = (body: Uint8Array, type = 'application/pdf') => POST(new Request('https://tulis.test/api/documents/import?language=id', {
  method: 'POST', headers: { 'Content-Type': type, 'Content-Length': String(body.byteLength) }, body,
}));
const textPdf = () => buildPdf([{ texts: [
  { x: 72, y: 780, text: 'Rencana Kerja', size: 20 },
  { x: 72, y: 750, text: 'Paragraf pembuka yang cukup panjang untuk' }, { x: 72, y: 736, text: 'dibaca sebagai teks biasa.' },
] }]);
const count = (table: string) => (db.prepare(`SELECT COUNT(1) AS n FROM ${table}`).get() as { n: number }).n;

async function docx(text: string): Promise<Uint8Array> {
  const encode = (value: string) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`);
  return zip([
    { name: '[Content_Types].xml', data: encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: 'word/document.xml', data: encode(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`) },
  ]);
}

describe('PDF import route', () => {
  it('extracts a text PDF for Pro with the same shape as DOCX, and no DOCX import receipt', async () => {
    const response = await call(textPdf());
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: Record<string, unknown> };
    expect(data).toMatchObject({ format: 'pdf', title: 'Rencana Kerja', pageSize: 'a4', orientation: 'portrait', columns: 1, header: null, footer: null, pages: { total: 1, read: 1, empty: 0 } });
    expect(data.warnings).toContain('pdfLayout');
    expect(data).not.toHaveProperty('docxImportReceipt');
    expect(count('pending_docx_import_evidence')).toBe(0);

    // The notebook made from it carries no portability evidence, so it never unlocks DOCX export after a downgrade.
    const created = await createDocument('pro', { title: 'Rencana Kerja', language: 'id', content: data.content as never, preferences: { advanced: true } });
    expect(created.id).toBeTruthy();
    expect(count('document_portability_evidence')).toBe(0);
  });

  it('still issues the DOCX receipt for a DOCX file', async () => {
    // The local admin authority: plan periods (payment, admin_grant) need the CHECK widened by migration 0018 (PR #22).
    state.user = 'admin';
    const response = await call(await docx('Isi dokumen Word.'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: Record<string, unknown> };
    expect(data.format).toBe('docx');
    expect(typeof data.docxImportReceipt).toBe('string');
    expect(count('pending_docx_import_evidence')).toBe(1);
  });

  it('recognises a PDF by its header even when the browser sends another type', async () => {
    const response = await call(textPdf(), 'application/octet-stream');
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { format: string } }).data.format).toBe('pdf');
  });

  it.each(['free', 'plus'])('refuses %s below Pro with FEATURE_LOCKED', async (user) => {
    state.user = user;
    const response = await call(textPdf());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({ code: 'FEATURE_LOCKED', details: { feature: 'docx_import', requiredTier: 'pro' } });
  });

  it('answers a scan with 422 PDF_SCANNED', async () => {
    const response = await call(buildPdf([{ image: true }, { image: true }]));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('PDF_SCANNED');
  });

  it('answers a password-protected PDF with 422 PDF_ENCRYPTED', async () => {
    const response = await call(buildPdf([{ texts: [{ x: 72, y: 700, text: 'Rahasia.' }] }], { encrypted: true }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('PDF_ENCRYPTED');
  });

  it('answers a corrupt PDF with 422 PDF_UNREADABLE', async () => {
    const response = await call(new TextEncoder().encode('%PDF-1.7\nini bukan isi PDF yang sah'));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('PDF_UNREADABLE');
  });

  it('takes a PDF up to 10 MB and refuses more with 413', async () => {
    const big = new Uint8Array(10_000_001); big.set(new TextEncoder().encode('%PDF-1.4\n'));
    expect((await call(big)).status).toBe(413);
    // 6 MB is over the DOCX cap but inside the PDF one, so it is read (and found unreadable), not refused for size.
    const padded = new Uint8Array(6_000_000); padded.set(textPdf().slice(0, 100));
    expect((await call(padded)).status).toBe(422);
  });

  it('never answers bad input with a 500', async () => {
    const valid = textPdf();
    let seed = 7;
    const random = (length: number) => Uint8Array.from({ length }, () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % 256; });
    const inputs: Array<[Uint8Array, string]> = [
      [random(2000), 'application/pdf'],
      [random(2000), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'application/pdf'],
      [valid.slice(0, Math.floor(valid.length / 2)), 'application/pdf'],
      [Uint8Array.from(valid, (byte, index) => (index > 200 && index % 7 === 0 ? byte ^ 0xff : byte)), 'application/pdf'],
      [new TextEncoder().encode('PK\x03\x04 bukan zip'), 'application/pdf'],
    ];
    for (const [body, type] of inputs) {
      const response = await call(body, type);
      expect(response.status, `${type} ${body.byteLength}`).toBeLessThan(500);
    }
  });
});
