import { describe, expect, it } from 'vitest';
import { detectLanguage, languageScores, EN_FUNCTION_WORDS, ID_FUNCTION_WORDS, SCAN_WORDS } from '@/lib/writing/language';
import { defaults, resolveLanguage } from '@/lib/writing/settings';

const id = (text: string) => expect(detectLanguage(text), text).toBe('id');
const en = (text: string) => expect(detectLanguage(text), text).toBe('en');
const unclear = (text: string) => expect(detectLanguage(text), text).toBeNull();

describe('review: Bahasa Auto detection', () => {
  it('keeps the two word lists disjoint', () => {
    expect([...ID_FUNCTION_WORDS].filter((word) => EN_FUNCTION_WORDS.has(word))).toEqual([]);
  });

  it('classifies short Indonesian and English phrases', () => {
    id('Tolong rapikan kalimat ini');
    id('Bantu saya menulis paragraf ini dengan lebih rapi');
    id('Bab ini membahas metode penelitian kualitatif');
    en('Make this sound more natural');
    en('Please help me fix the grammar in this paragraph');
    en('Can you rewrite this for a client');
  });

  it('classifies academic Indonesian and English', () => {
    id('Penelitian ini menunjukkan bahwa sistem yang digunakan tidak efektif.');
    id('Analisis data dilakukan dengan menggunakan perangkat lunak statistik untuk menguji hipotesis penelitian.');
    id('Berdasarkan hasil wawancara, peneliti menyimpulkan bahwa faktor motivasi berpengaruh terhadap kinerja karyawan.');
    en('This study shows that the system is not effective for the users.');
    en('The results demonstrate a significant correlation between the variables examined in this experiment.');
    en('Prior literature suggests that motivation has a measurable effect on employee performance.');
  });

  it('classifies casual Indonesian with slang and casual English', () => {
    id('Gue udah coba bikin laporan tapi masih berantakan banget');
    id('Kayaknya tulisan ini kepanjangan deh, tolong dipersingkat aja ya');
    en("I honestly cannot get this thing to work, it keeps crashing on me");
    en("Hey, can you make this shorter? It's way too long right now");
  });

  it('keeps Indonesian sentences that are full of English loanwords', () => {
    id('Kami melakukan deployment aplikasi menggunakan containerization dan monitoring realtime');
    id('Tim engineering sedang melakukan refactoring pada microservice yang sudah deprecated');
    id('Fitur onboarding ini perlu di-review dulu sebelum rilis ke production minggu depan');
  });

  it('returns null for genuinely ambiguous strings', () => {
    unclear('OK 123');
    unclear('Jakarta Bandung Surabaya 2024 2025');
    unclear('Sugiyono (2019), Kotler & Keller (2016), hlm. 45-67');
    unclear('const handler = async (req, res) => res.json({ ok: true });');
    unclear('Annual financial report');
    unclear('Laporan keuangan tahunan');
    unclear('');
    unclear('   ');
  });

  it('returns null when the two languages are mixed in equal measure', () => {
    unclear('The proposal ini sudah final and the tim akan review it tomorrow');
    unclear('Saya sudah kirim the report dan please check it');
  });

  it('bounds the scan for a document-sized input', () => {
    const long = 'Penelitian ini menunjukkan bahwa sistem yang digunakan tidak efektif. '.repeat(400);
    expect(long.length).toBeGreaterThan(20_000);
    const started = Date.now();
    expect(detectLanguage(long)).toBe('id');
    expect(languageScores(long).words).toBeLessThanOrEqual(SCAN_WORDS);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('feeds resolveLanguage, which only detects while the setting is Auto', () => {
    expect(resolveLanguage({ ...defaults, language: 'auto' }, 'Penelitian ini menunjukkan bahwa sistem tersebut efektif.')).toBe('id');
    expect(resolveLanguage({ ...defaults, language: 'auto' }, 'OK 123')).toBeNull();
    expect(resolveLanguage({ ...defaults, language: 'en' }, 'Penelitian ini menunjukkan bahwa sistem tersebut efektif.')).toBe('en');
    expect(resolveLanguage({ ...defaults, language: 'id' }, 'OK 123')).toBe('id');
  });
});
