// One catalogue of plan limits and feature gates, shared by client hints and server enforcement.
// Client-safe: no server imports, no env reads. The free character quota is the only tunable, read server-side.

export const TIERS = ['free', 'plus', 'pro', 'team'] as const;
export type Tier = (typeof TIERS)[number];

export const FEATURES = ['advanced_notebook', 'docx_import', 'docx_export', 'freeform_prompt'] as const;
export type Feature = (typeof FEATURES)[number];

export type PlanLimits = {
  // Characters allowed in a single paraphrase run, whether the scope is a selection or the whole notebook.
  runLimit: number;
  // Source characters allowed per calendar month.
  monthlyCharacters: number;
  features: readonly Feature[];
};

const PAID_FEATURES: readonly Feature[] = FEATURES;

export const PLAN_LIMITS: Record<Tier, PlanLimits> = {
  free: { runLimit: 1_000, monthlyCharacters: 100_000, features: [] },
  plus: { runLimit: 2_000, monthlyCharacters: 500_000, features: PAID_FEATURES },
  pro: { runLimit: 5_000, monthlyCharacters: 2_000_000, features: PAID_FEATURES },
  team: { runLimit: 5_000, monthlyCharacters: 3_000_000, features: PAID_FEATURES },
};

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
export const asTier = (value: unknown): Tier => (isTier(value) ? value : 'free');
export const planLimits = (tier: Tier): PlanLimits => PLAN_LIMITS[tier];

export const hasFeature = (features: readonly Feature[], feature: Feature): boolean => features.includes(feature);

// Cheapest tier that includes the feature, so upsell copy names a real plan instead of a hardcoded one.
export const requiredTierFor = (feature: Feature): Tier => TIERS.find((tier) => PLAN_LIMITS[tier].features.includes(feature)) ?? 'pro';

// Highest run limit on offer; used by copy that explains what upgrading buys.
export const MAX_RUN_LIMIT = Math.max(...TIERS.map((tier) => PLAN_LIMITS[tier].runLimit));

// An admin is unlimited, so they get the most generous plan on offer instead of whatever tier their row says.
// Without this an admin on tier 'free' held every feature but still ran into the 1,000-character free cap.
export const UNLIMITED_LIMITS: PlanLimits = { runLimit: MAX_RUN_LIMIT, monthlyCharacters: Number.MAX_SAFE_INTEGER, features: FEATURES };
export const effectiveLimits = (tier: Tier, unlimited: boolean): PlanLimits => (unlimited ? UNLIMITED_LIMITS : PLAN_LIMITS[tier]);
