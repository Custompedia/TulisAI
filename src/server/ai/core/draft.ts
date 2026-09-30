import { compareNumericValues } from "./numeric";
import { draftBriefFields, type DraftBriefField } from "./schemas";
import { plainDashes, sentences } from "./validators";

// UX 3, P11 "Draf dari brief": everything that is specific to drafting one section. The brief and the outline are the
// author's DATA: they are sanitised here and only ever sent inside tags of the USER message, never as instructions.
// The validators below are the guarantee behind the prompt's FACTS rule: a draft may not carry a number, a link, a
// citation, a quotation or a named source that the brief, the outline and the surrounding text do not contain.

export type DraftBlockType = "paragraph" | "subheading" | "bullet_list" | "numbered_list";
export type DraftBlock = { type: DraftBlockType; text: string; items: string[] };
export type DraftBrief = Record<DraftBriefField, string>;
export type DraftRuntime = {
  language: "id" | "en"; doc_type: string; academic: boolean; max_characters: number; brief: DraftBrief;
  outline: string[]; section_heading: string; context_before: string | null; context_after: string | null;
};

// One line per kind of writing, in the system prompt's KIND OF WRITING slot. Server-side table, like FORMAT_LINE.
export const DOC_TYPE_LINE: Record<string, string> = {
  article: "An article or blog post: an informative, readable section with one idea per paragraph.",
  script: "A script for a short video or a podcast, read aloud: short spoken sentences, one idea per line, and each line its own paragraph. No speaker labels, scene directions, or timestamps.",
  caption: "A social media caption or post: short lines, each its own paragraph. Hashtags only in a hashtag section, built from words in <brief>.",
  essay: "An academic essay, thesis chapter, or journal article section, in formal academic register.",
  report: "A report or proposal section for a busy decision-maker: the conclusion or recommendation first, then what supports it.",
  email: "One part of an email or letter (greeting, purpose, body, or closing): only what that part does.",
  product: "A product description: benefits before features, and only claims that <brief> states.",
  story: "A short story: scenes, actions, and concrete detail rather than explanation. Characters and events may be invented; write any number in words.",
  none: "A piece of writing whose kind the author has not set: match the register of <brief> and <context_before>.",
};
export const ACADEMIC_DOC_TYPES: ReadonlySet<string> = new Set(["essay"]);
// Fiction invents people and dialogue by design, so only the attribution and quotation guards step aside for it;
// numbers, links and citations stay guarded.
export const FICTION_DOC_TYPES: ReadonlySet<string> = new Set(["story"]);

// Data, never instructions: angle brackets are stripped so the text cannot open or close a tag, spacing is tamed,
// and the value is cut to its limit.
export const sanitizeDraftValue = (value: unknown, limit: number): string => typeof value === "string"
  ? value.replace(/[<>]/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit).trim()
  : "";

const BRIEF_LABEL: Record<DraftBriefField, string> = { topic: "Topic", platform: "Platform", audience: "Reader", message: "Key message", cta: "Call to action", duration: "Duration", notes: "Notes" };
const tag = (name: string, value: unknown) => typeof value === "string" && value ? `<${name}>\n${value}\n</${name}>` : "";

export function buildDraftUserMessage(runtime: DraftRuntime): string {
  const brief = draftBriefFields.filter((field) => runtime.brief[field]).map((field) => `${BRIEF_LABEL[field]}: ${runtime.brief[field]}`).join("\n");
  const outline = runtime.outline.map((heading) => `- ${heading}${heading === runtime.section_heading ? " (this section)" : ""}`).join("\n");
  return [tag("brief", brief), tag("outline", outline), tag("section", runtime.section_heading), tag("context_before", runtime.context_before), tag("context_after", runtime.context_after)].filter(Boolean).join("\n");
}

// Everything the draft may take a specific from.
export const draftSourceText = (runtime: DraftRuntime): string => [
  ...draftBriefFields.map((field) => runtime.brief[field]), ...runtime.outline, runtime.section_heading, runtime.context_before ?? "", runtime.context_after ?? "",
].filter(Boolean).join("\n");

// The draft as plain text, one line per paragraph, subheading or list item: what is measured, charged and checked.
export const draftText = (blocks: DraftBlock[]): string => blocks.flatMap((block) => (block.type === "bullet_list" || block.type === "numbered_list" ? block.items : [block.text])).join("\n");

export class DraftRejected extends Error {
  constructor(message: string, readonly cause: "fabrication" | "length" | "reference_list" | "empty") { super(message); this.name = "DraftRejected"; }
}

// More than this many invented specifics means the draft is guessing, not drafting: it is refused, not patched.
export const DRAFT_MAX_REPAIRS = 8;
const PLACEHOLDER: Record<"id" | "en", Record<"number" | "source" | "link" | "quote", string>> = {
  id: { number: "[angka]", source: "[sumber]", link: "[tautan]", quote: "[kutipan]" },
  en: { number: "[figure]", source: "[source]", link: "[link]", quote: "[quote]" },
};
const REFERENCE_HEADING = /^(?:daftar pustaka|daftar rujukan|referensi|rujukan|bibliografi|references?|bibliography|works cited|sumber)$/iu;
const URL = /\b(?:https?:\/\/|www\.)[^\s)\]]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|id|org|net|io|co|edu|gov|info|biz|me|app|dev|ly)(?:\/[^\s)\]]*)?\b/giu;
const BRACKET = /\[[^[\]\n]{1,120}\]/gu;
const CITATION = /\b\p{Lu}[\p{L}'’-]+(?:\s+(?:et al\.?|dkk\.?))?\s*\(\d{4}[a-z]?\)|\(\p{Lu}[\p{L}'’-]+(?:\s+(?:et al\.?|dkk\.?))?,?\s*\d{4}[a-z]?(?:[,:]\s*(?:hlm\.|p\.|pp\.)?\s*\d+(?:[-–]\d+)?)?\)|\b\p{Lu}[\p{L}'’-]+\s+(?:et al\.?|dkk\.)|\((?:[^()\n]*?)\b(?:ibid|op\. ?cit|hlm\.|doi:|ISBN)[^()\n]*\)/gu;
const QUOTE = /[“"]([^”"\n]{12,}?)[”"]/gu;
const PRONOUNS = new Set(["anda", "kamu", "kami", "saya", "kita", "mereka", "beliau", "bapak", "ibu", "you", "we", "i", "they", "us", "our", "your", "their"]);
const NAME = "\\p{Lu}[\\p{L}\\p{N}.&'’-]*(?:\\s+(?:\\p{Lu}[\\p{L}\\p{N}.&'’-]*|dan|and|of|&)){0,5}";
// Keywords match at a sentence start too; the name itself must start with a capital, so no case-insensitive flag.
const either = (words: string[]) => words.map((word) => `[${word[0]!.toUpperCase()}${word[0]}]${word.slice(1)}`).join("|");
const ATTRIBUTION = new RegExp(`\\b(${either(["menurut", "kata", "ujar", "tutur", "dikutip dari", "mengutip", "dilansir dari", "dilansir", "according to", "as reported by", "reported by", "cited by"])})\\s+(${NAME})`, "gu");
const NAMED_STUDY = new RegExp(`\\b(${either(["studi", "penelitian", "riset", "survei", "laporan", "data", "study", "research", "survey", "report"])})\\s+(?:dari|oleh|by|from)\\s+(${NAME})`, "gu");
const CLAIM = /\b(?:penelitian|studi|riset|survei|data|para ahli|banyak ahli|research|studies|study|surveys?|experts?|data)\s+(?:terbaru\s+|recent\s+)?(?:menunjukkan|membuktikan|mengungkapkan|menemukan|menyatakan|sepakat|shows?|suggests?|found|finds?|proves?|indicates?|reveals?|agree)\b/iu;
const UNITS = "(?:\\s?%|\\s?(?:persen|percent|ribu|rb|juta|jt|miliar|milyar|triliun|thousand|million|billion|trillion)\\b)?";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const known = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase().trim());

type Repair = { text: string; count: number };
function replaceUnknown(text: string, pattern: RegExp, allowed: string, placeholder: string, pick: (match: RegExpExecArray) => string = (match) => match[0]): Repair {
  let count = 0;
  const next = text.replace(pattern, (...args) => {
    const match = args.slice(0, -2) as unknown as RegExpExecArray; const whole = match[0]; const part = pick(match);
    if (!part || known(allowed, part)) return whole;
    count++; return whole.replace(part, placeholder);
  });
  return { text: next, count };
}

// Invented digits become the number placeholder, with the currency or unit that belongs to them. Value comparison
// (./numeric), so a figure restated in other notation from the brief is kept.
function replaceInventedNumbers(text: string, allowed: string, placeholder: string): Repair {
  let count = 0; let next = text;
  for (let pass = 0; pass < 4; pass++) {
    const { invented } = compareNumericValues(allowed, next);
    if (!invented.length) break;
    for (const token of invented) {
      const pattern = new RegExp(`(?:Rp\\.?\\s?|IDR\\s?|USD\\s?|\\$)?(?<![\\p{N}.,])${escape(token.raw)}(?![\\p{N}]|[.,]\\p{N})${UNITS}`, "gu");
      next = next.replace(pattern, () => { count++; return placeholder; });
    }
  }
  return { text: next, count };
}

const normaliseItem = (value: string) => value.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/u, "").replace(/\s+/g, " ").trim();
// Lenient about shape, strict about content: a paragraph with line breaks becomes one paragraph per line, a list that
// came back as text becomes a list of its lines, the section's own heading repeated at the top is dropped.
export function normaliseDraftBlocks(blocks: DraftBlock[], sectionHeading: string): DraftBlock[] {
  const out: DraftBlock[] = [];
  for (const block of blocks) {
    if (block.type === "bullet_list" || block.type === "numbered_list") {
      const items = (block.items.length ? block.items : block.text.split("\n")).map(normaliseItem).filter(Boolean);
      if (items.length) out.push({ type: block.type, text: "", items });
    } else if (block.type === "subheading") {
      const text = block.text.replace(/\s+/g, " ").replace(/^#+\s*/u, "").trim();
      if (text) out.push({ type: "subheading", text, items: [] });
    } else {
      for (const line of (block.text || block.items.join("\n")).split(/\n+/u)) { const text = line.replace(/[ \t]+/g, " ").trim(); if (text) out.push({ type: "paragraph", text, items: [] }); }
    }
  }
  while (out[0]?.type === "subheading" && out[0].text.toLowerCase() === sectionHeading.trim().toLowerCase()) out.shift();
  return out;
}

export type DraftCheck = { blocks: DraftBlock[]; repaired: number; guarded: number; warnings: string[] };
// Rejects or repairs a draft so it carries no specific the author did not give. Repairs replace the invented
// specific with the placeholder the prompt asked for; more than DRAFT_MAX_REPAIRS of them refuses the draft.
export function validateDraft(raw: { blocks: DraftBlock[]; warnings?: unknown }, runtime: DraftRuntime): DraftCheck {
  const language = runtime.language === "en" ? "en" : "id"; const words = PLACEHOLDER[language];
  const allowed = draftSourceText(runtime); const fiction = FICTION_DOC_TYPES.has(runtime.doc_type);
  const blocks = normaliseDraftBlocks(raw.blocks, runtime.section_heading);
  if (!blocks.length) throw new DraftRejected("the draft is empty", "empty");
  if (blocks.some((block) => block.type === "subheading" && REFERENCE_HEADING.test(block.text))) throw new DraftRejected("the draft contains a reference list", "reference_list");
  let repaired = 0; let guarded = 0;
  const fix = (value: string): string => {
    let text = plainDashes("", value);
    const steps: Array<(input: string) => Repair> = [
      (input) => replaceUnknown(input, URL, allowed, words.link),
      // A placeholder that carries a figure ("[data 2024]") is a figure in disguise.
      (input) => replaceUnknown(input, BRACKET, allowed, words.number, (match) => (/\p{N}/u.test(match[0]) ? match[0] : "")),
      (input) => replaceUnknown(input, CITATION, allowed, words.source),
      (input) => replaceInventedNumbers(input, allowed, words.number),
      ...(fiction ? [] : [
        (input: string) => replaceUnknown(input, QUOTE, allowed, words.quote, (match) => (match[1]!.trim().split(/\s+/u).length >= 5 && !known(allowed, match[1]!) ? match[0] : "")),
        (input: string) => replaceUnknown(input, ATTRIBUTION, allowed, words.source, (match) => (PRONOUNS.has(match[2]!.split(/\s+/u)[0]!.toLowerCase()) ? "" : match[2]!.replace(/[.,]+$/u, ""))),
        (input: string) => replaceUnknown(input, NAMED_STUDY, allowed, words.source, (match) => match[2]!.replace(/[.,]+$/u, "")),
      ]),
    ];
    for (const step of steps) { const result = step(text); text = result.text; repaired += result.count; }
    // Academic guard: a sentence that claims research or experts show something carries the source placeholder.
    if (runtime.academic) text = sentences(text).map((sentence) => {
      if (!CLAIM.test(sentence) || /\[[^\]]+\]/u.test(sentence)) return sentence;
      guarded++; return sentence.replace(/([.!?]*)$/u, ` ${words.source}$1`);
    }).join(" ");
    return text.replace(/[ \t]{2,}/g, " ").trim();
  };
  const checked = blocks.map((block) => (block.type === "bullet_list" || block.type === "numbered_list" ? { ...block, items: block.items.map(fix) } : { ...block, text: fix(block.text) }));
  if (repaired > DRAFT_MAX_REPAIRS) throw new DraftRejected(`the draft invented ${repaired} specifics`, "fabrication");
  const final = draftText(checked);
  // The repairs are verified, never trusted: nothing invented may survive them.
  if (compareNumericValues(allowed, final).invented.length || [...final.matchAll(URL)].some((match) => !known(allowed, match[0]))) throw new DraftRejected("the draft still carries an invented specific", "fabrication");
  if ([...final].length > runtime.max_characters) throw new DraftRejected(`the draft is longer than ${runtime.max_characters} characters`, "length");
  const own = Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const note = repaired ? (language === "en" ? `${repaired} detail(s) not in your brief became placeholders. Check and fill them in.` : `${repaired} detail yang tidak ada di brief diganti placeholder. Periksa dan isi sendiri.`) : null;
  return { blocks: checked, repaired, guarded, warnings: [...own.slice(0, note ? 2 : 3), ...(note ? [note] : [])] };
}
