import { z } from "zod";
import { modeTone, type ModeTone } from "@/components/writing/modes";
import { isMode } from "@/lib/writing/settings";

export const NOTEBOOK_COLORS = ["green", "blue", "orange", "slate", "pink", "gold", "gray"] as const;
export type NotebookColor = (typeof NOTEBOOK_COLORS)[number];

export const NOTEBOOK_ICON_NAMES = [
  "BookOpen", "NotebookPen", "GraduationCap", "Briefcase", "Feather", "Lightbulb", "Palette", "PenLine", "FileText", "Newspaper", "Mail", "Presentation", "FlaskConical", "Scale", "Code", "Globe",
  "Heart", "Star", "Sparkles", "Target", "Rocket", "Compass", "Camera", "Music", "Coffee", "Leaf", "Landmark", "Users", "MessageSquare", "ClipboardList", "Calendar", "Archive",
] as const;
export type NotebookIconName = (typeof NOTEBOOK_ICON_NAMES)[number];

export type NotebookIconValue = { kind: "emoji"; value: string } | { kind: "icon"; name: NotebookIconName };

const MAX_EMOJI = 16;
const iconNames = new Set<string>(NOTEBOOK_ICON_NAMES);
export const isNotebookColor = (value: unknown): value is NotebookColor => typeof value === "string" && (NOTEBOOK_COLORS as readonly string[]).includes(value);

export function parseNotebookIcon(raw: string | null | undefined): NotebookIconValue | null {
  if (!raw) return null;
  if (raw.startsWith("emoji:")) { const value = raw.slice(6); const length = Array.from(value).length; return length >= 1 && length <= MAX_EMOJI && value.trim() === value ? { kind: "emoji", value } : null; }
  if (raw.startsWith("icon:")) { const name = raw.slice(5); return iconNames.has(name) ? { kind: "icon", name: name as NotebookIconName } : null; }
  return null;
}

export const formatNotebookIcon = (value: NotebookIconValue): string => value.kind === "emoji" ? `emoji:${value.value}` : `icon:${value.name}`;

export const NotebookAppearanceSchema = z.object({
  color: z.enum(NOTEBOOK_COLORS).nullable(),
  icon: z.string().max(64).nullable().refine((value) => value === null || parseNotebookIcon(value) !== null, "Icon must be emoji:<1-16 chars> or icon:<allowlisted name>."),
}).strict();
export type NotebookAppearance = z.infer<typeof NotebookAppearanceSchema>;

// Falls back to the writing mode tone when no colour is stored.
export function notebookTone(color: string | null | undefined, mode: string | null | undefined): ModeTone {
  if (isNotebookColor(color)) return color;
  return isMode(mode) ? modeTone[mode] : "gray";
}
