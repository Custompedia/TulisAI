export const CHARACTER_MEASUREMENT_VERSION = "unicode_code_points_v1" as const;

/** OD-11 commercial measurement: Unicode scalar/code-point iteration, not UTF-16 code units. */
export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
};

/** Hash only normalized, bounded request facts; callers must not pass raw writing content. */
export async function requestFingerprint(facts: Record<string, unknown>): Promise<string> {
  return sha256(JSON.stringify(stable(facts)));
}
