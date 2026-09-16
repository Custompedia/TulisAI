import { describe, expect, it } from "vitest";
import { requestOf, structuralErrors, validateGeneration } from "../../src/server/ai/core";
import { lengthBand, mergeWarnings, paragraphCount, paragraphsPreserved, repairDrift, sentenceLengthDeviation, sentences, simplifyLengthKept, softWarnings, varianceHolds, withinBand, wordCount } from "../../src/server/ai/core/validators";

const transform = (text: string, extra: Record<string, unknown> = {}) => ({ transformed_text: text, change_categories: [], warnings: [], no_change_needed: false, ...extra });
const words = (count: number, word = "kata") => Array.from({ length: count }, () => word).join(" ");

describe("validator helpers", () => {
  it("counts words, sentences and paragraphs like the editor text", () => {
    expect(wordCount("Tim kami memakai API v2, lalu selesai.")).toBe(7);
    expect(wordCount("")).toBe(0);
    expect(sentences("Kalimat satu. Kalimat dua!\nKalimat tiga?")).toEqual(["Kalimat satu.", "Kalimat dua!", "Kalimat tiga?"]);
    expect(paragraphCount("Satu.\n\nDua.\nTiga.\n  \n")).toBe(3);
    expect(paragraphCount("Satu baris")).toBe(1);
  });
  it("keeps paragraph counts unless a list or summary format was requested", () => {
    expect(paragraphsPreserved("A.\nB.", "A.\n\nB.")).toBe(true);
    expect(paragraphsPreserved("A.\nB.", "A. B.")).toBe(false);
    for (const format of ["poin", "bernomor", "tabel", "ringkasan"]) expect(paragraphsPreserved("A.\nB.", "A. B.", format)).toBe(true);
    expect(paragraphsPreserved("A.\nB.", "A. B.", "paragraf")).toBe(false);
  });
  it("guards simplification against summarising", () => {
    expect(simplifyLengthKept(words(20), words(17))).toBe(true);
    expect(simplifyLengthKept(words(20), words(16))).toBe(false);
  });
  it("picks the requested length band and tolerates short inputs", () => {
    expect(lengthBand("P01_STANDARD_REWRITE", undefined)).toEqual({ min: 0.85, max: 1.15 });
    expect(lengthBand("P02_ACADEMIC", undefined)).toBeNull();
    expect(lengthBand("P02_ACADEMIC", { length: "lebih singkat" })).toEqual({ min: 0.5, max: 0.8 });
    expect(lengthBand("P02_ACADEMIC", { format: "ringkasan", length: "lebih singkat" })).toEqual({ min: 0.25, max: 0.55 });
    expect(lengthBand("P04_PROFESSIONAL", { length: "lebih detail" })).toEqual({ min: 1.2, max: 1.6 });
    expect(withinBand(words(20), words(22), { min: 0.85, max: 1.15 })).toBe(true);
    expect(withinBand(words(20), words(24), { min: 0.85, max: 1.15 })).toBe(false);
    expect(withinBand(words(5), words(9), { min: 0.85, max: 1.15 })).toBe(true);
  });
  it("measures sentence-length variance before and after", () => {
    const uneven = "Satu. Dua kata di sini sekarang. Tiga kata lagi ya ini panjang sekali memang.";
    const flat = "Satu dua tiga. Empat lima enam. Tujuh delapan sembilan.";
    expect(sentenceLengthDeviation(flat)).toBe(0);
    expect(varianceHolds(flat, uneven)).toBe(true);
    expect(varianceHolds(uneven, flat)).toBe(false);
    expect(varianceHolds("Satu. Dua.", "Satu dua.")).toBe(true);
  });
  it("detects P10 drift outside violating sentences", () => {
    const failed = "Pesanan berisi item. Kirim besok pagi.";
    const violations = [{ required: "4", found: "(missing)" }];
    expect(repairDrift(failed, "Pesanan berisi 4 item. Kirim besok pagi.", violations)).toEqual([]);
    expect(repairDrift(failed, "Pesanan berisi 4 item. Kirimkan besok pagi.", violations)).toEqual(["sentence 2 changed without a violation"]);
    expect(repairDrift(failed, "Pesanan berisi 4 item.", violations)[0]).toMatch(/sentence count/);
    expect(repairDrift("Ada 5 unit. Baik.", "Ada unit. Baik.", [{ required: "(not in original)", found: "5" }])).toEqual([]);
  });
  it("merges soft warnings without exceeding three", () => {
    expect(mergeWarnings(["a", "b", "c"], ["x"])).toEqual(["a", "b", "x"]);
    expect(mergeWarnings(undefined, ["x", "y"])).toEqual(["x", "y"]);
    expect(mergeWarnings(["a"], [])).toEqual(["a"]);
  });
});

describe("soft warnings", () => {
  const long = "Tim kami menyelesaikan migrasi sistem pada bulan lalu. Semua layanan berjalan normal setelah pengujian selesai dilakukan.";
  it("flags sentence count changes only at light P01", () => {
    const merged = "Tim kami menyelesaikan migrasi sistem pada bulan lalu dan semua layanan berjalan normal setelah pengujian selesai dilakukan.";
    expect(softWarnings("P01_STANDARD_REWRITE", long, merged, { language: "id", strength: "light" })).toContain("Jumlah kalimat berubah padahal kekuatan Ringan.");
    expect(softWarnings("P01_STANDARD_REWRITE", long, merged, { language: "en", strength: "strong" })).toEqual([]);
    expect(softWarnings("P01_STANDARD_REWRITE", long, long, { language: "id", strength: "light" })).toEqual([]);
  });
  it("flags lengths outside the requested band in the runtime language", () => {
    expect(softWarnings("P01_STANDARD_REWRITE", long, "Migrasi selesai.", { language: "en", strength: "balanced" })).toEqual(["The result length is outside the requested range."]);
    expect(softWarnings("P02_ACADEMIC", long, "Migrasi selesai.", { language: "id" })).toEqual([]);
    expect(softWarnings("P02_ACADEMIC", long, "Tim kami menyelesaikan migrasi sistem bulan lalu; layanan normal setelah diuji.", { language: "id", request: { length: "lebih singkat" } })).toEqual([]);
    expect(softWarnings("P02_ACADEMIC", long, long, { language: "id", request: { length: "lebih singkat" } })).toEqual(["Panjang hasil di luar rentang yang diminta."]);
  });
  it("flags P03 output that flattens sentence length", () => {
    const uneven = "Kami datang. Setelah itu kami menyiapkan laporan panjang untuk seluruh tim proyek. Selesai.";
    const flat = "Kami datang pagi ini. Kami menyiapkan laporan tim. Laporan itu sudah selesai.";
    expect(softWarnings("P03_HUMANIZER", uneven, flat, { language: "id", strength: "balanced" })).toContain("Panjang kalimat jadi lebih seragam dari teks asli.");
    expect(softWarnings("P03_HUMANIZER", flat, uneven, { language: "id", strength: "balanced" })).toEqual([]);
    expect(softWarnings("P03_HUMANIZER", "Kalimat satu, lalu dua.", "Kalimat satu — lalu dua.", { language: "id", strength: "balanced" })).toEqual(["Hasil menambah tanda pisah (—) yang tidak ada di teks asli."]);
    expect(softWarnings("P03_HUMANIZER", "Kalimat satu — lalu dua.", "Kalimat satu, lalu dua.", { language: "en", strength: "balanced" })).toEqual([]);
  });
});

describe("hard validators in validateGeneration", () => {
  it("rejects paragraph count changes except for list and summary formats", () => {
    const source = "Paragraf pertama.\nParagraf kedua.";
    expect(() => validateGeneration("P02_ACADEMIC", source, transform("Paragraf pertama. Paragraf kedua."), {})).toThrow(/paragraph count/);
    expect(validateGeneration("P02_ACADEMIC", source, transform("Paragraf awal.\n\nParagraf berikutnya."), {}).transformed_text).toContain("awal");
    expect(validateGeneration("P01_STANDARD_REWRITE", source, transform("- Paragraf pertama\n- Paragraf kedua\n- Tambahan"), { custom_request: { format: "bullets" } }).transformed_text).toContain("Tambahan");
    expect(validateGeneration("P02_ACADEMIC", source, transform("Ringkas."), { request: { format: "ringkasan" } }).transformed_text).toBe("Ringkas.");
    expect(() => validateGeneration("P08_CUSTOM_TRANSFORM", source, transform("Satu paragraf."), { format: "paragraph" })).toThrow(/paragraph count/);
    expect(structuralErrors("P07_INLINE_ALTERNATIVES", source, "x", {})).toEqual([]);
  });
  it("rejects P06 output below 85% of the input words", () => {
    const source = words(20, "syarat");
    expect(() => validateGeneration("P06_SIMPLIFY", source, transform(words(12, "syarat")), {})).toThrow(/85%/);
    expect(validateGeneration("P06_SIMPLIFY", source, transform(words(18, "syarat")), {}).transformed_text).toBeTruthy();
  });
  it("rejects new numerals for P04 and P05 and fabricated or missing citations for P02 and P03", () => {
    expect(() => validateGeneration("P04_PROFESSIONAL", "Kirim laporan besok.", transform("Kirim 2 laporan besok."), {})).toThrow(/numeric/);
    expect(() => validateGeneration("P05_CREATIVE", "Aplikasi pencatat harian.", transform("Aplikasi pencatat harian nomor 1."), {})).toThrow(/numeric/);
    expect(() => validateGeneration("P02_ACADEMIC", "Hasilnya kuat (Davis, 2021).", transform("Hasilnya kuat."), { protectedCitations: ["(Davis, 2021)"] })).toThrow(/protected/);
    expect(() => validateGeneration("P03_HUMANIZER", "Hasilnya kuat.", transform("Hasilnya kuat (Smith, 2020)."), {})).toThrow(/citation/);
  });
  it("rejects P10 repairs that drift outside violating sentences", () => {
    const runtime = { failedOutput: "Pesanan berisi item. Kirim besok pagi.", requiredProtectedTerms: [], requiredProtectedCitations: [] };
    const original = "Pesanan berisi 4 item. Kirim besok pagi.";
    expect(validateGeneration("P10_REPAIR", original, { corrected_text: original, unrepairable_spans: [] }, runtime, 1).corrected_text).toBe(original);
    expect(() => validateGeneration("P10_REPAIR", original, { corrected_text: "Pesanan berisi 4 item. Kirimkan besok pagi.", unrepairable_spans: [] }, runtime, 1)).toThrow(/without a violation/);
  });
  it("reads the request from normalized or raw controls", () => {
    expect(requestOf("P01_STANDARD_REWRITE", { request: { format: "tabel", focus: [], additional_instruction: "" } })).toEqual({ format: "tabel" });
    expect(requestOf("P01_STANDARD_REWRITE", { custom_request: { format: "short_summary", length: "shorter" } })).toEqual({ format: "ringkasan", length: "lebih singkat" });
    expect(requestOf("P08_CUSTOM_TRANSFORM", { format: "numbered_list" })).toEqual({ format: "bernomor" });
    expect(requestOf("P01_STANDARD_REWRITE", {})).toBeUndefined();
  });
});
