import { describe, expect, it } from 'vitest';
import { planSelectionCommand } from '@/components/workspace/selection-commands';
import type { SelectionRange } from '@/components/workspace/types';
import { nameTaken } from '@/components/writing/style-form';
import { applyStyle, type WritingStyle } from '@/lib/writing/styles';
import { defaults, type Settings } from '@/lib/writing/settings';
import { scoreStyle, SUGGEST_MIN_SCORE, contextKeywords, suggestStyle } from '@/lib/writing/suggest';
import { PLAN_LIMITS } from '@/lib/plans';

// The planner is pure, so the tests hand it a plan explicitly instead of reading an account.
const limits = PLAN_LIMITS.pro;

const t = (id: string) => id;
const format = (value: number) => String(value);
const range = (text: string): SelectionRange => ({ from: 0, to: text.length, text, pmFrom: 1, pmTo: 1 + text.length });
const style = (name: string, description: string | null, settings: Partial<Settings> = {}): WritingStyle =>
  ({ id: name, name, description, color: 'blue', icon: 'icon:Rocket', settings: { ...defaults, ...settings }, createdAt: '', updatedAt: '' });

describe('review: skill regressions', () => {
  it('runs a toolbar action without anything the applied skill brought in', () => {
    const skill = style('Email klien', null, { mode: 'professional', recipient: 'klien', sample: 'Contoh gaya saya.', extra: 'pakai sapaan hangat', customized: true, format: 'bullets', length: 'shorter', focus: ['clarity'] });
    const applied = applyStyle({ ...defaults, mode: 'academic' }, skill);
    expect(applied.sample).not.toBe('');
    for (const [command, selection] of [['humanize', 'Satu kalimat panjang yang perlu diperhalus.'], ['academic', 'Satu kalimat panjang yang perlu dirapikan.'], ['shorter', 'Baris satu\nBaris dua'], ['clearer', 'Baris satu\nBaris dua'], ['formal', 'Baris satu\nBaris dua'], ['natural', 'Baris satu\nBaris dua']] as const) {
      const plan = planSelectionCommand(command, range(selection), applied, t, format, limits);
      expect(plan.kind, command).toBe('generate');
      const override = plan.kind === 'generate' ? plan.override : undefined;
      expect(override, command).toBeDefined();
      expect(override!.sample, command).toBe('');
      expect(override!.styleId, command).toBeNull();
      expect(override!.extra, command).toBe('');
      expect(override!.focus, command).toEqual([]);
      expect(override!.format, command).toBe(defaults.format);
      expect(override!.customized, command).toBe(command === 'shorter');
    }
  });

  it('keeps a skill run carrying its own skill', () => {
    const skill = style('Email klien', null, { mode: 'professional', sample: 'Contoh gaya saya.' });
    const plan = planSelectionCommand('humanize', range('Kalimat pendek untuk dihaluskan.'), applyStyle(defaults, skill), t, format, limits);
    expect(plan.kind === 'generate' && plan.override?.mode).toBe('humanize');
  });

  it('counts a word shared by a skill name and description only once', () => {
    const shared = style('Proposal', 'Proposal untuk klien', {});
    const context = contextKeywords({ title: 'Proposal', text: 'proposal' });
    expect(scoreStyle(shared, context)).toBeLessThan(SUGGEST_MIN_SCORE);
    const both = style('Proposal Klien', 'Nada formal', {});
    expect(scoreStyle(both, contextKeywords({ title: 'Proposal klien baru', text: 'proposal klien' }))).toBeGreaterThanOrEqual(SUGGEST_MIN_SCORE);
  });

  it('only suggests a skill once the notebook is long enough', () => {
    const skill = style('Proposal Klien', 'Nada formal', {});
    const body = 'Proposal klien ini menjelaskan lingkup pekerjaan dan biaya. '.repeat(10);
    expect(suggestStyle([skill], { title: 'Proposal klien', text: 'Proposal klien' })).toBeNull();
    expect(suggestStyle([skill], { title: 'Proposal klien', text: body })).toBe(skill);
  });

  it('matches the database rule for duplicate skill names', () => {
    const styles = [style('Email klien', null), style('Émail', null)];
    expect(nameTaken('EMAIL KLIEN', styles)).toBe(true);
    expect(nameTaken('  email klien  ', styles)).toBe(true);
    // COLLATE NOCASE folds ASCII only, so an accented pair is two distinct names on both sides.
    expect(nameTaken('émail', styles)).toBe(false);
    expect(nameTaken('Email klien', styles, 'Email klien')).toBe(false);
  });
});
