import { describe, expect, it } from "vitest";
import { changePercentage, countCharacters, countWords, readingMinutes } from "../../src/lib/editor/metrics";

describe("bounded local metrics", () => {
  it("handles empty, Indonesian, English, and Unicode text", () => {
    expect(changePercentage("", "")).toBe(0);
    expect(changePercentage("", "hello")).toBe(100);
    expect(changePercentage("Teks asli 🌏", "Teks baru 🌏")).toBeGreaterThan(0);
    expect(countWords("One two")).toBe(2);
    expect(countCharacters("🌏")).toBe(1);
    expect(readingMinutes("kata ".repeat(200))).toBe(1);
  });
  it("finishes on large disjoint input through bounded fallback", () => {
    const before = "alpha ".repeat(40_000);
    const after = "beta ".repeat(40_000);
    expect(changePercentage(before, after)).toBe(100);
  });
});
