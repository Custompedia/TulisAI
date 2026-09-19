import { describe, expect, it } from 'vitest';
import { FEATURES, MAX_RUN_LIMIT, PLAN_LIMITS, TIERS, TOP_UPS, TOP_UP_VALIDITY_MONTHS, asTier, requiredTierFor } from '../../src/lib/plans';

// The owner-locked ladder. A price or allowance that drifts from this table is a business change, not a refactor.
describe('review: the plan catalogue matches the locked commercial decisions', () => {
  it('sells four plans at the approved prices and allowances', () => {
    expect([...TIERS]).toEqual(['free', 'plus', 'pro', 'max']);
    expect(PLAN_LIMITS.free).toMatchObject({ priceIdr: 0, includedCharacters: 3_000, oneTime: true, runLimit: 1_000 });
    expect(PLAN_LIMITS.plus).toMatchObject({ priceIdr: 49_000, includedCharacters: 25_000, oneTime: false, runLimit: 2_000 });
    expect(PLAN_LIMITS.pro).toMatchObject({ priceIdr: 179_000, includedCharacters: 100_000, oneTime: false, runLimit: 5_000 });
    expect(PLAN_LIMITS.max).toMatchObject({ priceIdr: 499_000, includedCharacters: 350_000, oneTime: false, runLimit: 5_000 });
    expect(MAX_RUN_LIMIT).toBe(5_000);
  });

  it('draws the package boundaries where the ladder says they are', () => {
    expect(PLAN_LIMITS.free.features).toEqual([]);
    expect(requiredTierFor('saved_styles')).toBe('plus');
    expect(requiredTierFor('purchase_topup')).toBe('plus');
    expect(requiredTierFor('advanced_notebook')).toBe('pro');
    expect(requiredTierFor('docx_import')).toBe('pro');
    expect(requiredTierFor('docx_export')).toBe('pro');
    expect(requiredTierFor('freeform_prompt')).toBe('max');
    // Each plan carries everything the plan below it carries.
    for (const [lower, higher] of [['plus', 'pro'], ['pro', 'max']] as const) {
      for (const feature of PLAN_LIMITS[lower].features) expect(PLAN_LIMITS[higher].features).toContain(feature);
    }
    expect([...PLAN_LIMITS.max.features].sort()).toEqual([...FEATURES].sort());
  });

  it('keeps an account sold the retired Team plan on Pro rights instead of dropping it to free', () => {
    expect(asTier('team')).toBe('pro');
    expect(asTier('nonsense')).toBe('free');
    expect(asTier('max')).toBe('max');
  });

  it('sells top-ups as usage only, at the approved prices', () => {
    expect(TOP_UPS.map((pack) => [pack.priceIdr, pack.characters])).toEqual([[19_000, 15_000], [49_000, 45_000], [99_000, 100_000]]);
    expect(TOP_UP_VALIDITY_MONTHS).toBe(12);
  });
});
