---
name: skill-finder
description: Find which skills to create or fix from real work history. Use when the user asks what skills are missing, wants skill suggestions, asks why a skill did not fire or keeps going wrong, wants to mine Claude Code sessions, OpenSpec archives, or other work history for recurring tasks, or wants evals built from real prompts for a new or existing skill. Reads the sources the user names, ranks suggestions by frequency and cost, and hands off to skill-creator after approval.
---

# skill-finder

Find recurring work in the history that the user names. Compare it with the installed skills. Suggest changes of three kinds:

| Kind | Meaning | Output |
| :--- | :--- | :--- |
| `new-skill` | Recurring work. No catalog skill covers it. | A `skill-creator` handoff brief with harvested evals. |
| `silent-skill` | A catalog skill matches the work. It never fired in those episodes. | An exact description edit, with a trigger eval set. |
| `misfiring-skill` | A skill fired, and the user corrected the agent in the same episodes again and again. | A `## Learnings` entry, with behavior evals. |

The skill stops at a report. It changes a skill only after two approvals.

## Rules

- Keep raw history local. Do not put tool results, file contents, or raw session lines in the chat, the report, or the evals.
- Read `aggregate.json`, not all of `evidence.jsonl`. Open an evidence record or a digest only for a candidate that you judge.
- Do not force a suggestion. When no candidate passes, say so.
- Do not commit, push, or merge.
- Do not edit a plugin-origin skill. Stage the edit in the run folder.
- Do not edit `.gitignore`.

## Scripts

The scripts are in `${CLAUDE_SKILL_DIR}/scripts/`. Each script prints one JSON line. Exit code 0 is success, 1 is a usage or validation failure, and 2 is a missing or unreadable input. In the commands, `<run>` is the run folder from step 2.

## Procedure

### 1. Check and ask

1. Run `node --version`. Stop when the major version is less than 18.
2. Get the sources and the time window. When the user did not name them, ask one question. Offer this default: Claude Code sessions for the current project, for the last 90 days.

| Source | Knowledge | Extractor |
| :--- | :--- | :--- |
| `claude-sessions` | [references/sources/claude-sessions.md](references/sources/claude-sessions.md) | `extract-claude-sessions.mjs` |
| `openspec-archive` | [references/sources/openspec-archive.md](references/sources/openspec-archive.md) | `extract-openspec-archive.mjs` |

To add a source, follow [references/adapter-contract.md](references/adapter-contract.md).

### 2. Start a run

```bash
node "${CLAUDE_SKILL_DIR}/scripts/init-run.mjs" --cwd "$PWD" --slug <short-name> --source "<source and its flags>" --since <date>
```

Use the `run` value from the output as `<run>`. When `gitignoreWarning` is `true`, tell the user to add `.skill-finder/` to `.gitignore`.

### 3. Extract

Run one extractor for each source:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/extract-claude-sessions.mjs" --out <run> --project "$PWD" --since <date>
node "${CLAUDE_SKILL_DIR}/scripts/extract-openspec-archive.mjs" --out <run> --path <repo>/openspec/changes/archive --since <date>
```

When the user names a session folder, use `--store <dir>` instead of `--project`. Use `--store` more than one time for worktree folders. Show the one-line summary of each extractor.

When an extractor exits 2, stop. Name the missing source. Do not continue with other sources, and do not suggest a skill.

### 4. Audit

```bash
node "${CLAUDE_SKILL_DIR}/scripts/audit-evidence.mjs" <run>/evidence.jsonl --strict
```

When it exits 1, stop and show the errors from `<run>/evidence-audit.json`. Keep the warnings for the report limitations.

### 5. Index the catalog

```bash
node "${CLAUDE_SKILL_DIR}/scripts/index-catalog.mjs" --cwd "$PWD" --out <run>/catalog.json
```

When the user names another home folder, add `--home <dir>`. Add `--root <dir>` for each extra skill folder that the user names.

When the summary shows `warnings` above 0, copy the messages from `catalog.json` into the report limitations.

### 6. Summarize episodes

Read [references/summary-schema.md](references/summary-schema.md). Then run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-summaries.mjs" --run <run> --plan
```

Tell the user the digest count, the total size, and the call count. Ask for a yes. On a no, or when no backend is available, run the next command and go to step 7:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/merge-summaries.mjs" --run <run> --backend none
```

On a yes, use the first backend that is available: `shunt:bulk-reader` (Pi), then the `Agent` tool. The schema document tells how to call each one. Run up to 4 batches at the same time. Check each batch:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-summaries.mjs" --run <run> --batch <run>/summaries/batch-01.json
```

When a check exits 1, run that batch again one time. After a second failure, leave the batch. Then merge and audit again:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/merge-summaries.mjs" --run <run> --backend <pi|subagent>
node "${CLAUDE_SKILL_DIR}/scripts/audit-evidence.mjs" <run>/evidence.jsonl --expect-summaries
```

### 7. Aggregate

```bash
node "${CLAUDE_SKILL_DIR}/scripts/aggregate.mjs" --run <run> --previous auto
```

When `candidates` is 0, write `suggestions.json` with an empty `suggestions` array, and write a `report.md` that says no candidate passed the rule. Show the result and stop.

### 8. Judge

Read [references/ranking.md](references/ranking.md) and [references/report-format.md](references/report-format.md). Read `<run>/aggregate.json`. For each candidate, from the top:

1. Open its evidence records in `evidence.jsonl`. Open a digest only when the records do not answer your question.
2. Keep the kind hint, or change it. Write the reason in one sentence.
3. Merge candidates that describe the same work. Use `related` and `topCommands`.
4. Reject one-off work, tool habits, and work that a skill already does well. Write the reason.
5. Write the proposal for the kind.

Write `<run>/suggestions.json` and `<run>/report.md` in the format of the report reference.

### 9. Gate 1

Follow [references/gate-brief.md](references/gate-brief.md). Show the Suggestions table. Ask the user to pick one suggestion id, or none. Stop. Do not write to a skill before the user picks.

### 10. Verify and harvest

```bash
node "${CLAUDE_SKILL_DIR}/scripts/verify-suggestion.mjs" --run <run> --id <id>
```

When it exits 1, show the failed check from `<run>/verify-<id>.json` and stop. Do not write a Gate 2 brief.

Then read [references/eval-harvest.md](references/eval-harvest.md) and run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/harvest-evals.mjs" --run <run> --id <id>
```

When `shortfall.total` is more than 0, write synthetic cases to `<run>/evals-<id>/synthetic.json`, and run the same command again with `--add-synthetic <run>/evals-<id>/synthetic.json`. Then fill `expected_output` and `expectations` for each behavior case in `<run>/evals-<id>/evals.json`.

### 11. Gate 2

Write the brief in the format of the gate reference. Ask for an explicit yes. Stop.

### 12. Apply

Apply only after an explicit yes. Follow a symlink to the real file, and tell the user the real path.

Before you change a file in a `repo` or `user` skill, do these steps in this order:

1. For `silent-skill`, compare the current `description` with `descriptionBefore`. When they are different, stop. Tell the user that the skill changed after the run.
2. Copy each file that the apply will change to `<run>/apply-<id>/backup/`. Keep each path relative to the skill folder.
3. Write the path of each file that the apply will create to `<run>/apply-<id>/created.txt`, one path on each line.

| Kind | Origin `repo` or `user` | Origin `plugin` |
| :--- | :--- | :--- |
| `new-skill` | Invoke `skill-creator` with the brief. When the skill folder exists, merge the evals into its `evals/` folder. | Not used. |
| `silent-skill` | Replace the `description` value in the `SKILL.md` frontmatter with `descriptionAfter`. Merge the evals. | Write the edited copy to `<run>/apply-<id>/SKILL.md`. Keep the evals in `<run>/evals-<id>/`. |
| `misfiring-skill` | Add the entry as [references/learnings-format.md](references/learnings-format.md) says. Merge the evals. | Same as the cell above. |

Merge the evals with:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/harvest-evals.mjs" --run <run> --id <id> --merge-into <skill folder>/evals
```

For a plugin-origin skill, name the upstream path. List every file that you changed, give the rollback from the brief, and stop.

## Stop conditions

Stop and report when:

- a source is missing or unreadable;
- the audit is blocking;
- no candidate passes the rule;
- the user declines at Gate 1 or Gate 2;
- the verify status is `blocked`.

A plugin-origin target does not stop the run. Its edit is staged in `<run>/apply-<id>/`.
