import type { Entitlement } from "./quota";
import { hasFeature } from "@/lib/plans";

export const PREMIUM_PERSISTED_KEYS = [
  "extra", "customized", "sample", "additional_instruction", "additionalInstruction", "extra_request", "extraRequest",
  "style_reference", "styleReference", "style_sample", "styleSample", "user_instruction", "userInstruction",
  "personalization", "custom_instruction", "customInstruction",
] as const;

// The Sesuaikan flag turns on the stored format, length, reader and emphasis (the fields themselves are ordinary
// settings). Plus and Pro keep it, the owner decided (Fase 2): a skill like "Caption singkat, poin" has to survive a
// reload. The free-text note, the instruction and the writing sample stay Max-only, exactly as before.
const SAVED_STYLE_KEYS: ReadonlySet<string> = new Set(["customized"]);

// Existing Max values survive a downgrade, but no below-Max request can add,
// replace, clear, or alias them. Plus/Pro (saved_styles) may set the Sesuaikan flag; Free may not.
export function storedSettingsForAccess(rights: Entitlement, incoming: Record<string, unknown>, existing?: Record<string, unknown>): Record<string, unknown> {
  if (hasFeature(rights.features, "persistent_personalization") && hasFeature(rights.features, "style_reference")) return incoming;
  const keepsCustomization = hasFeature(rights.features, "saved_styles");
  const next = { ...incoming };
  for (const key of PREMIUM_PERSISTED_KEYS) {
    if (keepsCustomization && SAVED_STYLE_KEYS.has(key)) continue;
    if (existing && Object.hasOwn(existing, key)) next[key] = existing[key];
    else delete next[key];
  }
  return next;
}

// Called only after normalizeRuntime, so all accepted request aliases have
// converged to these canonical fields before capability enforcement.
export function runtimeForAccess(rights: Entitlement, normalized: Record<string, unknown>): Record<string, unknown> {
  const next = { ...normalized };
  if (!hasFeature(rights.features, "style_reference")) delete next.style_reference;
  if (!hasFeature(rights.features, "persistent_personalization")) {
    delete next.user_instruction;
    if (next.request && typeof next.request === "object" && !Array.isArray(next.request)) {
      next.request = { ...(next.request as Record<string, unknown>), additional_instruction: "" };
    }
  }
  return next;
}
