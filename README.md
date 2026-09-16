# kotivskyi/skills

Vitalii Kotivskyi's skills and plugins for [Claude Code](https://claude.ai/code).

## Install

Add this repository as a Claude Code marketplace, then install the engineering plugin:

```shell
claude plugin marketplace add Kotivskyi/skills
claude plugin install engineering@kotivskyi-skills
```

Restart Claude Code after installation. See the [Claude Code installation guide](https://code.claude.com/docs/en/discover-plugins).

The plugin ships one `SessionStart` hook ([hooks/hooks.json](./plugins/engineering/hooks/hooks.json)). It adds two or three lines of context only in projects that contain a `design-specs/` folder, for the `design-spec-tracker` skill. In every other project it prints nothing.

The existing `kotivskyi-skills@kotivskyi-skills` plugin remains available. Enable only one skills plugin to avoid duplicate skills and hooks.

To install individual skills with the skills CLI:

```shell
npx skills@latest add kotivskyi/skills
```

## Skills

### User-invoked

| Skill | Description |
| :---- | :---------- |
| [handoff](./skills/engineering/handoff/SKILL.md) | Compact the current conversation into a handoff document for another agent to pick up. |

### Model-invoked

| Skill | Description |
| :---- | :---------- |
| [agent-self-harness](./skills/engineering/agent-self-harness/SKILL.md) | Improve an agent harness from execution evidence — mine Codex/Claude Code sessions into trace packets, propose competing skill/prompt/tool changes, and validate candidates with `skill-creator` evals behind explicit approval gates. |
| [agent-weakness-miner](./skills/engineering/agent-weakness-miner/SKILL.md) | Mine normalized trace packets for recurring agent weaknesses — audit packet quality first, then produce weakness packets with suspected failure mechanisms, target surfaces, and targeted eval ideas. Feeds `agent-self-harness`. |
| [authoring-skills](./skills/engineering/authoring-skills/SKILL.md) | Conventions for the plumbing around a skill in this repo: how it switches itself on, tagged blocks in a user's `CLAUDE.md`, setup-script contract, and idle-cost rules for hooks. Auto-install scripts need the user's explicit yes. |
| [bdd-create](./skills/engineering/bdd-create/SKILL.md) | Author BDD scenarios and acceptance criteria (Given-When-Then) — the specification side, no implementation. |
| [bdd-implement](./skills/engineering/bdd-implement/SKILL.md) | Turn BDD scenarios into executable tests — step definitions and Cucumber/Jest/Playwright glue via TDD. |
| [decision-auto-tracker](./skills/engineering/decision-auto-tracker/SKILL.md) | Capture durable user decisions from conversations into a greppable log under `decisions/log/` — one validated Markdown file per decision, with a scaffolder, a config-driven validator, and an audit rubric for finding noise in an existing log. |
| [design-spec-tracker](./skills/engineering/design-spec-tracker/SKILL.md) | Keep a developer handoff spec written and current while a designer works — same sections as the `design` plugin's `/design-handoff`, filled incrementally under `design-specs/` with gaps and Claude's suggestions marked, plus a readiness validator. |
| [diagnosing-bugs](./skills/engineering/diagnosing-bugs/SKILL.md) | Feedback-loop-first diagnosis discipline for hard bugs and perf regressions — build a tight red-capable repro, then hypothesize/instrument/fix. Bundled dependency of `fix-with-spec`. |
| [fix-with-spec](./skills/engineering/fix-with-spec/SKILL.md) | Plan-gated bug/behavior fix that keeps OpenSpec specs consistent under any schema — discovers schemas/apply steps from the OpenSpec CLI; hard-depends on bundled `diagnosing-bugs` & `tdd` plus the project's `/opsx:propose`. |
| [handoff-to-paperclip](./skills/engineering/handoff-to-paperclip/SKILL.md) | Hand off this session's in-progress work to the Paperclip agent team (CTO by default) — isolated worktree, context doc, and a real PR. |
| [plan](./skills/engineering/plan/SKILL.md) | Break down a feature or task into an approved implementation plan before touching code. |
| [pr-watch](./skills/engineering/pr-watch/SKILL.md) | Drive a GitHub PR to fully green checks and fully addressed review threads, or exit with a precise blocker. |
| [ship](./skills/engineering/ship/SKILL.md) | Pre-merge go/no-go checklist: CI, reviews, migrations, env vars, secrets scan. |
| [tdd](./skills/engineering/tdd/SKILL.md) | Test-driven development via vertical tracer-bullet slices (one test → one impl → repeat); tests verify behavior through public interfaces. Bundled dependency of `fix-with-spec` (adapted from mattpocock/skills, MIT). |
| [write-http-files](./skills/engineering/write-http-files/SKILL.md) | Author runnable `.http` / `.rest` request files (JetBrains HTTP Client / VS Code REST Client format) with variables, environments, and response chaining. |

See [CLAUDE.md](./CLAUDE.md) for governance rules (how to add, change, or remove skills).

## Plugins

[Engineering](./plugins/engineering/README.md) contains all 16 active engineering skills and their support files.
Its `skills/` directory uses the [standard Claude Code plugin layout](https://code.claude.com/docs/en/plugins).
Use `/engineering:plan`, `/engineering:pr-watch`, or `/engineering:handoff` after installation.

Test the engineering plugin from this repository:

```shell
claude --plugin-dir ./plugins/engineering
```

[Shunt for Pi](./plugins/shunt/README.md) uses the Pi CLI for bulk file reads and code generation.
It keeps Spotify Shunt's hooks and skills, with Bash scripts and a shared helper. Python is not required.

After adding the marketplace above, install Shunt:

```shell
claude plugin install shunt@kotivskyi-skills
```

Shunt requires Bash 3.2 or later, `jq`, and an authenticated Pi CLI.
See its [setup instructions](./plugins/shunt/README.md#setup) and [configuration reference](./plugins/shunt/README.md#configuration).

For local development, run this command from a clone of this repository:

```shell
claude --plugin-dir ./plugins/shunt
```

Edit [Pi settings](./plugins/shunt/.pi/settings.json) to select the provider, model, and thinking level for both workers.

## License

MIT. The [Shunt plugin](./plugins/shunt/LICENSE) uses Apache-2.0.
