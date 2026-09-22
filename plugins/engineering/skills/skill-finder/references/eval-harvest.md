# Eval harvest

Build evals for the picked suggestion from real prompts. Use the `skill-creator` format, so that the skill can be tuned later. The target is at least 50 cases.

## Files

`harvest-evals.mjs` writes to `<run>/evals-<id>/`:

| File | Content |
| :--- | :--- |
| `trigger-eval.json` | `[{ "query", "should_trigger" }]`. Positives first. `run_eval.py` reads only these two fields. |
| `trigger-eval.provenance.json` | `[{ "query", "should_trigger", "episodeId", "pointer", "origin" }]`, in the same order. `origin` is `real`, `synthetic`, or `existing`. |
| `evals.json` | `{ "skill_name", "evals": [{ "id", "name", "prompt", "expected_output", "files", "expectations", "provenance" }] }` |
| `harvest.json` | Keywords, quotas, counts, real counts, synthetic counts, and the shortfall. |

## Target

| Part | Minimum at target 50 |
| :--- | ---: |
| Should trigger | 20 |
| Should not trigger | 20 |
| Behavior cases | 10 |

For a target T, behavior cases are the larger of 10 and 20% of T. Trigger cases are the larger of 40 and the rest, split in half.

## Sources of cases

- Keywords: tokens of the suggestion title, the proposal name, the trigger phrases, the candidate keys, and the target skill name.
- Positives: prompts from the suggestion's episodes with overlap 0.15 or more with the keywords. OpenSpec proposal leads count. Highest overlap first.
- Negatives, the near-misses: prompts from other episodes with overlap from 0.15 up to, but not including, 0.5. Episodes from another candidate cluster, or episodes where another catalog skill fired, come first.
- Behavior cases: the first prompt of each suggestion episode, the prompt that starts the work.

## Filters

- 40 to 600 characters.
- No command, caveat, reminder, notification, or bash wrappers.
- No email addresses. Redaction already ran on the text.
- No exact repeats after normalization. No near-duplicates at overlap 0.8 or more.

## Behavior expectations

The script writes behavior cases with an empty `expected_output` and empty `expectations`. Fill them before Gate 2:

- Get the expected steps from `summary.procedures[].steps`, the fixes from `summary.corrections[].fix`, and the files from `artifacts` of the source episode.
- Write `expected_output` as one sentence about the result.
- Write 1 to 4 expectations. Each one must be verifiable: a file exists, a command ran, or a text is present in the answer.
- Do not copy tool results or file contents.

## Shortfall and synthetic cases

When `shortfall.total` is more than 0, write synthetic cases to `<run>/evals-<id>/synthetic.json`:

```json
{
  "triggers": [ { "query": "...", "should_trigger": true } ],
  "behavior": [ { "prompt": "...", "expected_output": "...", "expectations": ["..."] } ]
}
```

- Write only enough to close the shortfall of each part.
- Vary the wording. Do not reuse a real prompt with one word changed.
- Near-miss negatives share some words with the skill, but ask for different work.
- Run the harvest again with `--add-synthetic <file>`. The script applies the same filters and marks each case `synthetic`.
- Gate 2 states the real count and the shortfall. A shortfall does not block.

## Merge

At apply time, run `harvest-evals.mjs --run <run> --id <id> --merge-into <skill>/evals`. It merges the files in the out folder:

- It skips a query or a prompt that the target already holds, after normalization.
- It keeps `trigger-eval.provenance.json` aligned with `trigger-eval.json`. Old entries without provenance get `origin: existing`.
- It continues `id` from the largest existing `id`.
- It refuses a folder under `/.claude/plugins/`. For a plugin-origin skill, keep the evals in `<run>/evals-<id>/`.
