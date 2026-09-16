---
name: decision-auto-tracker
description: Capture user decisions from human-to-agent conversations into structured Markdown files in `decisions/log/`. Use this skill whenever the user commits to a choice that will still matter after the current ticket or PR closes — picking between debated options, settling an open question, locking in a name/value/threshold/owner, reversing or narrowing a prior decision, or saying "let's go with X" / "we'll use Y" / "decided to skip Z" / "use A instead" / "log this decision" / "remember we decided X". Also use it to audit an existing decision log for noise. Do not use it for one-off task picks (ship now, waive a check, close a ticket, which branch to base on), for rules about the agent's own hooks, skills, prompts or review loops (those belong in AGENTS.md / CLAUDE.md), for brainstorming, style preferences, or code-level corrections.
intent: >-
  Auto-track decisions emerging from conversations between the user and an agent.
  Each decision becomes a short, greppable Markdown file under `decisions/log/`
  with structured frontmatter and a fixed body so future sessions can find,
  cite, and reason about prior choices without re-litigating them. A validation
  script enforces the format, an optional per-repo config adapts the rules, and
  an audit rubric keeps the log free of noise as it grows.
type: workflow
---

## Purpose

Repos accumulate many small decisions per week — pick this tool, name this entity that, skip this feature for v1, settle on this threshold. Most never reach an ADR. They live in chat history and disappear.

This skill turns those moments into a _decision log_ under `decisions/log/`: one file per decision, structured frontmatter, fixed body, sortable filenames. A future session greps the log instead of re-deciding the same thing.

The log is _not_ a replacement for formal ADRs. ADRs carry full context for architecturally significant choices and live wherever the repo keeps them. The log is for the rest.

The log is only useful while it stays **short and true**. Audits of real logs show the two ways it degrades: entries that nobody will look up (a quarter of all entries), and entries that bundle several choices into one file (one in seven). The rules below exist to prevent both.

## What to capture

Capture when the user **commits to a choice** and that choice passes the durability test. Ask three questions; log when at least two answers are **yes**:

1. Will a teammate need this **after the current ticket or PR closes**?
2. Would a **new contributor** six months from now be surprised not to know it?
3. Does it **constrain future code, data or behaviour**, rather than describe one execution path?

Strong signals:

- Picking between debated options: "let's go with B", "use Cloudflare not Route 53", "shaped diffs, not full snapshots"
- Locking in a value, name, owner or threshold: "call it `Pasture`", "default timeout is 500 ms", "Dana owns the ingest service"
- Settling an open question: "skip subscriptions for v1", "no Bluetooth in the first hardware cut"
- Reversing or superseding a prior decision: "scratch that, switch back to Postgres"
- Explicit request: "log this decision", "track that", "remember we decided X"

## What not to capture

| Looks like a decision, but is… | Example | Where it belongs instead |
| --- | --- | --- |
| **A task pick** — how to finish this ticket, PR or session | "ship it as a standalone PR", "waive the local test run, open the PR", "close TICKET-911 with the gap recorded", "base the fix on fresh main" | the ticket or PR |
| **An agent-harness rule** — how the AI agent itself operates | "one AI review round per PR", "the stop-hook falls back to WSL", "MCP config lives in `~/.codex`", "dispatch the reviewer only for behavioural diffs" | `AGENTS.md` / `CLAUDE.md`, or the repo that owns the skill or hook |
| **A task instruction** | "write a function that does X" | nowhere |
| **Brainstorming** — no commitment yet | "we could maybe use Redis here… or memcached" | wait until they commit |
| **A style preference or code-level correction** | "be more concise", "rename foo to bar" | nowhere |
| **A clarification** of an existing entry | "the 500 ms debounce also applies on re-entry" | the existing entry (see Workflow step 5) |

Exception: in a repo whose product _is_ agent tooling (a skills repo, a hooks library), decisions about that tooling are ordinary technical decisions.

**When a task pick wraps a durable rule, split them.** "Ship the decoder only; we never build a daily view for this report — the dashboard reads raw rows" contains one task pick (ship the decoder) and one durable rule (no daily view). Log the rule alone, in two sentences. Leave the pick in the ticket.

When in doubt, apply the three questions and, if still unsure, ask the user in one line.

## One decision per file

Each file holds **one choice** that can be cited on its own:

- `## Decision` is one or two sentences. Background goes to Context, rationale to Reasoning.
- The filename slug is 2–6 words. The H1 title carries the long form.
- A message with several independent picks becomes several files with consecutive sequence numbers.

An entry that opens with "Four picks for…" or "Three choices, shipped as one PR:" is the anti-pattern. A future reader wants to supersede one of the four and cannot.

## Storage layout and config

```
decisions/
├── decision-log.json   # optional per-repo config (see references/config.md)
├── NNN-….md            # formal ADRs, if the repo keeps them here (never touched by this skill)
└── log/                # this skill writes here
    ├── 2026-05-18-01-pasture-replaces-piquete.md
    └── …
```

The `decisions/log/` folder is created on first capture. Without a config the defaults apply: `status` is stored in each file, the log may be edited, no `bucket` field. A config can switch to a **derived-status, append-only** log, add a required `bucket` classification, restrict the `linear` pattern, and set a ratchet date for the length rules. Read [`references/config.md`](references/config.md) when a `decision-log.json` exists — the supersede and clarification steps differ by mode.

## Filename

`YYYY-MM-DD-NN-short-slug.md` — the date the decision was made, a zero-padded per-day sequence, and a 2–6 word kebab-case slug. `scripts/new-decision.mjs` derives all three; use it rather than hand-writing frontmatter. Two parallel sessions can still allocate the same `NN`; the validator reports the collision and the later entry is renumbered.

## File format

```markdown
---
id: 2026-05-18-01
date: 2026-05-18
topic: pasture-replaces-piquete
status: active
tags: [glossary, terminology]
linear: ABC-387
supersedes:
---

# Pasture replaces Piquete

## Decision

**Pasture** is the canonical term. **Piquete** appears only as a labelled source term, never as the canonical name.

## Context

Reviewing the glossary, we found `Piquete` and `Pasture` used interchangeably across docs. New contributors could not tell which one the code should use. The question came up while updating ABC-387.

## Reasoning

`Pasture` is the industry-standard English term and matches the product name. `Piquete` is region-specific and belongs as a labelled mapping.

## Source

User in conversation, 2026-05-18: "Always use `Pasture`/`Herd`, not `Piquete`/`Mali`; source terms only as labelled mappings."
```

### Frontmatter fields

| Field        | Required                       | Format                                         | Notes                                                                                                              |
| ------------ | ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`         | yes                            | `YYYY-MM-DD-NN`                                | Must match the filename prefix                                                                                     |
| `date`       | yes                            | `YYYY-MM-DD`                                   | Must match the date portion of `id`                                                                                |
| `topic`      | yes                            | kebab-case slug, 2–6 words                     | Must match the filename slug                                                                                       |
| `status`     | `statusMode: stored` (default) | `active` \| `superseded` \| `reversed`         | Omit in `derived` mode — the validator computes it from the `supersedes` graph                                     |
| `bucket`     | only when the config lists buckets | one of the configured names                | What a later rewrite must carry forward; see the repo's config                                                     |
| `tags`       | yes                            | inline YAML list of kebab-case strings          | `[]` if none. Reuse existing tags before inventing new ones                                                        |
| `linear`     | optional                       | tracker id matching the config pattern          | Default pattern `ABC-123`; empty if none                                                                           |
| `supersedes` | optional                       | id, `id-slug`, or inline list `[a, b]`          | On the **new** entry. Use the `id-slug` form when two files share an id                                            |

### Body sections

Exactly these four `##` sections, in this order. None may be empty or left as a `TODO` stub.

1. **Decision** — one or two sentences. The choice itself.
2. **Context** — 2–4 sentences. Why it came up.
3. **Reasoning** — 1–3 sentences. Why this option won. For a fiat call write `User call, no further rationale given.`
4. **Source** — a short quote or paraphrase plus the date in `YYYY-MM-DD` form.

## Workflow when capturing a decision

1. **Classify.** Apply the three questions and the "What not to capture" table. Split a durable rule out of a task pick. If the message holds several independent choices, plan one file each.
2. **Create the file.** From the repo root:
   ```bash
   node <skill-dir>/scripts/new-decision.mjs "<human-readable title>" [--slug two-to-six-words] [--tags a,b] [--linear ABC-123] [--date YYYY-MM-DD] [--supersedes <id>] [--bucket <name>]
   ```
   `<skill-dir>` is the directory containing this SKILL.md. The script allocates the sequence number, writes `status: active` in stored mode, adds `bucket` when configured, and refuses a slug over the limit — pass `--slug` with the gist. The scripts need Node; where it is missing, copy [`template.md`](template.md) instead and derive the id, date and sequence number by listing `decisions/log/` yourself.
3. **Write the body.** Replace the four `TODO` stubs. Keep Decision to two sentences. If the scaffolder inserted a `DRAFTING NOTE` comment, follow it, then delete it along with the stubs — it guides the writing, it is not part of the record.
4. **Supersede, if this replaces an earlier entry.** Pass `--supersedes <old-id>` in step 2. Then, **stored mode**: set `status: superseded` in the old file. **Derived / append-only mode**: touch nothing else.
5. **Clarify, if this only narrows an existing entry.** **Stored mode**: append `## Clarification YYYY-MM-DD` to the existing file; no new file. **Append-only mode**: write a new entry whose Context cites the id it clarifies; do not set `supersedes`.
6. **Validate.** `node <skill-dir>/scripts/validate.mjs --quiet`, plus `bash <skill-dir>/scripts/check-append-only.sh` when the config sets `appendOnly`. Fix every error before moving on; warnings about Decision length mean the Decision should be trimmed now.
7. **Confirm to the user in one line**, e.g. _"Logged at `decisions/log/2026-05-18-01-pasture-replaces-piquete.md`."_ For a message you chose not to log, say so in one line and name the reason (task pick, agent-harness rule, brainstorming).

## Validation

`scripts/validate.mjs` checks every file in `decisions/log/` and exits non-zero on any error:

- filename, frontmatter, id/date/topic consistency, four sections in order, no empty or `TODO` section
- no two files share an id
- `status` agrees with the `supersedes` graph (stored) or is absent / consistent (derived)
- `supersedes` resolves to exactly one existing file; ambiguous bare ids are rejected
- slug within `maxSlugWords`; `bucket` valid when configured; `linear` matches the configured pattern
- warning only: `## Decision` over `maxDecisionSentences`

A `ratchetFrom` date in the config limits the length and duplicate-id rules to newer entries, so a repo with a legacy log can adopt them. Run the validator after every capture and wire it into CI; the script is importable for precheck pipelines.

## Auditing an existing log

To find noise in a log that already exists, run `node <skill-dir>/scripts/audit-manifest.mjs --summary` for the mechanical flags, then classify entries with [`references/triage-rubric.md`](references/triage-rubric.md). The rubric defines the categories (`product`, `technical`, `process`, `agent-harness`, `task-execution`, `clarification`, `duplicate`) and a JSONL output shape a reviewer can fill in. Act on the result per the repo's log policy.

## Reference

- [`references/format.md`](references/format.md) — full file rules and edge cases (multiple decisions in one message, reversals, clarifications, ADR promotion)
- [`references/config.md`](references/config.md) — `decision-log.json` keys and how the modes change the workflow
- [`references/triage-rubric.md`](references/triage-rubric.md) — capture-time and audit-time classification
- [`template.md`](template.md) — copy-paste starting point when the scaffolder cannot run
