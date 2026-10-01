import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/runtime', () => ({ runtime: () => ({}), requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));
import { DOCK_CHIPS, dockCostText } from '@/components/workspace/InstructionDock';
import { freeformCharge, freeformHold } from '@/server/ai/service';
import { ApiError, errorText } from '@/lib/client/api';
import { FREEFORM_RESERVE_FACTOR } from '@/lib/plans';

const id = (value: string) => value;
const en = (_id: string, value: string) => value;
const format = (value: number) => new Intl.NumberFormat('id').format(value);

describe('UX 2: output-based reservation for Perintah AI', () => {
  it('holds the reserve factor times the source before the call', () => {
    expect(FREEFORM_RESERVE_FACTOR).toBe(2);
    expect(freeformHold(100)).toBe(200);
  });
  it('charges MAX(source, output) and never more than the hold', () => {
    expect(freeformCharge(100, 40, 200)).toBe(100);
    expect(freeformCharge(100, 130, 200)).toBe(130);
    expect(freeformCharge(100, 900, 200)).toBe(200);
  });
});

describe('UX 2: dock chips that lengthen the text', () => {
  it('offers Kembangkan, Lanjutkan and 3 versi hook, marked as growing', () => {
    const grows = DOCK_CHIPS.filter((chip) => chip.grows).map((chip) => chip.label[0]);
    expect(grows).toEqual(['Kembangkan', 'Lanjutkan', '3 versi hook']);
    // None of them may invent facts: every growing chip says so in both languages.
    for (const chip of DOCK_CHIPS.filter((item) => item.grows)) {
      expect(chip.instruction[0]).toMatch(/Jangan menambah angka/);
      expect(chip.instruction[1]).toMatch(/Do not add new figures/);
    }
  });
  it('states the honest ceiling, with the exact figure when the target is known', () => {
    expect(dockCostText(undefined, (a) => id(a), format)).toBe('Biaya: hingga 2× panjang teks terpilih');
    expect(dockCostText(1500, (a) => id(a), format)).toBe('Biaya: hingga 2× panjang teks terpilih (maks. 3.000 karakter)');
    expect(dockCostText(10, en, String)).toBe('Cost: up to 2× the selected text (at most 20 characters)');
  });
  it('explains a refused hold with the amount it needed', () => {
    const message = errorText(new ApiError('QUOTA_EXCEEDED', 429, { reserve: 2000, factor: 2 }), false);
    expect(message).toContain('2.000 karakter');
    expect(message).toContain('2× teks terpilih');
    // Without the detail the ordinary quota message stays.
    expect(errorText(new ApiError('QUOTA_EXCEEDED', 429), false)).toContain('Jatah karakter');
  });
});
