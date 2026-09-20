// One catalogue of plan limits, prices and feature gates, shared by client hints and server enforcement.
// Client-safe: no server imports, no env reads. The free character allowance is the only tunable, read server-side.

export const TIERS = ['free', 'plus', 'pro', 'max'] as const;
export type Tier = (typeof TIERS)[number];

// 'team' was sold before the plan ladder was locked; rows still carrying it keep Pro's rights instead of dropping to free.
const LEGACY_TIERS: Record<string, Tier> = { team: 'pro' };

export const FEATURES = ['saved_styles', 'purchase_topup', 'advanced_notebook', 'docx_import', 'docx_export', 'freeform_prompt', 'persistent_personalization', 'style_reference'] as const;
export type Feature = (typeof FEATURES)[number];

export type PlanLimits = {
  // Characters allowed in a single paraphrase run, whether the scope is a selection or the whole notebook.
  runLimit: number;
  // Source characters included per entitlement period; on Free this is the whole account's one-time allowance.
  includedCharacters: number;
  // Free's allowance is granted once per account; paid plans refill every entitlement period.
  oneTime: boolean;
  priceIdr: number;
  features: readonly Feature[];
};

const PLUS_FEATURES: readonly Feature[] = ['saved_styles', 'purchase_topup'];
const PRO_FEATURES: readonly Feature[] = [...PLUS_FEATURES, 'advanced_notebook', 'docx_import', 'docx_export'];
const MAX_FEATURES: readonly Feature[] = [...PRO_FEATURES, 'freeform_prompt', 'persistent_personalization', 'style_reference'];

export const PLAN_LIMITS: Record<Tier, PlanLimits> = {
  free: { runLimit: 1_000, includedCharacters: 3_000, oneTime: true, priceIdr: 0, features: [] },
  plus: { runLimit: 2_000, includedCharacters: 25_000, oneTime: false, priceIdr: 49_000, features: PLUS_FEATURES },
  pro: { runLimit: 5_000, includedCharacters: 100_000, oneTime: false, priceIdr: 179_000, features: PRO_FEATURES },
  max: { runLimit: 5_000, includedCharacters: 350_000, oneTime: false, priceIdr: 499_000, features: MAX_FEATURES },
};

// Top-ups sell AI characters only: they never grant a feature and never change the tier.
export const TOP_UPS = [
  { id: 'small', priceIdr: 19_000, characters: 15_000 },
  { id: 'medium', priceIdr: 49_000, characters: 45_000 },
  { id: 'large', priceIdr: 99_000, characters: 100_000 },
] as const;
export type TopUp = (typeof TOP_UPS)[number];
// A purchased balance stays usable for a year, and only while a paid plan is active.
export const TOP_UP_VALIDITY_MONTHS = 12;

// A free-form instruction can return more text than it was given, so the hold has to cover the longer of the two
// before the provider is called; the settled charge is MAX(source, output) and never more than this hold.
export const FREEFORM_RESERVE_FACTOR = 2;

// Key inside a notebook's preferences that turns on advanced mode; shared so client and server agree on the name.
export const ADVANCED_PREFERENCE = 'advanced';
// Page size of an imported document, so the paged preview matches the file the user brought in
// instead of falling back to the locale default.
export const PAGE_SIZE_PREFERENCE = 'pageSize';
// Page margins of an imported document as "top,right,bottom,left" twips (see formatMargins in docx/office-defaults).
export const PAGE_MARGINS_PREFERENCE = 'pageMargins';
// Page orientation ('portrait' | 'landscape'), newspaper column count (1..3), and the running header/footer
// text with its alignment. All four are page layout, not writing settings, so they live beside the two above.
export const PAGE_ORIENTATION_PREFERENCE = 'pageOrientation';
export const PAGE_COLUMNS_PREFERENCE = 'pageColumns';
export const HEADER_TEXT_PREFERENCE = 'headerText';
export const HEADER_ALIGN_PREFERENCE = 'headerAlign';
export const FOOTER_TEXT_PREFERENCE = 'footerText';
export const FOOTER_ALIGN_PREFERENCE = 'footerAlign';
// Every key the page layout owns, so a notebook can be patched with exactly these and nothing else.
export const PAGE_LAYOUT_PREFERENCES = [
  PAGE_SIZE_PREFERENCE, PAGE_MARGINS_PREFERENCE, PAGE_ORIENTATION_PREFERENCE, PAGE_COLUMNS_PREFERENCE,
  HEADER_TEXT_PREFERENCE, HEADER_ALIGN_PREFERENCE, FOOTER_TEXT_PREFERENCE, FOOTER_ALIGN_PREFERENCE,
] as const;

export const isTier = (value: unknown): value is Tier => typeof value === 'string' && (TIERS as readonly string[]).includes(value);
export const asTier = (value: unknown): Tier => (isTier(value) ? value : typeof value === 'string' && LEGACY_TIERS[value] ? LEGACY_TIERS[value] : 'free');
export const planLimits = (tier: Tier): PlanLimits => PLAN_LIMITS[tier];

export const hasFeature = (features: readonly Feature[], feature: Feature): boolean => features.includes(feature);

// Cheapest tier that includes the feature, so upsell copy names a real plan instead of a hardcoded one.
export const requiredTierFor = (feature: Feature): Tier => TIERS.find((tier) => PLAN_LIMITS[tier].features.includes(feature)) ?? 'pro';

// Highest run limit on offer; used by copy that explains what upgrading buys.
export const MAX_RUN_LIMIT = Math.max(...TIERS.map((tier) => PLAN_LIMITS[tier].runLimit));

// An admin is unlimited, so they get the most generous plan on offer instead of whatever tier their row says.
// Without this an admin on tier 'free' held every feature but still ran into the 3,000-character free cap.
export const UNLIMITED_LIMITS: PlanLimits = { runLimit: MAX_RUN_LIMIT, includedCharacters: Number.MAX_SAFE_INTEGER, oneTime: false, priceIdr: 0, features: FEATURES };
export const effectiveLimits = (tier: Tier, unlimited: boolean): PlanLimits => (unlimited ? UNLIMITED_LIMITS : PLAN_LIMITS[tier]);
