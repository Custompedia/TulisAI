// What Tulis Lab sells on Lynk (owner 2026-11-13), in the custompedia store lynk.id/custompedia. The webhook maps a
// paid Lynk item to a grant (src/server/payments/lynk.ts); the plans dialog links to the same products. A product
// changed or added on Lynk must be changed here too. Client-safe: no server imports.
import { PLAN_LIMITS, TOP_UPS, type TopUp } from './plans';

export type LynkPlan = 'plus' | 'pro' | 'max';
export type LynkProductKey = `${LynkPlan}-1m` | `${LynkPlan}-12m` | `topup-${TopUp['id']}`;

export type LynkProduct = {
  key: LynkProductKey;
  /** Lynk's product id: the 24-hex part its webhook items carry at the start of `uuid`. */
  lynkId: string;
  /** The title on Lynk, matched when an item's uuid does not name a product here. */
  title: string;
  priceIdr: number;
  /** The product page on Lynk. */
  url: string;
} & ({ kind: 'plan'; plan: LynkPlan; months: 1 | 12 } | { kind: 'topup'; pack: TopUp['id'] });

const STORE = 'https://lynk.id/custompedia';

// Yearly: twelve monthly periods, each with the plan's own allowance; "hemat 4 bulan" (owner 2026-11-13).
export const YEARLY_PRICE_IDR: Record<LynkPlan, number> = { plus: 390_000, pro: 1_430_000, max: 3_990_000 };

// Lynk's product id and page of each top-up, created 2026-11-13.
const TOP_UP_LYNK: Record<TopUp['id'], [string, string]> = {
  small: ['6af69539ffd313380e0d1654', 'z4vqoqdowj41'],
  medium: ['6af695968453ee31f0243556', '3d1r6rd8mm57'],
  large: ['6af695e8980a013135e62f4a', 'ze7gqgyklwyw'],
};

// Created on Lynk 2026-11-13 (digital products, one per checkout, delivering a link to /app).
export const LYNK_PRODUCTS: readonly LynkProduct[] = [
  { key: 'plus-1m', kind: 'plan', plan: 'plus', months: 1, lynkId: '6af69271fc063a43e92c19b5', title: 'Tulis Lab Plus – Bulanan', priceIdr: PLAN_LIMITS.plus.priceIdr, url: `${STORE}/qljvgomx30w7` },
  { key: 'pro-1m', kind: 'plan', plan: 'pro', months: 1, lynkId: '6af693278453ee31f024331f', title: 'Tulis Lab Pro – Bulanan', priceIdr: PLAN_LIMITS.pro.priceIdr, url: `${STORE}/8p2z1xk8z78p` },
  { key: 'max-1m', kind: 'plan', plan: 'max', months: 1, lynkId: '6af69387f29994c67bdaa1ad', title: 'Tulis Lab Max – Bulanan', priceIdr: PLAN_LIMITS.max.priceIdr, url: `${STORE}/z5lo0dll2zgq` },
  { key: 'plus-12m', kind: 'plan', plan: 'plus', months: 12, lynkId: '6af693e3a1089c2bb0b09351', title: 'Tulis Lab Plus – Tahunan', priceIdr: YEARLY_PRICE_IDR.plus, url: `${STORE}/g4xmyjo8wy65` },
  { key: 'pro-12m', kind: 'plan', plan: 'pro', months: 12, lynkId: '6af69475ffd313380e0d15d7', title: 'Tulis Lab Pro – Tahunan', priceIdr: YEARLY_PRICE_IDR.pro, url: `${STORE}/3mv46o4v7v6r` },
  { key: 'max-12m', kind: 'plan', plan: 'max', months: 12, lynkId: '6af694d2537c7ba2bcea9bbf', title: 'Tulis Lab Max – Tahunan', priceIdr: YEARLY_PRICE_IDR.max, url: `${STORE}/kmyr0911nxe8` },
  ...TOP_UPS.map((pack): LynkProduct => ({
    key: `topup-${pack.id}`, kind: 'topup', pack: pack.id, lynkId: TOP_UP_LYNK[pack.id][0], priceIdr: pack.priceIdr, url: `${STORE}/${TOP_UP_LYNK[pack.id][1]}`,
    title: `Tulis Lab Tambahan ${pack.characters.toLocaleString('id-ID')} Karakter`,
  })),
];

export const lynkProduct = (key: LynkProductKey): LynkProduct => LYNK_PRODUCTS.find((product) => product.key === key)!;

const plainTitle = (value: unknown) => String(value ?? '').replace(/[‐-―-]+/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

/** The Tulis Lab product a Lynk webhook item is, by its product id, else by its exact title; null for anything else. */
export function lynkProductOf(item: { uuid?: unknown; title?: unknown }): LynkProduct | null {
  const id = String(item.uuid ?? '').split('-')[0]!.toLowerCase();
  return (id.length === 24 ? LYNK_PRODUCTS.find((product) => product.lynkId === id) : undefined)
    ?? LYNK_PRODUCTS.find((product) => plainTitle(product.title) === plainTitle(item.title)) ?? null;
}
