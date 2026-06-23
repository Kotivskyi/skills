---
name: agent-weakness-miner
description: Use when normalized Codex, Claude Code, Paperclip, or external trace packets need to be mined for recurring agent weaknesses, compact weakness packets, suspected harness failure mechanisms, target surfaces, and targeted eval ideas before a self-harness improvement run.
---

# Agent Weakness Miner

Find actionable recurring harness weaknesses from normalized trace packets. This skill performs LLM judgment over already-redacted evidence; it does not fetch raw traces and does not propose edits before the evidence is organized.

## Inputs

- A JSON file containing trace packets that follow `agent-self-harness/references/trace-packet-schema.md`.
- Optional operator focus, such as "look for verification failures" or "prioritize token waste only if behavior is otherwise correct."

## Procedure

1. Validate the packet shape before analysis. If required fields are missing, stop and report the field errors.
2. Group related traces by observable failure signals, repeated user interventions, repeated tool/test failures, missing artifacts, blocked workflows, or consistent inefficiency.
3. Distinguish evidence from interpretation:
   - Evidence: what the trace shows.
   - Suspected mechanism: why the harness likely allowed it.
   - Proposed surface: where a future candidate could intervene.
4. Reject one-off noise. If a trace is isolated, ambiguous, or not connected to a harness behavior, say so instead of inventing a weakness.
5. Preserve trace ids in every weakness packet.
6. Produce `weaknesses.json` using `references/weakness-packet.md`.
7. Produce a compact Markdown review for Gate 1. Use a table for comparison and an ASCII diagram only when it clarifies the failure pattern.

## Output Files

```text
weaknesses.json
weakness-review.md
```

## Output Contract

`weaknesses.json` must contain a top-level `weaknesses` array. Every non-empty packet must include `id`, `title`, `affectedTraceIds`, `evidence`, `suspectedMechanism`, `severity`, `frequency`, `confidence`, `proposedSurfaces`, `targetedEvalIdeas`, and `notOneOffNoise`.

`weakness-review.md` must be compact enough for Gate 1. Prefer a comparison table plus one short section per weakness. If a workflow diagram helps, use ASCII only.

## Quality Bar

A useful weakness packet is:

- Evidence-backed.
- Recurring or explicitly marked low-confidence when evidence is thin.
- Tied to a suspected harness mechanism, not just a task failure.
- Specific enough to generate targeted evals.
- Honest about why it is or is not one-off noise.

If no credible weakness exists, output an empty `weaknesses` array and a short Markdown explanation.
