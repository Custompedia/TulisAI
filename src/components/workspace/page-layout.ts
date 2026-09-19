import {
  asColumns, asOrientation, defaultPageSize, formatMargins, pageGeometry, parseMargins, TWIPS_PER_INCH,
  type Orientation, type PageMargins, type PageSize,
} from '@/lib/docx/office-defaults';
import { asRunningText, type RunningText } from '@/lib/docx/running';
import {
  FOOTER_ALIGN_PREFERENCE, FOOTER_TEXT_PREFERENCE, HEADER_ALIGN_PREFERENCE, HEADER_TEXT_PREFERENCE,
  PAGE_COLUMNS_PREFERENCE, PAGE_MARGINS_PREFERENCE, PAGE_ORIENTATION_PREFERENCE, PAGE_SIZE_PREFERENCE,
} from '@/lib/plans';

export type PageLayout = {
  size: PageSize; margins: PageMargins; orientation: Orientation; columns: number;
  header: RunningText | null; footer: RunningText | null;
};

// Word's own margin sets, which is what the page setup dialog offers before anyone types a number.
export const MARGIN_PRESETS: Record<'normal' | 'narrow' | 'moderate' | 'wide', PageMargins> = {
  normal: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
  narrow: { top: 720, right: 720, bottom: 720, left: 720 },
  moderate: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
  wide: { top: 1440, right: 2880, bottom: 1440, left: 2880 },
};

export const sameMargins = (a: PageMargins, b: PageMargins) => a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

// The layout a notebook is stored with; anything missing or unusable falls back to Word's default for the language.
export function readLayout(preferences: Record<string, unknown> | undefined, language: string): PageLayout {
  const stored = preferences ?? {};
  const raw = stored[PAGE_SIZE_PREFERENCE];
  const size: PageSize = raw === 'a4' || raw === 'letter' ? raw : defaultPageSize(language);
  const orientation = asOrientation(stored[PAGE_ORIENTATION_PREFERENCE]);
  return {
    size, orientation,
    margins: parseMargins(stored[PAGE_MARGINS_PREFERENCE], size, orientation) ?? { ...pageGeometry(size, orientation).margin },
    columns: asColumns(stored[PAGE_COLUMNS_PREFERENCE]),
    header: asRunningText(stored[HEADER_TEXT_PREFERENCE], stored[HEADER_ALIGN_PREFERENCE]),
    footer: asRunningText(stored[FOOTER_TEXT_PREFERENCE], stored[FOOTER_ALIGN_PREFERENCE]),
  };
}

// Preferences hold primitives only, so the header and footer travel as their text and alignment.
export function layoutPreferences(layout: PageLayout): Record<string, string | number | null> {
  return {
    [PAGE_SIZE_PREFERENCE]: layout.size,
    [PAGE_MARGINS_PREFERENCE]: formatMargins(layout.margins),
    [PAGE_ORIENTATION_PREFERENCE]: layout.orientation,
    [PAGE_COLUMNS_PREFERENCE]: asColumns(layout.columns),
    [HEADER_TEXT_PREFERENCE]: layout.header?.text ?? null,
    [HEADER_ALIGN_PREFERENCE]: layout.header?.align ?? null,
    [FOOTER_TEXT_PREFERENCE]: layout.footer?.text ?? null,
    [FOOTER_ALIGN_PREFERENCE]: layout.footer?.align ?? null,
  };
}

// Margins are typed in the unit the writer's locale uses: centimetres everywhere but the US letter world.
export type MarginUnit = 'cm' | 'in';
export const marginUnit = (language: string): MarginUnit => (language === 'en' ? 'in' : 'cm');
const PER_UNIT: Record<MarginUnit, number> = { cm: TWIPS_PER_INCH / 2.54, in: TWIPS_PER_INCH };
export const twipsToUnit = (twips: number, unit: MarginUnit) => Math.round((twips / PER_UNIT[unit]) * 100) / 100;
export const unitToTwips = (value: number, unit: MarginUnit) => Math.round(value * PER_UNIT[unit]);
