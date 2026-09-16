---
name: agent-weakness-miner
description: Use when normalized Codex, Claude Code, Paperclip, or external trace packets, including packets generated from local Codex or Claude Code sessions, need packet-quality auditing and mining for recurring agent weaknesses, compact weakness packets, suspected harness failure mechanisms, target surfaces, and targeted eval ideas before a self-harness improvement run.
---

# Agent Weakness Miner

Find actionable recurring harness weaknesses from normalized trace packets. This skill performs LLM judgment over redacted evidence; when the user starts from local Codex or Claude Code sessions, use deterministic normalizers first and do not mine raw transcripts directly.

## Inputs

- A JSON file containing trace packets that follow `agent-self-harness/references/trace-packet-schema.md`.
- Optional local Codex or Claude Code session paths after deterministic normalization by `agent-self-harness/scripts/normalize_codex_session.mjs` or `agent-self-harness/scripts/normalize_claude_session.mjs`.
- Optional operator focus, such as "look for verification failures" or "prioritize token waste only if behavior is otherwise correct."

## Procedure

1. If the user provides local Codex or Claude Code sessions, normalize them into trace packets first. Do not perform weakness judgment over raw session JSONL.
2. Run `scripts/audit_trace_packets.mjs <packets.json> --strict` before analysis. If shape validation fails or the audit reports blocking issues, stop and report the errors instead of mining weaknesses.
3. Carry non-blocking audit warnings into `weakness-review.md` and lower confidence where they affect a group. Common warnings include unknown task goals, low-information Claude task goals with UUIDs or command tags, actionable missing timestamps, or dense failure extraction that may reflect prompt/example text rather than observed failures.
   - If `low_information_task_goal` is present, avoid grouping primarily by task intent until the real user task is recovered or summarized from timeline events.
   - If `missing_timestamps` is present, avoid sequence, latency, or duration claims for affected packets; metadata-only missing timestamps should not drive weakness conclusions.
4. Group related traces by observable failure signals, repeated user interventions, repeated tool/test failures, missing artifacts, blocked workflows, or consistent inefficiency.
5. Distinguish evidence from interpretation:
   - Evidence: what the trace shows.
   - Suspected mechanism: why the harness likely allowed it.
   - Proposed surface: where a future candidate could intervene.
6. Reject one-off noise. If a trace is isolated, ambiguous, or not connected to a harness behavior, say so instead of inventing a weakness.
7. Preserve trace ids in every weakness packet.
8. Produce `weaknesses.json` using `references/weakness-packet.md`.
9. Produce a compact Markdown review for Gate 1. Use a table for comparison and an ASCII diagram only when it clarifies the failure pattern.

## Output Files

```text
trace-packet-audit.json
weaknesses.json
weakness-review.md
```

## Output Contract

`trace-packet-audit.json` is the JSON output from `scripts/audit_trace_packets.mjs`. If `blocking` is true, do not produce weakness packets; write only a short review explaining why mining stopped.

`weaknesses.json` must contain a top-level `weaknesses` array. Every non-empty packet must include `id`, `title`, `affectedTraceIds`, `evidence`, `suspectedMechanism`, `severity`, `frequency`, `confidence`, `proposedSurfaces`, `targetedEvalIdeas`, and `notOneOffNoise`.

`weakness-review.md` must be compact enough for Gate 1. Prefer a comparison table plus one short section per weakness. Include an "Audit limitations" note when the audit has non-blocking warnings. If a workflow diagram helps, use ASCII only.

## Quality Bar

A useful weakness packet is:

- Based on packets that passed the audit without blocking issues.
- Evidence-backed.
- Recurring or explicitly marked low-confidence when evidence is thin.
- Tied to a suspected harness mechanism, not just a task failure.
- Specific enough to generate targeted evals.
- Honest about why it is or is not one-off noise.
- Honest about normalization limits from local Codex or Claude Code session extraction.

If no credible weakness exists, output an empty `weaknesses` array and a short Markdown explanation.
