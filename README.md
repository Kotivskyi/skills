# kotivskyi/skills

Vitalii Kotivskyi's [Claude Code](https://claude.ai/code) skills.

## Install

```shell
npx skills@latest add kotivskyi/skills
```

Or directly via the Claude Code CLI:

```shell
claude plugin install github:Kotivskyi/skills
```

## Skills

### User-invoked

| Skill | Description |
| :---- | :---------- |
| [handoff](./skills/engineering/handoff/SKILL.md) | Compact the current conversation into a handoff document for another agent to pick up. |

### Model-invoked

| Skill | Description |
| :---- | :---------- |
| [bdd-create](./skills/engineering/bdd-create/SKILL.md) | Author BDD scenarios and acceptance criteria (Given-When-Then) — the specification side, no implementation. |
| [bdd-implement](./skills/engineering/bdd-implement/SKILL.md) | Turn BDD scenarios into executable tests — step definitions and Cucumber/Jest/Playwright glue via TDD. |
| [decision-auto-tracker](./skills/engineering/decision-auto-tracker/SKILL.md) | Capture substantive user decisions from conversations into a greppable log under `decisions/log/` — one validated Markdown file per decision, with a format-enforcing validator script. |
| [diagnosing-bugs](./skills/engineering/diagnosing-bugs/SKILL.md) | Feedback-loop-first diagnosis discipline for hard bugs and perf regressions — build a tight red-capable repro, then hypothesize/instrument/fix. Bundled dependency of `fix-with-spec`. |
| [fix-with-spec](./skills/engineering/fix-with-spec/SKILL.md) | Plan-gated bug/behavior fix that keeps OpenSpec specs consistent under any schema — discovers schemas/apply steps from the OpenSpec CLI; hard-depends on bundled `diagnosing-bugs` & `tdd` plus the project's `/opsx:propose`. |
| [handoff-to-paperclip](./skills/engineering/handoff-to-paperclip/SKILL.md) | Hand off this session's in-progress work to the Paperclip agent team (CTO by default) — isolated worktree, context doc, and a real PR. |
| [plan](./skills/engineering/plan/SKILL.md) | Break down a feature or task into an approved implementation plan before touching code. |
| [pr-watch](./skills/engineering/pr-watch/SKILL.md) | Drive a GitHub PR to fully green checks and fully addressed review threads, or exit with a precise blocker. |
| [ship](./skills/engineering/ship/SKILL.md) | Pre-merge go/no-go checklist: CI, reviews, migrations, env vars, secrets scan. |
| [tdd](./skills/engineering/tdd/SKILL.md) | Test-driven development via vertical tracer-bullet slices (one test → one impl → repeat); tests verify behavior through public interfaces. Bundled dependency of `fix-with-spec` (adapted from mattpocock/skills, MIT). |
| [write-http-files](./skills/engineering/write-http-files/SKILL.md) | Author runnable `.http` / `.rest` request files (JetBrains HTTP Client / VS Code REST Client format) with variables, environments, and response chaining. |

See [CLAUDE.md](./CLAUDE.md) for governance rules (how to add, change, or remove skills).

## License

MIT
