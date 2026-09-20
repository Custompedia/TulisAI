import type { Entitlement } from "./quota";
import { hasFeature } from "@/lib/plans";

export const PREMIUM_PERSISTED_KEYS = [
  "extra", "customized", "sample", "additional_instruction", "additionalInstruction", "extra_request", "extraRequest",
  "style_reference", "styleReference", "style_sample", "styleSample", "user_instruction", "userInstruction",
  "personalization", "custom_instruction", "customInstruction",
] as const;

// Existing Max values survive a downgrade, but no below-Max request can add,
// replace, clear, or alias them.
export function storedSettingsForAccess(rights: Entitlement, incoming: Record<string, unknown>, existing?: Record<string, unknown>): Record<string, unknown> {
  if (hasFeature(rights.features, "persistent_personalization") && hasFeature(rights.features, "style_reference")) return incoming;
  const next = { ...incoming };
  for (const key of PREMIUM_PERSISTED_KEYS) {
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
