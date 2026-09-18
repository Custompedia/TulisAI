// A free-form instruction the writer types about a selected passage ("ubah ini ke english", "persingkat ini").
// It is untrusted text: it rides in the USER message as its own block, never in the system prompt, and it can
// never switch off the protected-term, citation or number checks.

// One instruction, not a brief. Long enough for "ubah ini ke english dan buat lebih ringkas" with room to spare,
// short enough that it cannot crowd out the passage itself.
export const INSTRUCTION_LIMIT = 300;
// Where the character counter appears, so it only shows up when the limit is actually close.
export const INSTRUCTION_COUNTER_AT = 240;

// Same treatment as the author note and the style sample: angle brackets removed so nothing can pose as a
// prompt block, spacing tamed, hard cap applied. Returns undefined when nothing usable is left.
export function sanitizeInstruction(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/[<>]/g, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, INSTRUCTION_LIMIT)
    .trim();
  return cleaned || undefined;
}

export const instructionTooLong = (value: string) => value.trim().length > INSTRUCTION_LIMIT;
