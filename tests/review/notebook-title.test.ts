import { describe, expect, it, vi } from 'vitest';
import { deriveTitle, sanitizeSuggestedTitle, TITLE_CHARS, TITLE_WORDS } from '@/lib/writing/title';
import { buildUserMessage, createOpenRouterProvider, getPromptDefinition, normalizeRuntime, TITLE_REQUEST_RULES, validateAIResponse } from '@/server/ai/core';

const words = (value: string) => value.split(' ').length;
const untitled = 'Notebook tanpa judul';

describe('review: notebook title', () => {
  it('derives a short local title from the first meaningful words', () => {
    expect(deriveTitle('Penelitian ini menunjukkan bahwa sistem yang digunakan tidak efektif.', untitled)).toBe('Penelitian Menunjukkan Sistem');
    expect(deriveTitle('This study shows that the system is not effective for the users.', untitled)).toBe('Study Shows System');
    expect(deriveTitle('Laporan keuangan tahunan\nbaris kedua', untitled)).toBe('Laporan Keuangan Tahunan');
  });

  it('never exceeds three words or forty characters', () => {
    const long = deriveTitle('Implementasi pengembangan infrastruktur telekomunikasi nasional berkelanjutan', untitled);
    expect(words(long)).toBeLessThanOrEqual(TITLE_WORDS);
    expect(long.length).toBeLessThanOrEqual(TITLE_CHARS);
    expect(deriveTitle('Pemberitahuanpemberitahuanpemberitahuanpemberitahuan panjang', untitled).length).toBeLessThanOrEqual(TITLE_CHARS);
  });

  it('keeps acronyms and existing casing, and falls back when nothing is usable', () => {
    expect(deriveTitle('API v2 migration', untitled)).toBe('API V2 Migration');
    expect(deriveTitle('iPhone pricing update', untitled)).toBe('iPhone Pricing Update');
    expect(deriveTitle('   ', untitled)).toBe(untitled);
    expect(deriveTitle('*** ###', untitled)).toBe(untitled);
    expect(deriveTitle('2024 2025 2026', untitled)).toBe(untitled);
  });

  it('falls back to the raw words when the opening is only stopwords', () => {
    expect(deriveTitle('Yang ini dan itu', untitled)).toBe('Yang Ini Dan');
  });

  it('accepts and tidies a valid AI title', () => {
    expect(sanitizeSuggestedTitle('  Rencana Pemasaran  ')).toBe('Rencana Pemasaran');
    expect(sanitizeSuggestedTitle('"Quarterly Sales Report"')).toBe('Quarterly Sales Report');
    expect(sanitizeSuggestedTitle('**Surat Lamaran**')).toBe('Surat Lamaran');
    expect(sanitizeSuggestedTitle('Laporan Audit Internal Tahunan')).toBe('Laporan Audit Internal');
    expect(sanitizeSuggestedTitle('Metode Penelitian.')).toBe('Metode Penelitian');
  });

  it('rejects anything that is not a short label', () => {
    for (const value of [
      undefined, null, 42, '', '   ', '###', '2024',
      'Title: Rencana Pemasaran',
      'This document explains how the new onboarding flow works for new users.',
      'Penelitian ini membahas pengaruh motivasi kerja terhadap kinerja karyawan di perusahaan.',
      'Laporan, ringkasan, dan analisis',
      '<h1>Judul</h1>'.repeat(20),
      'a'.repeat(200),
    ]) expect(sanitizeSuggestedTitle(value), String(value).slice(0, 30)).toBeNull();
  });

  it('asks for the title in its own user-message block, only when requested', () => {
    const base = { sourceText: 'Teks asli yang panjang.', language: 'id' as const, strength: 'balanced' };
    const plain = normalizeRuntime('P01_STANDARD_REWRITE', base);
    expect(plain.suggest_title).toBeUndefined();
    expect(buildUserMessage('P01_STANDARD_REWRITE', plain)).not.toContain('title_request');

    const titled = normalizeRuntime('P01_STANDARD_REWRITE', { ...base, suggestTitle: true });
    expect(titled.suggest_title).toBe(true);
    const message = buildUserMessage('P01_STANDARD_REWRITE', titled);
    expect(message).toContain(`<title_request>\n${TITLE_REQUEST_RULES}\n</title_request>`);
    expect(message.indexOf('<title_request>')).toBeLessThan(message.indexOf('<input>'));
    // Inline alternatives never rename a notebook.
    expect(normalizeRuntime('P07_INLINE_ALTERNATIVES', { selectedText: 'kata', language: 'id', intent: 'alternatives', suggestTitle: true }).suggest_title).toBeUndefined();
  });

  it('only keeps suggested_title in the schema when the title was requested', () => {
    const result = { transformed_text: 'Hasil.', change_categories: [], warnings: [], no_change_needed: false, suggested_title: 'Rencana Pemasaran' };
    expect(validateAIResponse('P01_STANDARD_REWRITE', result).suggested_title).toBeUndefined();
    expect(validateAIResponse('P01_STANDARD_REWRITE', result, true).suggested_title).toBe('Rencana Pemasaran');
    expect(JSON.stringify(getPromptDefinition('P01_STANDARD_REWRITE').responseFormat)).not.toContain('suggested_title');
    const format = JSON.stringify(getPromptDefinition('P01_STANDARD_REWRITE', true).responseFormat);
    expect(format).toContain('suggested_title');
    // Strict structured output needs every property required, so the field is asked for and may come back empty.
    expect(JSON.parse(format).json_schema.schema.required).toContain('suggested_title');
  });

  it('carries the label through one provider call and drops an unusable one', async () => {
    const body = (title: string) => JSON.stringify({ transformed_text: 'Hasil rapi.', change_categories: [], warnings: [], no_change_needed: false, suggested_title: title });
    const reply = (title: string) => new Response(JSON.stringify({ id: 'req_1', choices: [{ message: { content: body(title) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply('Rencana Pemasaran')).mockResolvedValueOnce(reply('This is clearly a whole sentence about the document.'));
    const provider = createOpenRouterProvider({ apiKey: 'test', model: 'x', privacyMode: 'deny', fetchImpl });
    const runtime = { language: 'id' as const, strength: 'balanced', protected_terms: [], protected_citations: [], suggest_title: true };

    const first = await provider.generate({ promptId: 'P01_STANDARD_REWRITE', runtime, sourceText: 'Teks asli yang perlu dirapikan.', requestId: 'r1' });
    expect(first.ok).toBe(true);
    expect(first.ok && sanitizeSuggestedTitle(first.response.suggested_title)).toBe('Rencana Pemasaran');
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain('<title_request>');
    expect(JSON.stringify(sent.response_format)).toContain('suggested_title');

    const second = await provider.generate({ promptId: 'P01_STANDARD_REWRITE', runtime, sourceText: 'Teks asli yang perlu dirapikan.', requestId: 'r2' });
    expect(second.ok && sanitizeSuggestedTitle(second.response.suggested_title)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
