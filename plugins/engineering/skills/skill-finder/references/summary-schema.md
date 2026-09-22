# Episode summary

A summary is the model's short reading of one digest. It gives the aggregation real task names. Without summaries, the run uses only titles, command patterns, and correction text, and the report must say so.

## Object

| Field | Type | Allowed values |
| :--- | :--- | :--- |
| `episodeId` | string | An `id` from `evidence.jsonl`. |
| `goal` | string | One sentence, 20 words or less. Not empty. |
| `outcome` | string | `completed`, `partial`, `abandoned`, `unknown` |
| `procedures` | array of `{ name, steps, taughtByUser }` | `name`: 2 to 6 lowercase words. `steps`: string array. `taughtByUser`: boolean. |
| `corrections` | array of `{ what, cause, fix }` | Strings. |
| `repeatedManualSteps` | string array | |
| `skillCandidates` | array of `{ name, why }` | `name` is kebab-case. |
| `skillsThatShouldHaveFired` | array of `{ name, why }` | Names from the installed skill list. |
| `confidence` | string | `high`, `medium`, `low` |

```json
{
  "episodeId": "claude-sessions:03e7c691-22f4-42fd-9919-480a352267a3",
  "goal": "Package engineering skills as a Claude Code plugin",
  "outcome": "completed",
  "procedures": [
    { "name": "sync skill mirrors", "steps": ["edit skills/<bucket>/<name>", "run sh scripts/sync-agents.sh"], "taughtByUser": true }
  ],
  "corrections": [
    { "what": "agent hand-edited .claude/skills", "cause": "did not know the tree is generated", "fix": "edit the source tree and run the sync script" }
  ],
  "repeatedManualSteps": ["run the version sync check before commit"],
  "skillCandidates": [ { "name": "sync-skill-mirrors", "why": "the user explained the same two steps twice" } ],
  "skillsThatShouldHaveFired": [ { "name": "authoring-skills", "why": "the session added a hook without reading the conventions" } ],
  "confidence": "high"
}
```

## Batches

- `check-summaries.mjs --run <run> --plan` puts the digests in batches of 10. It writes `summaries/plan.json` and `summaries/question.txt`. The question is `references/summary-prompt.md` plus the installed skill list from `catalog.json`.
- The call count is the digest count divided by 10, rounded up. One Pi call for 10 real digests took about 2 minutes. You can run up to 4 batches at the same time.
- Save each backend answer to the batch `file` from the plan: `summaries/batch-NN.json`. The file can hold prose around the array. The check reads the outermost `[...]`.

## Backends

Use the first backend that is available:

1. `shunt:bulk-reader`. Load the skill first. Then run its script with `--question "$(cat <run>/summaries/question.txt)"` and `--paths` set to the digests of one batch. Save stdout to the batch file.
2. The `Agent` tool. Start one subagent for each batch. Give it the text of `question.txt` and the digest paths. Tell it to write only the JSON array to the batch file.
3. None. The run continues on heuristics. Record it with `merge-summaries.mjs --run <run> --backend none`.

Before the first call, tell the user the digest count, the total size, and the call count. Continue only on a yes.

## Check, retry, and merge

1. `check-summaries.mjs --run <run> --batch <file>` validates each field, each allowed value, each `episodeId`, and duplicates. It exits 1 for a bad batch.
2. Run a bad batch again one time. After a second failure, leave it. Its episodes keep `summary: null`.
3. `merge-summaries.mjs --run <run> --backend <pi|subagent|none>` merges each valid batch. It removes `episodeId` from the stored summary. It sets `outcome` from the summary when the extractor outcome is `unknown`. It records the backend in `run.json`.
4. Run `audit-evidence.mjs <run>/evidence.jsonl --expect-summaries`. Each episode that still has no summary gets a `summary_missing` warning.
