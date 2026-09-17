# Prompt evaluation

Live evaluation of the v5 prompts in `systemprompt.md` against the configured OpenRouter model.

## Run

```bash
pnpm smoke                       # every fixture, one pass
pnpm smoke P03 p08-id            # filter by prompt id or fixture id substring
SMOKE_REPEAT=3 pnpm smoke P07    # three passes per fixture; one pass of a sampled model proves little
```

The script reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` from `.dev.vars`, calls the same `createOpenRouterProvider`, P10 repair path, `validateGeneration`, and `softWarnings` the service uses, and writes `evaluation-results/<version>-<timestamp>.json` (git-ignored) with the raw and validated output of every call. A full pass costs about $0.03. It exits non-zero when any fixture fails.

## Fixtures

| File | Purpose |
|---|---|
| `fixtures/prompt-evaluation.json` | The original 21 cases, P01–P08 and P10 |
| `fixtures/prompt-edge-cases.json` | Injection, questions, fragments, colloquial register, hedges, placeholders, formats, and option-separation sets: one source run under every value of an option, so identical outputs show an option that does nothing |
| `fixtures/prompt-held-out.json` | Cases written after tuning, to check that the rules generalise beyond the cases they were tuned on |

Each fixture keeps the human rubric in `expected` and adds machine checks in `checks`:

| Key | Meaning |
|---|---|
| `keep` | exact substrings that must survive |
| `match` | regular expressions that must match (multiline) |
| `absent` | regular expressions that must not match (case-insensitive) |
| `absentExact` | same, case-sensitive |
| `warns` | the model must report a warning |
| `noChange` | the model must set `no_change_needed` |
| `minOptions` | P07: options left after filtering |

Machine checks catch regressions; they do not replace reading the output. `tests/review/ai-core-contract.test.ts` asserts that every fixture normalises against the runtime schemas, without calling the provider.

## Changing a prompt

1. Edit `src/server/ai/core/prompts.ts` and the matching block in `systemprompt.md`; `tests/ai/core.test.ts` fails until they are identical.
2. Run `SMOKE_REPEAT=3 pnpm smoke <prompt id>` and read the failures and a sample of the passes.
3. Add a fixture for the case that motivated the change, and one held-out case you do not tune on.
4. Bump `PROMPT_VERSION` once the old version has produced production data.
