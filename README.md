# kotivskyi/skills

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
hosting Vitalii Kotivskyi's personal collection of plugins and skills.

## Add this marketplace

```shell
/plugin marketplace add kotivskyi/skills
```

## Install a plugin

```shell
/plugin install hello-world@kotivskyi-skills
```

## Available plugins

| Plugin | Description |
| :----- | :---------- |
| `hello-world` | A minimal example plugin with a single greeting skill. Use it as a template for new plugins. |

## Repository layout

```
.
├── .claude-plugin/
│   └── marketplace.json        # marketplace catalog
└── plugins/
    └── hello-world/            # one directory per plugin
        ├── .claude-plugin/
        │   └── plugin.json     # plugin manifest
        └── skills/
            └── hello/
                └── SKILL.md    # a skill
```

## Add a new plugin

1. Create `plugins/<your-plugin>/` with a `.claude-plugin/plugin.json` manifest.
2. Add skills under `plugins/<your-plugin>/skills/<skill>/SKILL.md` (and/or
   commands, agents, hooks, MCP servers).
3. Add an entry to the `plugins` array in `.claude-plugin/marketplace.json`
   with `"source": "./plugins/<your-plugin>"`.
4. Validate: `claude plugin validate .`

## License

MIT
