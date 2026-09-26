export function relativeTime(value: string | number | Date, locale: 'id' | 'en'): string {
  const date = new Date(value); const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return locale === 'en' ? 'just now' : 'baru saja';
}

export const dateTime = (value: string | number | Date, locale: 'id' | 'en') =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export const dateOnly = (value: string | number | Date, locale: 'id' | 'en') =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

export const numberFormat = (value: number, locale: 'id' | 'en') => new Intl.NumberFormat(locale).format(value);
// Sub-cent AI costs need extra decimals to stay readable.
export const usdFormat = (value: number, locale: 'id' | 'en') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value >= 1 ? 2 : value >= 0.01 ? 4 : 6 }).format(value);
