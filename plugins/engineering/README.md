# Engineering

Engineering skills for Claude Code: planning, implementation, testing, review, and delivery.

## Install

```shell
claude plugin marketplace add Kotivskyi/skills
claude plugin install engineering@kotivskyi-skills
```

Restart Claude Code after installation. Try `/engineering:plan` or `/engineering:handoff`.
Claude can also select skills from their descriptions.

If the marketplace is already installed, update it before installing Engineering:

```shell
claude plugin marketplace update kotivskyi-skills
```

Enable either `engineering` or the existing `kotivskyi-skills` plugin.
Both provide the same engineering skills and SessionStart hook.

## Contents

The package includes all 16 skills listed in the [engineering catalog](../../skills/engineering/README.md).
Each skill includes its scripts, references, and assets under `skills/<name>/`.
The package needs no files outside this directory when Claude Code loads it.

The existing SessionStart hook adds context only when the project contains `design-specs/`.
Individual skills can require tools such as GitHub CLI, Node.js, Python, or OpenSpec.
Check the selected skill for its requirements.

## Development

Edit source files under `skills/engineering/` at the repository root.
The package's `skills/` and `hooks/` directories are generated. Do not edit them directly.

From the repository root:

```shell
sh scripts/sync-agents.sh
node scripts/sync-plugin-version.mjs
sh scripts/sync-agents.sh --check
node scripts/sync-plugin-version.mjs --check
claude plugin validate ./plugins/engineering
claude --plugin-dir ./plugins/engineering
```

The pre-commit hook builds the package from staged source files.
CI checks for source drift. The release workflow sets the version from `package.json`.
