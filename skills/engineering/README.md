# Engineering skills

Daily code and PR work.

## User-invoked

| Skill | Description |
| :---- | :---------- |
| [handoff](./handoff/SKILL.md) | Compact the current conversation into a handoff document for another agent to pick up. |

## Model-invoked

| Skill | Description |
| :---- | :---------- |
| [agent-self-harness](./agent-self-harness/SKILL.md) | Improve an agent harness from execution evidence — mine Codex/Claude Code sessions into trace packets, propose competing skill/prompt/tool changes, and validate candidates with `skill-creator` evals behind explicit approval gates. |
| [agent-weakness-miner](./agent-weakness-miner/SKILL.md) | Mine normalized trace packets for recurring agent weaknesses — audit packet quality first, then produce weakness packets with suspected failure mechanisms, target surfaces, and targeted eval ideas. Feeds `agent-self-harness`. |
| [authoring-skills](./authoring-skills/SKILL.md) | Conventions for the plumbing around a skill in this repo: how it switches itself on, tagged blocks in a user's `CLAUDE.md`, setup-script contract, and idle-cost rules for hooks. Auto-install scripts need the user's explicit yes. |
| [bdd-create](./bdd-create/SKILL.md) | Author BDD scenarios and acceptance criteria (Given-When-Then) — the specification side, no implementation. |
| [bdd-implement](./bdd-implement/SKILL.md) | Turn BDD scenarios into executable tests — step definitions and Cucumber/Jest/Playwright glue via TDD. |
| [decision-auto-tracker](./decision-auto-tracker/SKILL.md) | Capture durable user decisions from conversations into a greppable log under `decisions/log/` — one validated Markdown file per decision, with a scaffolder, a config-driven validator, and an audit rubric for finding noise in an existing log. |
| [design-spec-tracker](./design-spec-tracker/SKILL.md) | Keep a developer handoff spec written and current while a designer works — same sections as the `design` plugin's `/design-handoff`, filled incrementally under `design-specs/` with gaps and Claude's suggestions marked, plus a readiness validator. |
| [diagnosing-bugs](./diagnosing-bugs/SKILL.md) | Feedback-loop-first diagnosis discipline for hard bugs and perf regressions — build a tight red-capable repro, then hypothesize/instrument/fix. Bundled dependency of `fix-with-spec`. |
| [fix-with-spec](./fix-with-spec/SKILL.md) | Plan-gated bug/behavior fix that keeps OpenSpec specs consistent under any schema — discovers schemas/apply steps from the OpenSpec CLI; hard-depends on bundled `diagnosing-bugs` & `tdd` plus the project's `/opsx:propose`. |
| [handoff-to-paperclip](./handoff-to-paperclip/SKILL.md) | Hand off this session's in-progress work to the Paperclip agent team (CTO by default) — isolated worktree, context doc, and a real PR. |
| [plan](./plan/SKILL.md) | Break down a feature or task into an approved implementation plan before touching code. |
| [pr-watch](./pr-watch/SKILL.md) | Drive a GitHub PR to fully green checks and fully addressed review threads, or exit with a precise blocker. |
| [ship](./ship/SKILL.md) | Pre-merge go/no-go checklist: CI, reviews, migrations, env vars, secrets scan. |
| [skill-finder](./skill-finder/SKILL.md) | Find which skills to create or fix from real work history. Mine Claude Code sessions and OpenSpec archives, rank suggestions by frequency and cost, and apply one with harvested evals after two approvals. |
| [tdd](./tdd/SKILL.md) | Test-driven development via vertical tracer-bullet slices (one test → one impl → repeat); tests verify behavior through public interfaces. Bundled dependency of `fix-with-spec` (adapted from mattpocock/skills, MIT). |
| [write-http-files](./write-http-files/SKILL.md) | Author runnable `.http` / `.rest` request files (JetBrains HTTP Client / VS Code REST Client format) with variables, environments, and response chaining. |
