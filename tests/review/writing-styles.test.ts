import { describe, expect, it } from 'vitest';
import { appendInstruction, copyName, hasAdvancedValues, hasCustomFields, instructionChips, nameTaken, styleDraft, stylePayload } from '@/components/writing/style-form';
import { planStyleCommand } from '@/components/workspace/selection-commands';
import type { SelectionRange } from '@/components/workspace/types';
import { defaults, EXTRA_LIMIT, FOCUS_LIMIT, SELECTION_LIMIT, type Settings } from '@/lib/writing/settings';
import { applyStyle, matchesStyle, reconcileStyle, STYLE_NAME_LIMIT, StyleInputSchema, type WritingStyle } from '@/lib/writing/styles';
import { ApiError, errorText } from '@/lib/client/api';
import { rememberSettings, tabForSettings, tabSettings, type TabMemory } from '@/components/workspace/assistant-tabs';

const t = (id: string) => id;
const format = (value: number) => String(value);
const range = (text: string): SelectionRange => ({ from: 0, to: text.length, text, pmFrom: 1, pmTo: 1 + text.length });
const style = (name: string, settings: Partial<Settings> = {}): WritingStyle =>
  ({ id: name, name, description: null, color: 'blue', icon: 'icon:Rocket', settings: { ...defaults, ...settings }, createdAt: '', updatedAt: '' });

describe('review: saved writing styles', () => {
  it('builds a payload that strips the language and marker and marks customized only when a field differs', () => {
    const plain = stylePayload({ name: '  Email klien  ', description: ' bab pembuka ', color: 'gold', icon: null, settings: { ...defaults, mode: 'professional', language: 'en', styleId: 'old' } });
    expect(plain.name).toBe('Email klien');
    expect(plain.description).toBe('bab pembuka');
    expect(plain.settings).toMatchObject({ mode: 'professional', language: 'auto', styleId: null, customized: false });
    expect(StyleInputSchema.safeParse(plain).success).toBe(true);

    const custom = stylePayload({ name: 'Ringkas', description: '', color: null, icon: null, settings: { ...defaults, length: 'shorter', extra: '  catatan  ', focus: ['clarity', 'naturalness', 'formality', 'persuasiveness'] } });
    expect(custom.settings).toMatchObject({ customized: true, extra: 'catatan' });
    expect(custom.description).toBeNull();
    expect((custom.settings as unknown as Settings).focus).toHaveLength(FOCUS_LIMIT);
    expect(hasCustomFields({ ...defaults, audience: 'client' })).toBe(true);
    expect(hasCustomFields({ ...defaults, mode: 'creative', strength: 'strong' })).toBe(false);
  });

  it('flags only non-default values behind the advanced details row', () => {
    expect(hasAdvancedValues(defaults)).toBe(false);
    expect(hasAdvancedValues({ ...defaults, mode: 'creative', extra: 'catatan' })).toBe(false);
    for (const change of [{ strength: 'strong' }, { context: 'academic' }, { preservation: 'flexible' }, { recipient: 'klien' }, { simplifyFor: 'pemula' }, { academic: 'journal' }, { format: 'bullets' }, { length: 'shorter' }, { audience: 'client' }, { focus: ['clarity'] }] as Array<Partial<Settings>>) {
      expect(hasAdvancedValues({ ...defaults, ...change })).toBe(true);
    }
  });

  it('prefills the draft from a style when editing and from the current settings when creating', () => {
    const current: Settings = { ...defaults, mode: 'academic', extra: 'x'.repeat(EXTRA_LIMIT + 20) };
    expect(styleDraft(current)).toMatchObject({ name: '', color: null, icon: null });
    expect(styleDraft(current).settings.extra).toHaveLength(EXTRA_LIMIT);
    expect(styleDraft(current, style('Jurnal', { mode: 'creative' }))).toMatchObject({ name: 'Jurnal', color: 'blue', icon: 'icon:Rocket', settings: { mode: 'creative' } });
  });

  it('detects duplicate names case-insensitively and numbers duplicates within the name limit', () => {
    const styles = [style('Email klien'), style('Jurnal')];
    expect(nameTaken('  email KLIEN ', styles)).toBe(true);
    expect(nameTaken('Email klien', styles, 'Email klien')).toBe(false);
    expect(copyName('Email klien', styles)).toBe('Email klien (2)');
    expect(copyName('Email klien (2)', [...styles, style('Email klien (2)')])).toBe('Email klien (3)');
    expect(copyName('x'.repeat(STYLE_NAME_LIMIT), styles).length).toBeLessThanOrEqual(STYLE_NAME_LIMIT);
  });

  it('appends instruction chips once and never past the note limit', () => {
    const chip = instructionChips(t)[0];
    expect(appendInstruction('', chip)).toBe(chip);
    expect(appendInstruction('Catatan.', chip)).toBe(`Catatan.\n${chip}`);
    expect(appendInstruction(`Catatan.\n${chip}`, chip)).toBe(`Catatan.\n${chip}`);
    const nearlyFull = 'y'.repeat(EXTRA_LIMIT - 2);
    expect(appendInstruction(nearlyFull, chip)).toBe(nearlyFull);
  });

  it('runs a style from the selection toolbar as a full-settings override and refuses over-limit selections', () => {
    const saved = style('Email klien', { mode: 'professional', recipient: 'klien' });
    const base: Settings = { ...defaults, language: 'en' };
    expect(planStyleCommand(saved, range('Halo tim.'), base, t, format)).toEqual({ kind: 'generate', label: 'Email klien', override: { ...saved.settings, language: 'en', styleId: saved.id } });
    expect(planStyleCommand(saved, range('x'.repeat(SELECTION_LIMIT + 1)), base, t, format)).toMatchObject({ kind: 'error', label: 'Email klien' });
  });

  it('keeps the marker while the settings match the style and clears it on a manual edit', () => {
    const saved = style('Jurnal', { mode: 'academic', academic: 'journal' });
    const applied = applyStyle({ ...defaults, language: 'id' }, saved);
    expect(applied).toMatchObject({ mode: 'academic', academic: 'journal', language: 'id', styleId: 'Jurnal' });
    expect(matchesStyle(applied, saved)).toBe(true);
    expect(reconcileStyle(applied, [saved]).styleId).toBe('Jurnal');
    expect(reconcileStyle({ ...applied, strength: 'strong' }, [saved]).styleId).toBeNull();
    expect(reconcileStyle(applied, []).styleId).toBeNull();
  });

  it('explains every style error code in both languages', () => {
    for (const code of ['STYLE_EXISTS', 'STYLE_LIMIT_REACHED', 'STYLE_NOT_FOUND']) {
      const id = errorText(new ApiError(code, 409), false); const en = errorText(new ApiError(code, 409), true);
      expect(id).not.toBe(errorText(new ApiError('UNKNOWN_CODE', 500), false));
      expect(en).not.toBe(id);
    }
  });
});

describe('review: Mode and Skills tabs keep separate configurations', () => {
  const skill = style('Email klien', { mode: 'professional', recipient: 'klien' });
  const manual: Settings = { ...defaults, mode: 'creative', strength: 'strong', language: 'id' };
  const empty: TabMemory = { mode: null, styleId: null };

  it('opens on the tab that matches the saved settings', () => {
    expect(tabForSettings(defaults)).toBe('mode');
    expect(tabForSettings({ ...defaults, styleId: 'Email klien' })).toBe('skills');
  });

  it('remembers the manual mode setup and the applied skill', () => {
    const afterManual = rememberSettings('mode', manual, empty);
    expect(afterManual).toEqual({ mode: manual, styleId: null });
    const applied = applyStyle(manual, skill);
    const afterSkill = rememberSettings('skills', applied, afterManual);
    expect(afterSkill).toEqual({ mode: manual, styleId: skill.id });
    // A skill configuration never overwrites the remembered manual setup.
    expect(rememberSettings('mode', applied, afterSkill).mode).toEqual(manual);
  });

  it('restores each tab instead of inheriting the other one', () => {
    const withSample = style('Email klien', { mode: 'professional', recipient: 'klien', sample: 'Contoh gaya.' });
    expect(tabSettings('mode', applyStyle(manual, withSample), { mode: manual, styleId: withSample.id }, [withSample]).sample).toBe('');
    const applied = applyStyle(manual, skill);
    const memory: TabMemory = { mode: manual, styleId: skill.id };
    const backToMode = tabSettings('mode', applied, memory, [skill]);
    expect(backToMode).toEqual({ ...manual, language: applied.language, styleId: null });
    expect(tabSettings('skills', backToMode, memory, [skill])).toEqual({ ...skill.settings, language: backToMode.language, styleId: skill.id });
  });

  it('keeps the writing language and drops the marker when the skill is gone or unknown', () => {
    const applied = { ...applyStyle(manual, skill), language: 'en' as const };
    expect(tabSettings('mode', applied, empty, [skill])).toMatchObject({ language: 'en', styleId: null, sample: '' });
    expect(tabSettings('skills', { ...manual, styleId: null }, { mode: manual, styleId: 'gone' }, [])).toEqual({ ...manual, styleId: null });
    expect(tabSettings('skills', applied, { mode: manual, styleId: skill.id }, []).styleId).toBeNull();
  });
});
