import { describe, expect, it } from "vitest";
import { customConflict, defaults, detectLanguage, modeFromPrompt, runtimeControls } from "../../src/lib/writing/settings";
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
});

describe("local analytics", () => {
  it("counts sentences, repeated words and word deltas without AI", () => {
    expect(countSentences("Kalimat pertama. Kalimat kedua! Ketiga?")).toBe(3);
    expect(countSentences("")).toBe(0);
    expect(repeatedWords("sistem sistem sistem data data")).toEqual([{ word: "sistem", count: 3 }]);
    expect(wordDelta("satu dua tiga", "satu empat tiga lima")).toEqual({ added: 2, removed: 1 });
  });
});
