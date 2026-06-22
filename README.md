# kotivskyi/skills

Vitalii Kotivskyi's [Claude Code](https://claude.ai/code) skills.

## Install

```shell
# As a Claude Code plugin (recommended)
claude plugin install github:Kotivskyi/skills

# Or symlink for local development
bash scripts/link-skills.sh
```

## Skills

### Model-invoked

| Skill | Description |
| :---- | :---------- |
| [plan](./skills/engineering/plan/SKILL.md) | Break down a feature or task into an approved implementation plan before touching code. |
| [pr-watch](./skills/engineering/pr-watch/SKILL.md) | Drive a GitHub PR to fully green checks and fully addressed review threads, or exit with a precise blocker. |
| [ship](./skills/engineering/ship/SKILL.md) | Pre-merge go/no-go checklist: CI, reviews, migrations, env vars, secrets scan. |

## Structure

```
skills/
├── engineering/     # daily code and PR work
├── misc/            # kept around, rarely used
├── in-progress/     # drafts, not in plugin.json
└── deprecated/      # no longer used
```

See [CLAUDE.md](./CLAUDE.md) for governance rules (how to add, change, or remove skills).

## Versioning

Changes are tracked with [Changesets](https://github.com/changesets/changesets). Before merging to `main`, run:

```bash
npm run changeset
```

The release workflow opens a version PR automatically.

## License

MIT
