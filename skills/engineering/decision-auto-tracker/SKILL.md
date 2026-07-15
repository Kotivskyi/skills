---
name: decision-auto-tracker
description: Capture user decisions from human-to-agent conversations into structured Markdown files in `decisions/log/`. Use this skill whenever the user makes a substantive choice — picking between options, committing to an approach, settling an open question, reversing a prior decision, locking in a name/value/threshold/owner, or saying "let's go with X" / "we'll use Y" / "decided to skip Z" / "use A instead" / "go with option B". Also use when summarizing a discussion that ended with a clear pick, or when the user explicitly says "log this decision", "track this", "save this as a decision", "remember we decided X". Skip routine task instructions ("write a function that does X"), style preferences, and trivial corrections — track only real decisions that a future teammate (human or agent) would want to look up later.
intent: >-
  Auto-track decisions emerging from conversations between the user and an agent.
  Each decision becomes a short, greppable Markdown file under `decisions/log/`
  with structured frontmatter and a fixed body so future sessions can find,
  cite, and reason about prior choices without re-litigating them. A validation
  script enforces the format so the log stays usable as it grows.
type: workflow
---

## Purpose

Repos accumulate many small decisions per week — pick this tool, name this entity that, skip this feature for v1, defer this rework, settle on this threshold. Most never reach an ADR. They live in chat history and disappear.

This skill turns those moments into a _decision log_ under `decisions/log/`: one file per decision, structured frontmatter, fixed body, sortable filenames. A future session can grep / scan / link to past decisions instead of re-deciding the same thing.

This is _not_ a replacement for formal ADRs. ADRs are for architecturally significant choices and carry full context; they live wherever the repo keeps them (commonly `decisions/` or `docs/decisions/`). The log is for the rest — the everyday repo-local decisions that still matter but don't warrant an ADR.

## When to capture a decision

Capture when the user **commits to a choice** that a future reader might want to look up. Strong signals:

- Picking between options that were debated: "let's go with B", "use Cloudflare not Route 53", "we'll do shaped diffs not full snapshots"
- Locking in a value, name, owner, or threshold: "call it `Pasture`", "default timeout is 500 ms", "Vitaliy owns the doctor repo"
- Settling an open question: "skip subscription for v1", "no Bluetooth in v0 collars"
- Reversing or superseding a prior decision: "scratch that, switch back to Postgres"
- Explicit user request: "log this decision", "track that", "save this as a decision"

Skip when:

- The user is just instructing you to do a task ("write a function that does X")
- It's a transient style preference ("be more concise")
- It's a code-level correction ("rename foo to bar")
- It's brainstorming, not a commitment ("we could maybe use Redis here")

When in doubt, prefer to capture — a small log is more useful than a missing one. But capture _the decision_, not the entire conversation.

## Storage layout

```
decisions/
├── 001-…md            # formal ADRs (don't touch from this skill)
├── 002-…md
├── …
└── log/               # auto-tracked decisions (this skill writes here)
    ├── 2026-05-18-01-pasture-replaces-piquete.md
    ├── 2026-05-18-02-doctor-uses-tauri.md
    └── …
```

The `decisions/log/` folder is created on first capture. Do **not** write to numbered ADR files (`decisions/NNN-*.md`) — those are managed manually.

## Filename format

`YYYY-MM-DD-NN-short-slug.md`

- `YYYY-MM-DD` — the date of the decision (today's date by default)
- `NN` — zero-padded sequence number for that day, starting at `01`
- `short-slug` — 2-6 kebab-case words capturing the gist

Picking the sequence number: list `decisions/log/` for files matching today's date, find the highest `NN`, increment by one. If none, start at `01`.

**Examples**

- `2026-05-18-01-pasture-replaces-piquete.md`
- `2026-05-18-02-skip-subscription-for-v1.md`
- `2026-05-19-01-cloudflare-not-route53.md`

## File format

ALWAYS use this exact structure. The validator (`scripts/validate.mjs`) checks every part — drift breaks the log.

```markdown
---
id: 2026-05-18-01
date: 2026-05-18
topic: pasture-replaces-piquete
status: active
tags: [glossary, terminology]
linear: PASE-387
supersedes:
---

# Pasture replaces Piquete

## Decision

We'll use **Pasture** as the canonical Pastorix term; **Piquete** is treated only as a labelled El Retiro source term, never as the canonical name.

## Context

Reviewing the glossary, we noticed `Piquete` and `Pasture` were used interchangeably across docs. This created confusion for new contributors and broke the "single source of truth" rule. The decision came up while updating PASE-387.

## Reasoning

`Pasture` is the English-language industry-standard term and aligns with the Pastorix product name. `Piquete` is Paraguay-specific and belongs as a labelled source term, not as a canonical synonym.

## Source

User in conversation, 2026-05-18: "Always use `Pasture`/`Herd`, not El Retiro `Piquete`/`Mali`; source terms only as labelled mappings."
```

### Frontmatter fields

| Field        | Required | Format                                 | Notes                                                                                                                                                                                 |
| ------------ | -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | yes      | `YYYY-MM-DD-NN`                        | Must match filename prefix                                                                                                                                                            |
| `date`       | yes      | `YYYY-MM-DD`                           | Must match the date portion of `id`                                                                                                                                                   |
| `topic`      | yes      | kebab-case slug                        | Must match the slug portion of the filename                                                                                                                                           |
| `status`     | yes      | `active` \| `superseded` \| `reversed` | Default `active`                                                                                                                                                                      |
| `tags`       | yes      | YAML list of kebab-case strings        | Can be empty list `[]`                                                                                                                                                                |
| `linear`     | optional | Linear issue id (e.g. `PASE-387`)      | Linear card reference, if any                                                                                                                                                         |
| `supersedes` | optional | another decision `id`, or empty        | Required if `status: superseded` points _at_ something else — but on the _new_ decision use `supersedes:` referencing the old id; mark the old file's `status: superseded` separately |

### Body sections

Exactly these four `##` sections, in this order:

1. **Decision** — one or two sentences. The choice itself, no fluff.
2. **Context** — 2-4 sentences. Why it came up, what was being discussed.
3. **Reasoning** — 1-3 sentences. Why this option won. May be omitted if the decision is purely a fiat call by the user — in that case use `Reasoning: User call, no further rationale given.` to keep the section non-empty.
4. **Source** — paraphrased or quoted conversation excerpt, plus date. Brief — one or two lines.

The H1 title (`# Title`) is required and should be a human-readable version of the topic slug.

## Workflow when capturing a decision

1. **Confirm it's a decision worth logging** — apply the "When to capture" rules. If unsure, ask the user briefly.
2. **Pick a filename** — today's date, next sequence number, short kebab-case slug from the decision.
3. **Draft the file** — fill in frontmatter, then the four body sections.
4. **Handle supersedes** — if this decision overrides a prior one, set `supersedes: <old-id>` on the new file AND update the old file's frontmatter `status: superseded`.
5. **Write the file** to `decisions/log/<filename>.md`.
6. **Run the validator** — from the repo root, run `node <skill-dir>/scripts/validate.mjs`, where `<skill-dir>` is this skill's directory (the one containing this SKILL.md). Fix anything it flags before moving on.
7. **Tell the user** what was captured: one-line confirmation with the filename, e.g. _"Logged at `decisions/log/2026-05-18-01-pasture-replaces-piquete.md`."_

## Validation

`scripts/validate.mjs` checks every file in `decisions/log/`:

- Filename matches `YYYY-MM-DD-NN-slug.md`
- Frontmatter parses and has all required fields
- `id` matches filename
- `date` matches `id`'s date portion
- `topic` matches filename slug
- `status` is one of the allowed values
- `supersedes` (if set) points to an existing decision file
- Body has all four required sections in order
- No required section is empty

Exit code is non-zero on any failure. Run it after each new capture, and wire it into pre-commit / CI when convenient — the script is importable, so a repo precheck pipeline can fold its findings into a central report.

## Reference

For the full file template and edge-case rules, see [`references/format.md`](references/format.md). For a copy-paste starting point, see [`template.md`](template.md).
