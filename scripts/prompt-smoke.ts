// Live prompt smoke test: pnpm smoke [filter...] — runs fixtures through the real provider and validators.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createOpenRouterProvider, isCondensed, PROMPT_VERSION, requestOf, validateProtectedContent, softWarnings, validateGeneration, normalizeRuntime, type PromptId, type RuntimeInput } from "../src/server/ai/core";

type Checks = { keep?: string[]; match?: string[]; absent?: string[]; absentExact?: string[]; warns?: boolean; noChange?: boolean; minOptions?: number };
type Fixture = { id: string; promptId: PromptId; sourceText: string; selectedText?: string; runtime: RuntimeInput; expected: Record<string, string>; checks?: Checks };
type Result = { id: string; promptId: PromptId; ok: boolean; failures: string[]; warnings: string[]; source: string; output: unknown; raw?: unknown; latencyMs: number; costUsd?: number };

const env = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter((line) => /^\w+=/.test(line)).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")]; }));
const apiKey = env.OPENROUTER_API_KEY; if (!apiKey) throw new Error("OPENROUTER_API_KEY missing in .dev.vars");
const model = env.OPENROUTER_MODEL || "openai/gpt-5.6-luna";
// SMOKE_REPEAT=3 runs every fixture three times, because one pass of a sampled model proves little.
const repeat = Math.max(1, Number(process.env.SMOKE_REPEAT) || 1);
const filters = process.argv.slice(2);
const files = ["fixtures/prompt-evaluation.json", "fixtures/prompt-edge-cases.json", "fixtures/prompt-held-out.json"];
const fixtures = files.flatMap((file) => JSON.parse(readFileSync(file, "utf8")) as Fixture[]).filter((item) => !filters.length || filters.some((filter) => item.id.includes(filter) || item.promptId.includes(filter)));
const provider = createOpenRouterProvider({ apiKey, model, privacyMode: "deny", timeoutMs: 90_000 });

const textOf = (output: Record<string, unknown>) => Array.isArray(output.alternatives) ? (output.alternatives as Array<{ text: string }>).map((item) => item.text).join("\n") : String(output.transformed_text ?? output.corrected_text ?? JSON.stringify(output));

async function run(fixture: Fixture): Promise<Result> {
  const started = Date.now(); const failures: string[] = []; let warnings: string[] = []; let output: unknown = null;
  const repair = fixture.promptId === "P10_REPAIR";
  const runtime = { contextBefore: null, contextAfter: null, ...fixture.runtime } as RuntimeInput;
  const source = fixture.selectedText ?? fixture.sourceText;
  const call = () => provider.generate({ promptId: fixture.promptId, runtime, sourceText: source, requestId: fixture.id, ...(repair ? { repairAttempt: 1 } : {}) });
  // Transport failures say nothing about the prompt, so they get one retry.
  let result = await call(); if (!result.ok && ["network_error", "timeout", "http_error"].includes(result.error)) result = await call();
  if (!result.ok) return { id: fixture.id, promptId: fixture.promptId, ok: false, failures: [`provider: ${result.error}${result.status ? ` ${result.status}` : ""}`], warnings, source, output, latencyMs: Date.now() - started };
  output = result.response; let response = result.response;
  // Same path as the service: a protected-content violation gets one P10 repair before the result is judged.
  const terms = (runtime.protectedTerms ?? []) as string[]; const citations = (runtime.protectedCitations ?? []) as string[];
  const draft = typeof response.transformed_text === "string" ? response.transformed_text : null;
  if (!repair && draft !== null && response.no_change_needed !== true && !validateProtectedContent(source, draft, terms, citations, true, fixture.promptId === "P04_PROFESSIONAL", isCondensed(requestOf(fixture.promptId, normalizeRuntime(fixture.promptId, { ...runtime, sourceText: source }) as RuntimeInput))).valid) {
    const repairRuntime = { language: runtime.language, failedOutput: draft, originalScope: source, requiredProtectedTerms: terms, requiredProtectedCitations: citations } as RuntimeInput;
    const fixed = await provider.generate({ promptId: "P10_REPAIR", runtime: repairRuntime, sourceText: source, requestId: `${fixture.id}:repair`, repairAttempt: 1 });
    if (fixed.ok) try { response = { ...response, transformed_text: validateGeneration("P10_REPAIR", source, fixed.response, repairRuntime, 1).corrected_text }; warnings.push("repaired by P10"); } catch (error) { failures.push(`repair: ${error instanceof Error ? error.message : String(error)}`); }
  }
  try {
    const checked = validateGeneration(fixture.promptId, source, response, runtime, repair ? 1 : 0); output = checked;
    const text = textOf(checked);
    if (!repair && fixture.promptId !== "P07_INLINE_ALTERNATIVES" && fixture.promptId !== "P09_QUALITY_EVALUATION" && checked.no_change_needed !== true) {
      const controls = normalizeRuntime(fixture.promptId, { ...runtime, sourceText: source });
      warnings = [...warnings, ...softWarnings(fixture.promptId, source, text, { language: controls.language, strength: controls.strength, request: requestOf(fixture.promptId, controls as RuntimeInput) })];
    }
    if (!source.includes("\u2014") && text.includes("\u2014")) failures.push("added an em dash");
    for (const needle of fixture.checks?.keep ?? []) if (!text.includes(needle)) failures.push(`missing: ${needle}`);
    for (const pattern of fixture.checks?.match ?? []) if (!new RegExp(pattern, "mu").test(text)) failures.push(`no match: ${pattern}`);
    if (fixture.checks?.warns && !(checked.warnings as unknown[] | undefined)?.length) failures.push("expected a model warning");
    for (const pattern of fixture.checks?.absent ?? []) if (new RegExp(pattern, "imu").test(text)) failures.push(`present: ${pattern}`);
    for (const pattern of fixture.checks?.absentExact ?? []) if (new RegExp(pattern, "mu").test(text)) failures.push(`present: ${pattern}`);
    if (fixture.checks?.noChange && checked.no_change_needed !== true) failures.push("expected no_change_needed");
    if (fixture.checks?.minOptions && (checked.alternatives as unknown[]).length < fixture.checks.minOptions) failures.push(`fewer than ${fixture.checks.minOptions} distinct options`);
  } catch (error) { failures.push(`validator: ${error instanceof Error ? error.message : String(error)}`); }
  return { id: fixture.id, promptId: fixture.promptId, ok: failures.length === 0, failures, warnings, source, output, raw: result.response, latencyMs: Date.now() - started, costUsd: result.usage.costUsd };
}

const results: Result[] = []; const queue = fixtures.flatMap((fixture) => Array.from({ length: repeat }, (_, index) => (repeat > 1 ? { ...fixture, id: `${fixture.id}#${index + 1}` } : fixture)));
await Promise.all(Array.from({ length: 6 }, async () => { for (let next = queue.shift(); next; next = queue.shift()) { const result = await run(next); results.push(result); console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id}${result.failures.length ? ` — ${result.failures.join("; ")}` : ""}${result.warnings.length ? ` (soft: ${result.warnings.join(" | ")})` : ""}`); } }));
results.sort((a, b) => a.id.localeCompare(b.id));
mkdirSync("evaluation-results", { recursive: true });
const file = `evaluation-results/${PROMPT_VERSION}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ promptVersion: PROMPT_VERSION, model, results }, null, 2));
const cost = results.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
console.log(`\n${results.filter((item) => item.ok).length}/${results.length} passed · $${cost.toFixed(4)} · ${file}`);
if (results.some((item) => !item.ok)) process.exitCode = 1;
