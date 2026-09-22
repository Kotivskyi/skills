# skill-finder evals

Two files, in the `skill-creator` format:

- `evals.json`: 12 behavior cases. Each case names what a correct run leaves on disk and says in the answer.
- `trigger-eval.json`: 24 queries. 12 must fire the skill. 12 are near-misses that must not fire it.

## The eval world

Every behavior case starts with this command, from the skill folder:

```bash
node evals/fixtures/make-world.mjs /tmp/skill-finder-world
```

It writes a fresh world. It refuses a folder that is not empty and has no `.skill-finder-world` marker. The world is generated, not committed, because the repo sync script treats every committed `SKILL.md` as a skill.

| Path | Content | Cases |
| :--- | :--- | :--- |
| `claude-store/` | 32 Claude Code sessions | all |
| 12 sessions titled "Deploy sim runner to staging" | Recurring work with no skill | 1, 5, 10 |
| 3 sessions titled "Write HTTP request files ..." | Work that `write-http-files` covers, and it never fires | 2, 11 |
| 3 sessions with `release-notes` and a pnpm correction | A repo skill that misfires | 3 |
| 3 sessions with `acme-tools:changelog-writer` and a format correction | A plugin skill that misfires | 8 |
| 1 session "Rotate the grafana token" | One-off work | 4 |
| 10 maintenance sessions | Near-miss prompts for the eval harvest | 10 |
| `project/openspec/changes/archive/` | 2 archived changes about the deploy work | 5, 10 |
| `project/.agents/skills/` | `write-http-files`, `release-notes` | all |
| `home/.claude/plugins/` | Plugin `acme-tools@acme` with `changelog-writer` | 8 |
| `project/.skill-finder/runs/20260901-090000-shop/` | A previous run with 3 suggestions | 7 |
| `project/.skill-finder/prepared/20260922-100000-moved/` | A run whose evidence pointer moved | 9 |

`scripts/world.test.mjs` checks that the world gives each result that the cases expect.

## Run the evals

- Trigger evals: use the `skill-creator` description optimizer with `evals/trigger-eval.json`.
- Behavior evals: use the `skill-creator` eval runner with `evals/evals.json`. Grade each expectation against the files in `/tmp/skill-finder-world` and the final answer.
