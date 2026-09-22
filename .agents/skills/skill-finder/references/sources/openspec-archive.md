# Source: openspec-archive

## Location

`openspec/changes/archive/<YYYY-MM-DD-slug>/`. Flag: `--path <dir>`. The default is `<cwd>/openspec/changes/archive`. A folder whose name does not start with a date is skipped.

## Files

| File | Use |
| :--- | :--- |
| `.openspec.yaml` | `created` gives the start day. `schema` names the workflow. |
| `proposal.md` | The Why paragraph and the first three What Changes bullets give intents. A `# ` heading gives the title. |
| `design.md` | Not read. It holds design detail, not the request. |
| `tasks.md` | Checkboxes give `outcome` and `size.toolCalls`. Backtick commands give `commandPatterns`. |
| `specs/<capability>/spec.md` | The capability folder names give `artifacts`. |

## Episode

One archived change is one episode. `startedAt` is the `created` day, or the folder date. `endedAt` is the folder date. `days` holds both days.

## Signals

| Evidence field | Source |
| :--- | :--- |
| `title` | The `# ` heading of `proposal.md` without a `Proposal:` or `Change:` prefix, or the slug with spaces |
| `intents` | The first paragraph under `## Why`, `## Motivation`, or `## Problem`, then the first three bullets under `## What Changes`, `## Changes`, or `## Scope` |
| `outcome` | All boxes checked: `completed`. Some checked: `partial`. None checked: `abandoned`. No boxes or no `tasks.md`: `unknown`. |
| `size.toolCalls` | The checkbox count. `assistantMessages` is 0. |
| `commandPatterns` | Backtick spans in `tasks.md` that parse as a command |
| `artifacts` | Folder names under `specs/` |

## Pitfalls

- Section names change with the schema. The extractor accepts the names above.
- Sections and files can be missing. A missing `proposal.md` gives no intents, and the audit warns `empty_intents`.
- Dates are the only timestamps. An archive has no time of day.

## Privacy

Proposals can hold tokens and URLs. Redaction runs on `proposal.md` and `tasks.md` before any parse, so the line numbers stay the same.
