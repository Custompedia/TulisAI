import { z } from "zod";
import { NOTEBOOK_COLORS, parseNotebookIcon, type NotebookColor } from "@/lib/notebook/appearance";
import { normalizeSettings, type Settings } from "./settings";

export const STYLE_LIMIT = 10;
export const STYLE_NAME_LIMIT = 40;

const name = z.string().trim().min(1).max(STYLE_NAME_LIMIT);
const color = z.enum(NOTEBOOK_COLORS).nullable();
const icon = z.string().max(64).nullable().refine((value) => value === null || parseNotebookIcon(value) !== null, "Icon must be emoji:<1-16 chars> or icon:<allowlisted name>.");
const settings = z.record(z.string(), z.unknown());
export const StyleInputSchema = z.object({ name, color: color.default(null), icon: icon.default(null), settings }).strict();
export const StylePatchSchema = z.object({ name: name.optional(), color: color.optional(), icon: icon.optional(), settings: settings.optional() }).strict().refine((value) => Object.keys(value).length > 0, "Nothing to update.");
export type StyleInput = z.infer<typeof StyleInputSchema>;
export type StylePatch = z.infer<typeof StylePatchSchema>;

// A saved style is a full settings snapshot; the language and the active-style marker stay with the document.
export type WritingStyle = { id: string; name: string; color: NotebookColor | null; icon: string | null; settings: Settings; createdAt: string; updatedAt: string };

export const styleSettings = (raw: Record<string, unknown> | null | undefined): Settings => ({ ...normalizeSettings(raw), language: "auto", styleId: null });
export const applyStyle = (current: Settings, style: WritingStyle): Settings => ({ ...style.settings, language: current.language, styleId: style.id });
const comparable = (value: Settings) => JSON.stringify({ ...value, language: undefined, styleId: undefined });
export const matchesStyle = (value: Settings, style: WritingStyle) => comparable(value) === comparable(style.settings);
// Drops the style marker once the settings drift from the saved preset (or the preset is gone).
export function reconcileStyle(next: Settings, styles: WritingStyle[]): Settings {
  if (!next.styleId) return next;
  const style = styles.find((item) => item.id === next.styleId);
  return style && matchesStyle(next, style) ? next : { ...next, styleId: null };
}
