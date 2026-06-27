# Engineering skills

Daily code and PR work.

## User-invoked

| Skill | Description |
| :---- | :---------- |
| [handoff](./handoff/SKILL.md) | Compact the current conversation into a handoff document for another agent to pick up. |

## Model-invoked

| Skill | Description |
| :---- | :---------- |
| [bdd-create](./bdd-create/SKILL.md) | Author BDD scenarios and acceptance criteria (Given-When-Then) — the specification side, no implementation. |
| [bdd-implement](./bdd-implement/SKILL.md) | Turn BDD scenarios into executable tests — step definitions and Cucumber/Jest/Playwright glue via TDD. |
| [diagnosing-bugs](./diagnosing-bugs/SKILL.md) | Feedback-loop-first diagnosis discipline for hard bugs and perf regressions — build a tight red-capable repro, then hypothesize/instrument/fix. Bundled dependency of `fix-with-spec`. |
| [fix](./fix/SKILL.md) | Fix a bug or adjust behavior fast while keeping its OpenSpec capability spec consistent — gated behind a lean, approvable plan. |
| [fix-with-spec](./fix-with-spec/SKILL.md) | Repo-agnostic version of `fix`: keeps OpenSpec specs consistent under any schema by discovering schemas/apply steps from the OpenSpec CLI; hard-depends on bundled `diagnosing-bugs` & `tdd` plus the project's `/opsx:propose`. |
| [handoff-to-paperclip](./handoff-to-paperclip/SKILL.md) | Hand off this session's in-progress work to the Paperclip agent team (CTO by default) — isolated worktree, context doc, and a real PR. |
| [plan](./plan/SKILL.md) | Break down a feature or task into an approved implementation plan before touching code. |
| [pr-watch](./pr-watch/SKILL.md) | Drive a GitHub PR to fully green checks and fully addressed review threads, or exit with a precise blocker. |
| [ship](./ship/SKILL.md) | Pre-merge go/no-go checklist: CI, reviews, migrations, env vars, secrets scan. |
| [tdd](./tdd/SKILL.md) | Test-driven development via vertical tracer-bullet slices (one test → one impl → repeat); tests verify behavior through public interfaces. Bundled dependency of `fix-with-spec` (adapted from mattpocock/skills, MIT). |
| [write-http-files](./write-http-files/SKILL.md) | Author runnable `.http` / `.rest` request files (JetBrains HTTP Client / VS Code REST Client format) with variables, environments, and response chaining. |
