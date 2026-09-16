import { describe, expect, it } from "vitest";
import { AI_SCOPE_LIMIT, customConflict, defaults, detectLanguage, EXTRA_LIMIT, FOCUS_LIMIT, INLINE_LIMIT, modeFromPrompt, runtimeControls, SELECTION_LIMIT } from "../../src/lib/writing/settings";
import { countSentences, repeatedWords, wordDelta } from "../../src/lib/editor/metrics";

describe("writing settings", () => {
  it("blocks conflicting customize choices before any AI call", () => {
    expect(customConflict({ ...defaults, format: "short_summary", length: "more_detailed" }, [])).toBe("summary-detail");
    expect(customConflict({ ...defaults, extra: "ubah Technology Acceptance Model jadi TAM" }, ["Technology Acceptance Model"])).toBe("locked-term");
    expect(customConflict({ ...defaults, extra: "fokus pada kesimpulan" }, ["TAM"])).toBeNull();
  });
  it("detects Indonesian and English and reports ambiguity", () => {
    expect(detectLanguage("Penelitian ini menunjukkan bahwa sistem yang digunakan tidak efektif.")).toBe("id");
    expect(detectLanguage("This study shows that the system is not effective for the users.")).toBe("en");
    expect(detectLanguage("OK 123")).toBeNull();
  });
  it("falls back to a general audience when a custom audience is blank", () => {
    expect(runtimeControls({ ...defaults, audience: " ", customized: true }, "id").custom_request).toMatchObject({ audience: "general_public" });
    expect(modeFromPrompt("P03_HUMANIZER")).toBe("humanize");
  });
  it("exposes the v3 cost-safe limits", () => {
    expect({ EXTRA_LIMIT, FOCUS_LIMIT, INLINE_LIMIT, SELECTION_LIMIT, AI_SCOPE_LIMIT }).toEqual({ EXTRA_LIMIT: 200, FOCUS_LIMIT: 3, INLINE_LIMIT: 600, SELECTION_LIMIT: 5_000, AI_SCOPE_LIMIT: 20_000 });
  });
});

describe("local analytics", () => {
  it("counts sentences, repeated words and word deltas without AI", () => {
    expect(countSentences("Kalimat pertama. Kalimat kedua! Ketiga?")).toBe(3);
    expect(countSentences("")).toBe(0);
    expect(repeatedWords("sistem sistem sistem data data")).toEqual([{ word: "sistem", count: 3 }]);
    expect(wordDelta("satu dua tiga", "satu empat tiga lima")).toEqual({ added: 2, removed: 1 });
  });
});
