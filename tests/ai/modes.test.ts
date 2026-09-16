import { describe, expect, it } from "vitest";
import { academicOptions, audienceOptions, contextOptions, creativityOptions, focusOptions, formatOptions, humanizeStrengthOptions, languageOptions, lengthOptions, modeHint, modeLabel, MODES, preservationOptions, recipientOptions, requestSummary, simplifyForOptions, strengthOptions } from "../../src/components/writing/modes";
import { AUDIENCES, defaults, RECIPIENTS, SIMPLIFY_FOR } from "../../src/lib/writing/settings";

const id = (value: string) => value;
const en = (_: string, value: string) => value;
const builders = { languageOptions, strengthOptions, humanizeStrengthOptions, creativityOptions, academicOptions, contextOptions, preservationOptions, recipientOptions, simplifyForOptions, formatOptions, lengthOptions, audienceOptions, focusOptions };

describe("writing option copy", () => {
  it.each(Object.entries(builders))("gives every %s option a short hint in both languages", (_, build) => {
    for (const t of [id, en]) for (const option of build(t)) { expect(option.hint, option.value).toBeTruthy(); expect(option.hint!.length).toBeLessThanOrEqual(60); }
  });
  it("maps option values to the settings enums and v3 copy", () => {
    expect(recipientOptions(id).map((option) => option.value)).toEqual(RECIPIENTS);
    expect(simplifyForOptions(id).map((option) => option.value)).toEqual(SIMPLIFY_FOR);
    expect(audienceOptions(id).map((option) => option.value)).toEqual(AUDIENCES);
    expect(creativityOptions(id).map((option) => option.label)).toEqual(["Ringan", "Sedang", "Berani"]);
    expect(creativityOptions(en).map((option) => option.label)).toEqual(["Light", "Medium", "Bold"]);
    expect(preservationOptions(id).map((option) => [option.value, option.label])).toEqual([["conservative", "Sedikit (≤15%)"], ["balanced", "Sedang (≤30%)"], ["flexible", "Bebas (≤50%)"]]);
    expect(strengthOptions(id)[0]!.hint).toBe("Ganti kata saja, susunan kalimat tetap");
    expect(formatOptions(id).find((option) => option.value === "short_summary")!.hint).toBe("Sekitar 40% panjang, semua klaim tetap");
  });
  it("labels standard as Parafrase everywhere and has no custom mode", () => {
    expect(modeLabel("standard", id)).toBe("Parafrase"); expect(modeLabel("standard", en)).toBe("Paraphrase");
    expect(MODES).toEqual(["humanize", "standard", "academic", "professional", "creative", "simplify"]);
    expect(modeHint("humanize", id)).toBe("Ubah teks yang terasa AI jadi natural"); expect(modeHint("humanize", en)).toBe("Make AI-sounding text read naturally");
  });
  it("summarises the new fields", () => {
    expect(requestSummary({ ...defaults, mode: "professional", recipient: "klien" }, id)).toBe("Profesional · untuk klien");
    expect(requestSummary({ ...defaults, mode: "simplify", simplifyFor: "anak_sekolah" }, en)).toBe("Simplify · for school-age reader");
    expect(requestSummary({ ...defaults, mode: "creative", strength: "strong", customized: true, audience: "lecturer", focus: ["clarity"] }, id)).toBe("Kreatif · kreativitas berani · panjang sama · pembaca dosen / penelaah · penekanan kejelasan");
  });
});
