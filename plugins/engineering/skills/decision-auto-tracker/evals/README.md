# Evals for `decision-auto-tracker`

Two sets, measuring different things.

## `trigger-eval.json` — does the description fire?

56 queries, 28 that should invoke the skill and 28 near-misses that should not. The negatives come from real decision-log noise: one-off task picks, agent-harness rules, ADR/RFC requests, log lookups, spec deltas, uncommitted brainstorming. They share vocabulary with the positives, so a keyword-matching description fails them.

**Baseline** (Opus 5, 3 runs per query, one turn each):

| Metric | Result |
| --- | ---: |
| Recall (28 positives) | 27/28 — 96.4% |
| Specificity (28 negatives) | 28/28 — 100% |
| Accuracy | 55/56 — 98.2% |

The single miss is "put this somewhere permanent: soak tests run for 19 hours minimum…". The agent orients with `Bash` before deciding, so a one-turn harness scores it a miss; a real session would likely reach the skill on the next turn. A description variant that added "standing rule", "policy", "put this somewhere permanent" and "make sure this is written down" scored **identically** (55/56, same miss) for 184 more characters, so the shorter description stands.

### Running it

`skill-creator`'s `run_loop.py` / `run_eval.py` do **not** measure this correctly on a dev machine:

- they run `claude -p` with cwd set to the project root found by walking up for a `.claude/` dir, which resolves to `$HOME` — with no repo in view the agent's first tool call is an orienting `Bash`;
- they return `False` as soon as the first tool call is anything but `Skill`/`Read`, and never look past it.

Together those score every positive as a miss regardless of the description (observed: recall 0%). They also leave temp command files in `~/.claude/commands/`.

Measure it instead with a harness that builds a throwaway repo containing a `decisions/log/`, installs the skill as the only copy that run can see, and looks for the `Skill` call anywhere in the turn.

## `evals.json` — does the skill do the right thing?

11 behaviour cases over two fixture repos in `files/`:

- `repo-stored/` — default config: `status` stored in each file, log editable, plus an `AGENTS.md` for the agent-harness case.
- `repo-derived/` — `decision-log.json` with `statusMode: derived`, `appendOnly: true`, six buckets and a `templateNote`.

Cases cover: logging a product decision; skipping a task pick, an agent-harness rule and brainstorming; splitting a durable rule out of a task pick; superseding in both modes; a clarification; same-day sequence numbering; and a long title with a short slug.

Each case gives the agent a fixture copy and a conversation excerpt, then asserts on the resulting files — count, id, frontmatter, Decision length, slug length, whether the superseded file changed, and `validate.mjs` exit code. Assertions are mechanical, so a script can grade them.

**Baseline** (Opus 5, 1 run per case, against the previous version of this skill):

| | New | Previous version |
| --- | ---: | ---: |
| Assertions passed | 94/94 | 91/94 |

The previous version logged the agent-harness rule as a decision (1/3) and wrote a three-sentence Decision (4/5). Nine of the eleven cases tie — they guard against regression rather than demonstrate improvement.
