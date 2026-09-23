# Families

A family is one kind of task that comes back across episodes. The model names the families after it has read every episode line. This gives the aggregation a shared vocabulary. Summaries alone do not give one. Each batch of 10 digests invents its own task names. So the same work rarely gets the same name twice.

## Files

- `plan`: `scope-families.mjs --run <run> --plan` writes `families/episodes-NN.md`, one line per episode, in batches of 400 lines. It writes `families/question.txt` from `references/family-prompt.md`, and `families/plan.json`.
- `answer`: save each backend answer to the batch `file` from the plan: `families/answer-NN.json`. The file can hold prose around the array. The check reads the outermost `[...]`, or the `families` array of an object.
- `families.json`, in the run root, after a valid check.

## Episode line

```
- <episodeId> | goal: <goal> | procedures: <name>; <name> | candidates: <name>; <name>
```

`goal`, `procedures`, and `candidates` come from the summary. An episode without a summary gives its title as the goal. An episode with no summary and no usable title gives no line.

## Object

| Field | Type | Allowed values |
| :--- | :--- | :--- |
| `name` | string | kebab-case, 2 to 6 words |
| `description` | string | Not empty. 40 words or less. |
| `episodeIds` | string array | Ids from `evidence.jsonl`. Not empty. No duplicates. At least one known id. |

Two families in one answer must not share a name. Families with the same name in different answers merge. The first description wins. A backend mistypes an id now and then. An unknown id is dropped and listed in `droppedIds`. It does not fail the answer.

## families.json

```json
{
  "generatedAt": "2026-09-23T10:00:00.000Z",
  "backend": "pi",
  "episodes": 191,
  "assigned": 150,
  "droppedIds": [],
  "families": [
    { "name": "add-fport-decoder", "description": "Add a LoRaWAN fport decoder with parity coverage and simulator support.", "episodeIds": ["claude-sessions:..."] }
  ]
}
```

`assigned` counts the distinct episodes in at least one family.

## Backends

Use the first backend that is available. It is the same order as for summaries:

1. `shunt:bulk-reader`. Run its script with `--question "$(cat <run>/families/question.txt)"` and `--paths <run>/families/episodes-NN.md`. Save stdout to the answer file.
2. The `Agent` tool. One subagent per batch. Give it the question text and the input path. Tell it to write only the JSON array to the answer file.
3. None. Run `scope-families.mjs --run <run> --backend none`. The aggregation then uses lexical clusters and named skills only. The report states that families were skipped.

## Check and retry

1. `scope-families.mjs --run <run> --backend <pi|subagent> --answer <file> [--answer <file>]` validates every answer. It exits 1 for a bad answer and writes nothing.
2. Run a bad batch again one time. After a second failure, run `--backend none`.
3. On success, the script writes `families.json` and records `families` in `run.json`.

## Use in aggregation

`aggregate.mjs` reads `families.json` when it exists. Each family becomes one cluster with `signal: "family"`. The same recurrence, cost, and catalog rules apply. A family that holds more than half of the episodes is too broad. It goes to `belowThreshold`.
