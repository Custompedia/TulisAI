import { describe, expect, it } from 'vitest';
import { buildUserMessage, normalizeRuntime, sampleEcho, sanitizeSample, validateGeneration } from '@/server/ai/core';
import { SAMPLE_ECHO_WORDS } from '@/server/ai/core/validators';
import { STYLE_REFERENCE_RULES } from '@/server/ai/core';
import { defaults, normalizeSettings, runtimeControls, SAMPLE_LIMIT, type Settings } from '@/lib/writing/settings';
import { StyleInputSchema, StylePatchSchema, STYLE_DESCRIPTION_LIMIT, type WritingStyle } from '@/lib/writing/styles';
import { contextKeywords, scoreStyle, suggestStyle, SUGGEST_MIN_WORDS } from '@/lib/writing/suggest';

const style = (name: string, description: string | null): WritingStyle =>
  ({ id: name, name, description, color: null, icon: null, settings: { ...defaults }, createdAt: '', updatedAt: '' });
const filler = (count: number) => Array.from({ length: count }, (_, index) => `kata${index}`).join(' ');

describe('review: "Kapan dipakai" stays metadata', () => {
  it('validates, trims and caps the description on create and patch', () => {
    const parsed = StyleInputSchema.parse({ name: 'Skripsi', description: '  bab tinjauan pustaka  ', settings: {} });
    expect(parsed.description).toBe('bab tinjauan pustaka');
    expect(StyleInputSchema.parse({ name: 'Skripsi', settings: {} }).description).toBeNull();
    expect(StyleInputSchema.safeParse({ name: 'Skripsi', description: 'x'.repeat(STYLE_DESCRIPTION_LIMIT + 1), settings: {} }).success).toBe(false);
    expect(StylePatchSchema.parse({ description: null }).description).toBeNull();
  });

  it('never reaches the model: only the sample travels in the runtime controls', () => {
    const settings: Settings = { ...defaults, sample: 'Paragraf contoh.' };
    const controls = runtimeControls(settings, 'id');
    expect(controls).toMatchObject({ style_sample: 'Paragraf contoh.' });
    expect(JSON.stringify(controls)).not.toContain('bab tinjauan');
    expect(runtimeControls({ ...defaults }, 'id').style_sample).toBeUndefined();
    expect(runtimeControls(settings, 'id', 'shorter')).toEqual({ language: 'id', action: 'shorter' });
  });
});

describe('review: "Contoh tulisan" is a style reference only', () => {
  it('normalises and caps the sample like the author note', () => {
    expect(normalizeSettings({ sample: 'x'.repeat(SAMPLE_LIMIT + 50) }).sample).toHaveLength(SAMPLE_LIMIT);
    expect(normalizeSettings({}).sample).toBe('');
    expect(sanitizeSample('  <b>Halo</b>   dunia \n\n\n\n lagi  ')).toBe('bHalo/b dunia\n\nlagi');
    expect(sanitizeSample('   ')).toBeUndefined();
    expect(sanitizeSample(42)).toBeUndefined();
  });

  it('sends the sample as its own delimited user block with its rules', () => {
    const runtime = normalizeRuntime('P01_STANDARD_REWRITE', { sourceText: 'Teks asli.', language: 'id', strength: 'balanced', styleSample: 'Contoh gaya saya.' });
    expect(runtime.style_reference).toBe('Contoh gaya saya.');
    const message = buildUserMessage('P01_STANDARD_REWRITE', runtime);
    expect(message).toContain('<style_reference>\nContoh gaya saya.\n</style_reference>');
    expect(message).toContain(`<style_reference_rules>\n${STYLE_REFERENCE_RULES}\n</style_reference_rules>`);
    expect(message.indexOf('<style_reference>')).toBeLessThan(message.indexOf('<input>'));
    expect(buildUserMessage('P01_STANDARD_REWRITE', normalizeRuntime('P01_STANDARD_REWRITE', { sourceText: 'Teks asli.', language: 'id', strength: 'balanced' }))).not.toContain('style_reference');
  });

  it('rejects a long verbatim span copied from the sample but keeps overlap the author wrote themselves', () => {
    const shared = 'kalimat panjang yang sengaja dipakai ulang oleh model tanpa alasan';
    expect(sampleEcho(shared, 'Teks penulis tanpa kemiripan.', `Hasil: ${shared}.`)).toContain('kalimat panjang yang');
    expect(sampleEcho(shared, `Penulis menulis ${shared} sendiri.`, `Hasil: ${shared}.`)).toBeNull();
    expect(sampleEcho(shared, 'Teks penulis.', 'Hasil pendek saja.')).toBeNull();
    expect(sampleEcho('terlalu pendek', 'Teks.', 'terlalu pendek')).toBeNull();
    expect(SAMPLE_ECHO_WORDS).toBe(8);
  });

  it('fails generation validation when the output echoes the sample', () => {
    const shared = 'satu dua tiga empat lima enam tujuh delapan sembilan';
    const response = (text: string) => ({ transformed_text: text, change_categories: [], warnings: [], no_change_needed: false });
    const runtime = { style_reference: shared, protectedTerms: [], protectedCitations: [] };
    expect(() => validateGeneration('P01_STANDARD_REWRITE', 'Teks penulis sendiri.', response(`Hasil ${shared}`), runtime)).toThrow(/style sample copied/);
    expect(validateGeneration('P01_STANDARD_REWRITE', 'Teks penulis sendiri.', response('Tulisan penulis sendiri.'), runtime)).toMatchObject({ transformed_text: 'Tulisan penulis sendiri.' });
  });
});

describe('review: skill suggestion only suggests', () => {
  const skripsi = style('Skripsi bab metode', 'penelitian kuantitatif dan instrumen');
  const email = style('Email klien', 'penawaran proyek untuk klien baru');

  it('needs enough text before it suggests anything', () => {
    expect(suggestStyle([skripsi], { title: 'Skripsi metode', text: 'Pendek saja.' })).toBeNull();
    expect(suggestStyle([], { title: 'Skripsi metode', text: filler(SUGGEST_MIN_WORDS) })).toBeNull();
  });

  it('picks the single best match and ignores weak overlap', () => {
    const text = `Bagian metode penelitian ini menjelaskan instrumen dan sampel. ${filler(SUGGEST_MIN_WORDS)}`;
    expect(suggestStyle([email, skripsi], { title: 'Skripsi bab metode', text })?.id).toBe('Skripsi bab metode');
    expect(suggestStyle([email], { title: 'Catatan rapat', text: `Ringkasan rapat mingguan tim. ${filler(SUGGEST_MIN_WORDS)}` })).toBeNull();
  });

  it('weighs the name above the description and reads the opening of the text', () => {
    const notebook = contextKeywords({ title: 'Email klien', text: 'penawaran proyek baru' });
    expect(scoreStyle(email, notebook)).toBeGreaterThan(scoreStyle(style('Lainnya', 'penawaran proyek'), notebook));
    expect(scoreStyle(style('Tanpa kaitan', null), notebook)).toBe(0);
  });
});
