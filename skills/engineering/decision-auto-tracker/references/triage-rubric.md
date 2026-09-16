# Decision Triage Rubric

Use this rubric in two places:

1. **At capture time** — before you write a file, classify the candidate. Only `product`, `technical` and durable `process` decisions go into `decisions/log/`.
2. **At audit time** — periodically classify every existing entry to find noise, duplicates and drift. `scripts/audit-manifest.mjs` produces the mechanical part; a reviewer (human or LLM) applies the semantic part.

The rubric is project-agnostic. Examples are illustrative, not exhaustive.

## Categories

Every entry gets exactly one category.

| Category | Definition | Typical examples | Belongs in `decisions/log/`? |
| --- | --- | --- | --- |
| `product` | A rule about what the product does or means: domain behaviour, thresholds, glossary terms, scope cuts, tenant/user-facing policy. | "Pasture is the canonical term", "outside-fence debounce is 500 ms", "no subscriptions in v1" | **Yes** |
| `technical` | An architecture, protocol, data-model or design choice inside the codebase that outlives the current task. | "one multicast group per band", "status is derived from the supersedes graph", "delta patches use bsdiff + heatshrink" | **Yes** |
| `process` | How the team works: branching, review policy, where documents live, release cadence, tooling the whole team depends on. | "monobranch, no PRs", "ADRs live in the docs repo", "pnpm, never npx" | **Only if durable** — see the durability test below |
| `agent-harness` | A rule about the AI agent's own operation: hooks, stop-gates, skills, prompts, AGENTS.md / CLAUDE.md content, review-loop counts, which skill to invoke, how the agent verifies its own work. | "one AI review round per PR", "stop-gate falls back to WSL", "fix-with-spec creates its worktree from fresh main" | **No.** Home is `AGENTS.md` / `CLAUDE.md` or the repo that owns the skill. |
| `task-execution` | A one-off choice about how to finish a specific ticket, PR or session: ship now vs wait, waive a check, close a ticket with a gap, pick a branch to base on. It expires when the work item closes. | "ship the counter fix as a standalone PR and close TICKET-911", "waive local green for TICKET-1066" | **No.** Record it in the ticket or PR. |
| `clarification` | Restates or narrows an existing entry without changing the choice. | "the 500 ms debounce also applies to re-entry" | **No new file.** Add a `## Clarification YYYY-MM-DD` block to the existing entry. |
| `duplicate` | Says the same thing as an earlier entry, with different words. | — | **No.** Supersede or delete per the repo's log policy. |

**Exception for agent-tooling repos.** If the repo's product *is* the agent tooling (a skills repo, a hooks library), decisions about that tooling are `technical` or `product`, not `agent-harness`. The category describes the relation between the decision and the repo, not the topic in isolation.

## Durability test

Ask three questions. A decision worth logging answers **yes** to at least two.

1. Will a teammate need this **after the current ticket or PR closes**?
2. Would a **new contributor** six months from now be surprised if they did not know it?
3. Does it **constrain future code, data or behaviour**, rather than describe one execution path?

`task-execution` entries usually fail all three. `agent-harness` entries may pass but belong elsewhere.

## Verdicts

| Verdict | Meaning | Applies to |
| --- | --- | --- |
| `keep` | Correctly tracked. | `product`, `technical`, durable `process` |
| `demote` | Should exist, but not as its own file. | `clarification`; a `process` entry that is really a note for a runbook |
| `should-not-track` | Should never have been logged here. | `agent-harness`, `task-execution`, `duplicate` |

## Quality flags

Flags are independent of the category. An entry may carry several.

**Mechanical** — produced by `scripts/audit-manifest.mjs`:

| Flag | Rule |
| --- | --- |
| `long-slug` | slug has more than 6 words |
| `id-collision` | another file in the log shares the same `YYYY-MM-DD-NN` id |
| `decision-too-long` | the `## Decision` section has more than 2 sentences |
| `undated-source` | the `## Source` section has no `YYYY-MM-DD` date |
| `hook-sourced` | the `## Source` section cites a stop-hook, gate, linter or CI message rather than the user |
| `ticket-in-slug` | the slug contains an issue-tracker id (e.g. `abc-123`) |
| `validator-error` | `scripts/validate.mjs` reports an issue for this file |

**Semantic** — produced by the reviewer:

| Flag | Rule |
| --- | --- |
| `no-rationale` | Reasoning is absent or is only "User call" **and** the decision is not a fiat pick between named options |
| `multi-decision` | the entry bundles two or more independent choices that should be separate entries |
| `restates-existing` | most of the content already exists in another entry (name it in `related`) |
| `stale-context` | the Context describes a situation that no longer applies (a closed ticket, a retired component) |

## Classifier output

When an LLM or a script classifies entries, emit **one JSON object per file**, one per line (JSONL). Use the file basename as the key.

```json
{"file": "2026-05-18-01-pasture-replaces-piquete.md", "category": "product", "verdict": "keep", "confidence": "high", "flags": [], "related": [], "reason": "Glossary rule that constrains all future docs and code."}
```

| Field | Values |
| --- | --- |
| `file` | basename of the entry |
| `category` | one of the seven categories above |
| `verdict` | `keep` \| `demote` \| `should-not-track` |
| `confidence` | `high` \| `medium` \| `low` |
| `flags` | semantic flags only; mechanical flags come from the manifest |
| `related` | basenames of other entries this one duplicates, clarifies or bundles with; `[]` if none |
| `reason` | one sentence, at most 25 words |

Merge the classifier output with the manifest on `file` to get the full picture.

## Running an audit

```bash
# 1. Mechanical pass (from the repo root)
node <skill-dir>/scripts/audit-manifest.mjs --log-dir decisions/log > manifest.jsonl

# 2. Semantic pass — batch the entry files (≈40 per call) together with this rubric
#    and an index of all filenames, and ask the reviewer for JSONL output.

# 3. Merge on `file`, then summarise: counts per category and verdict,
#    top flags, and 3 examples per noise category.
```

The audit changes nothing. Act on its report per the repo's log policy (append-only repos supersede; others may edit or delete).
