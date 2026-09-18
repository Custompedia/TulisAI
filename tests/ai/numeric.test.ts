import { describe, expect, it } from 'vitest';
import { compareNumericValues, numericValues, stripListMarkers } from '../../src/server/ai/core/numeric';

const values = (text: string) => numericValues(text).flatMap((token) => token.values);
const kept = (original: string, output: string) => {
  const diff = compareNumericValues(original, output);
  return { dropped: diff.dropped.map((token) => token.raw), invented: diff.invented.map((token) => token.raw) };
};
const clean = { dropped: [], invented: [] };

describe('numeric notation', () => {
  it('reads a lone group of three as either a thousand or a decimal', () => {
    expect(values('1.000')).toContain('1000');
    expect(values('1.000')).toContain('1');
    expect(values('1,000')).toContain('1000');
  });
  it('treats repeated grouping as thousands and a mixed pair as a decimal point', () => {
    expect(values('1.000.000')).toEqual(['1000000']);
    expect(values('10.000,50')).toEqual(['10000.5']);
    expect(values('10,000.50')).toEqual(['10000.5']);
    expect(values('1 000 000')).toEqual(['1000000']);
  });
  it('reads a short fraction as a decimal in either notation', () => {
    expect(values('1,5')).toEqual(['1.5']);
    expect(values('1.5')).toEqual(['1.5']);
    expect(values('0,25')).toEqual(['0.25']);
  });
  it('keeps trailing zeros out of the canonical value', () => {
    expect(compareNumericValues('Nilainya 1,50 juta.', 'Nilainya 1.5 juta.')).toEqual(clean);
  });
});

describe('numeric equivalence across notations and wording', () => {
  it('accepts an Indonesian amount rewritten in English notation and back', () => {
    expect(kept('Biayanya Rp1.000.000 per bulan.', 'The cost is Rp1,000,000 per month.')).toEqual(clean);
    expect(kept('Suhunya 36,6 derajat.', 'The temperature is 36.6 degrees.')).toEqual(clean);
  });
  it('accepts a scale word standing in for the zeros', () => {
    expect(kept('Target 1.000.000 pengguna.', 'Target satu juta pengguna.')).toEqual(clean);
    expect(kept('Dana 2.500.000 rupiah.', 'Dana 2,5 juta rupiah.')).toEqual(clean);
  });
  it('accepts a number spelled out, in Indonesian and in English', () => {
    expect(kept('Ada 10 unit tersedia.', 'Ada sepuluh unit tersedia.')).toEqual(clean);
    expect(kept('Ada 10 unit tersedia.', 'Ten units are available.')).toEqual(clean);
    expect(kept('Tim berisi 25 orang.', 'Tim berisi dua puluh lima orang.')).toEqual(clean);
  });
  it('accepts a percentage restated as its fraction', () => {
    expect(kept('Naik 50% tahun ini.', 'Naik setengah, atau 50 persen, tahun ini.')).toEqual(clean);
  });
});

describe('numeric multiplicity and layout', () => {
  it('lets the result restate a figure a different number of times', () => {
    expect(kept('Ada 10 unit.', 'Ada 10 unit, dan 10 unit itu sudah dipesan.')).toEqual(clean);
    expect(kept('Ada 10 unit dan 10 kursi.', 'Ada 10 unit serta kursi dengan jumlah sama.')).toEqual(clean);
  });
  it('ignores list numbering on both sides', () => {
    expect(stripListMarkers('1. Satu\n2) Dua')).toBe('Satu\nDua');
    expect(kept('Langkah pertama lalu berikutnya.', '1. Langkah pertama\n2. Langkah berikutnya')).toEqual(clean);
    expect(kept('Alurnya sederhana.', 'Alurnya: 1. buka 2. isi 3. kirim')).toEqual(clean);
  });
  it('keeps an inline number that is not an enumeration', () => {
    expect(stripListMarkers('Totalnya 10. Sisanya aman.')).toBe('Totalnya 10. Sisanya aman.');
    expect(values('Bab 3. Metode')).toContain('3');
  });
});

describe('numeric violations that are real', () => {
  it('reports a value the result dropped', () => {
    expect(kept('Kami memiliki 10 unit.', 'Kami memiliki beberapa unit.')).toEqual({ dropped: ['10'], invented: [] });
  });
  it('reports a value the result invented', () => {
    expect(kept('Kami memiliki beberapa unit.', 'Kami memiliki 12 unit.')).toEqual({ dropped: [], invented: ['12'] });
  });
  it('reports a value the result altered', () => {
    const diff = kept('Anggaran 1.500.000 rupiah.', 'Anggaran 1.600.000 rupiah.');
    expect(diff.dropped).toEqual(['1.500.000']);
    expect(diff.invented).toEqual(['1.600.000']);
  });
  it('reports a changed decimal even when the notation also changed', () => {
    expect(kept('Suhunya 36,6 derajat.', 'Suhunya 36.8 derajat.')).toEqual({ dropped: ['36,6'], invented: ['36.8'] });
  });
  it('reports each distinct missing value once', () => {
    const diff = kept('Ada 10 unit, 10 kursi, dan 7 meja.', 'Ada beberapa unit, kursi, dan meja.');
    expect(diff.dropped).toEqual(['10', '7']);
  });
});
