---
name: agent-self-harness
description: Use when improving an agent harness from execution evidence, including mining Codex or Claude Code local sessions, using already-normalized trace packets, proposing competing skill/prompt/tool changes, validating candidates with skill-creator evals, or running a governed Self-Harness loop with explicit approval gates.
---

# Agent Self-Harness

Run a bounded Self-Harness loop for improving agent skills, prompt/harness files, or bundled tools from recorded execution behavior. The point is not to make an autonomous self-improving agent; it is to turn trace evidence into small, evaluated, reversible harness changes that the user explicitly approves.

## First Action: Dependency Check

Before reading execution history, normalizing traces, mining weaknesses, or editing files:

1. Check that `agent-weakness-miner` is installed and readable.
2. Check that `skill-creator` is installed and readable.

If either dependency is missing, stop. Do not scaffold a replacement, inspect raw history, or continue in degraded mode.

Use this setup message:

```text
agent-self-harness cannot start because required dependencies are missing.

Install the missing skills from the same source package as agent-self-harness:
- agent-weakness-miner
- skill-creator

After installation, rerun agent-self-harness with the same source request.
```

## Workflow

Read `references/self-harness-loop.md` before running the workflow. It is the state machine for this skill.

1. **Select source.** If the user did not already specify source and discovery mode, ask for them. Supported generic sources:
   - Codex local execution history.
   - Claude Code local execution history.
   - Explicit already-normalized trace packet path.
2. **Load source reference.** Read `references/source-discovery.md` for Codex and Claude Code discovery, or `references/trace-packet-schema.md` for explicit packets.
3. **Normalize traces.** Use the deterministic scripts in `scripts/` to produce redacted trace packets. Do not decide weakness during extraction.
4. **Mine weaknesses.** Invoke `agent-weakness-miner` on the normalized packets. It must produce `weaknesses.json` and a compact Markdown review.
5. **Gate 1: weakness selection.** Present compact weakness packets and stop. The user must select exactly one weakness before candidate work begins. Do not create worktrees, add evals, or edit files before this approval.
6. **Plan validation.** Derive targeted eval ideas from the selected weakness and show the targeted eval strategy. Reuse existing `evals/evals.json` as the regression suite when present. Preserve real task evals when `skill-creator` judges them better than synthetic prompts.
7. **Generate candidates.** Read `references/candidate-worktrees.md`. Create multiple competing candidate changes in isolated worktrees under `/tmp/agent-team.worktrees/`. Each candidate tests one conceptual mechanism.
8. **Validate candidates.** Run targeted evals for all candidates. Run full regression evals only for candidates that clear the targeted bar.
9. **Rank candidates.** Recommend only candidates with targeted improvement and no material regression. Treat quality as materially similar only when pass rates are within roughly five percentage points and no high-priority expectation differs. When quality is materially similar, lower token usage wins first, faster runtime second, and smaller diff size third.
10. **Optimize once if useful.** Default to one diverse round and one focused optimization round. More rounds require user approval.
11. **Gate 2: final apply approval.** Read `references/final-approval-brief.md`. Present the selected candidate and stop for explicit approval before applying.
12. **Apply locally only after approval.** No merge, push, or broad cleanup happens before approval.

## Candidate Surfaces

Candidate proposals may:

- Add a new skill.
- Edit an existing skill.
- Edit an explicitly selected non-Paperclip prompt or harness file, such as project `AGENTS.md` or `agent.md`.
- Add or modify a bundled deterministic script/tool.
- Recommend a new external tool, with justification.

Root or project-wide `AGENTS.md` changes need evidence that the weakness is repo-wide and broader regression coverage. If a candidate modifies `agent-self-harness`, `agent-weakness-miner`, or `paper-agent-self-harness`, the final brief must include a self-modification risk summary and rollback instructions.

## Run Artifacts

Store run evidence separately from skill source, for example:

```text
.agent-self-harness/runs/<timestamp>-<source>-<slug>/
```

Keep raw trace inspection explicit and local-only. Redacted trace packets, weakness packets, eval strategy, candidate summaries, validation results, timing, token usage, and approval briefs belong in the run folder.

Do not push by default. Commit, push, merge, or publish only when the user explicitly requests that separate workflow.

## Stop Conditions

Stop and report clearly when:

- Required dependencies are missing.
- No credible weakness is found.
- The user declines Gate 1 weakness selection.
- All candidates fail targeted validation or cause material regression.
- The user declines Gate 2 final approval.
- A requested source needs raw trace access and the user has not approved it.

When no safe improvement exists, say so. Do not force a candidate.
