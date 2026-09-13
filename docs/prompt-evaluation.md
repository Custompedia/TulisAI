# Prompt evaluation

`fixtures/prompt-evaluation.json` is an offline benchmark dataset for the unchanged final v1 prompts.

Review each result manually for meaning, register, grammar, facts, and protected content; record a pass or a short failure reason per rubric field. Run the fixtures with a mocked provider or a local harness first. Live provider evaluation remains pending until credentials, model availability, privacy configuration, and an approved spend budget exist; this dataset does not call a provider.

The dataset covers P01–P08 and one P10 repair case. P09 is excluded. P10 is an exception path and may be attempted once after an unsafe primary result; it must restore required protected terms, citations, and numeric tokens without expanding the original scope.
