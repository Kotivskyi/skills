# Repository guide

Monobranch repo. Commit straight to `main`. No pull requests.

## Layout

Skills are organized into bucket folders under `skills/`:

- `engineering/` — daily code and PR work
- `misc/` — kept around but rarely used
- `in-progress/` — drafts not yet ready to ship
- `deprecated/` — no longer used

Every skill in `engineering/` or `misc/` must have a reference in the top-level `README.md` and an entry in `.claude-plugin/plugin.json`. Skills in `in-progress/` and `deprecated/` must not appear in either.

Each skill entry in the top-level `README.md` must link the skill name to its `SKILL.md`.

Each bucket folder has a `README.md` that lists every skill in the bucket with a one-line description, with the skill name linked to its `SKILL.md`. Bucket `README.md`s and the top-level `README.md` group entries into **User-invoked** and **Model-invoked**.

Every `SKILL.md` is either user-invoked (`disable-model-invocation: true`, reachable only by the human) or model-invoked (model- or user-reachable). For full definitions see [docs/invocation.md](./docs/invocation.md).

## Adding a skill

1. Create `skills/<bucket>/<skill-name>/SKILL.md`.
2. Add it to `.claude-plugin/plugin.json` under `skills`.
3. Add it to the bucket `README.md` under the correct invocation heading.
4. Add it to the top-level `README.md` under the correct invocation heading.

Before adding a hook, a setup script, or anything that writes into a file the user owns, read the [authoring-skills](./skills/engineering/authoring-skills/SKILL.md) skill. Auto-install scripts are not always wanted, so ask the user before adding one.

## Removing a skill

Move the directory to `skills/deprecated/` and remove it from `plugin.json` and both `README.md`s.

## Versioning

Three manifests carry the engineering release version and must agree:

- `package.json` is the source of truth. The release workflow runs `npm version patch` on every push to `main` that is not itself a bump commit.
- `.claude-plugin/plugin.json` is the version Claude Code records when someone installs the plugin. A stale value there means installed copies never see an update, however many times `package.json` was bumped.
- `plugins/engineering/.claude-plugin/plugin.json` is the version for the standalone engineering plugin.

Do not hand-edit these versions. The release workflow bumps `package.json`, runs the sync script, then commits all release files.

Check locally that they agree:

```shell
node scripts/sync-plugin-version.mjs --check
```

`plugins/shunt/.claude-plugin/plugin.json` carries its own upstream version and is never synced from `package.json`.

## Skill mirrors

`skills/` is the sole source of truth. Two generated copies give agents working inside this repo the same skills the plugin ships:

```
skills/<bucket>/<name>/  ->  .agents/skills/<name>/
                         ->  .claude/skills/<name>/
```

Never hand-edit either dot-tree. Anything typed there is destroyed on the next sync. Edit `skills/<bucket>/<name>/` and run the script.

The same script generates the standalone Claude Code plugin at `plugins/engineering/`:

- `skills/engineering/<name>/` becomes `plugins/engineering/skills/<name>/`.
- `hooks/hooks.json` becomes `plugins/engineering/hooks/hooks.json`, with paths adjusted for the flat skill layout.

These package directories are generated. Never hand-edit them.
The marketplace lists `engineering`, the existing root plugin, and `shunt`.
Keep bundled script paths relative to the installed skill. In Claude Code skill instructions, use `${CLAUDE_SKILL_DIR}`.

The mirror is flat and keyed by skill name, because that is the layout both dot-trees expect; buckets exist only in the source tree. `deprecated/` and `in-progress/` are never mirrored, matching what `link-skills.sh` already skips. Two skills sharing a name across buckets abort the sync rather than silently dropping one.

```shell
sh scripts/sync-agents.sh
```

Three modes. With no argument it regenerates from the working tree. `--staged` regenerates from the git index and stages the result, which is what the pre-commit hook runs, so committed copies always match committed source. `--check` verifies and exits non-zero on drift without writing, which is what CI runs in `agents-sync-check.yml`.

Enable the hook once per clone, since `core.hooksPath` is local config and cannot be committed:

```shell
sh scripts/setup-hooks.sh
```

## Hooks

The plugin's hooks live in `hooks/hooks.json` at the repo root. Claude Code discovers that file on its own, so do not reference it from `plugin.json`.

A hook here runs in every project belonging to everyone who installs the plugin. It must therefore cost nothing when it has nothing to say:

- Decide whether the hook applies with a cheap shell test, before starting an interpreter.
- Exit 0 with empty stdout when it does not apply. Empty stdout adds no context.
- Never break a session. Exit 0 when a tool is missing and when input is malformed.
- Keep the emitted context to a few lines, whatever the project holds.

Keep a hook's script inside the skill that owns it and point at it with `${CLAUDE_PLUGIN_ROOT}`. See [hooks/hooks.json](./hooks/hooks.json) for the one hook that ships today.

## Scripts

- `bash scripts/link-skills.sh` — symlink all active skills into `~/.claude/skills` for local dev.
- `bash scripts/list-skills.sh` — print all `SKILL.md` paths.
- `node scripts/sync-plugin-version.mjs` — copy the `package.json` version into both skills plugin manifests; `--check` verifies without writing.
- `sh scripts/sync-agents.sh` — generate agent mirrors and the engineering package; `--staged` for the hook, `--check` for CI.
- `sh scripts/setup-hooks.sh` — point git at `.githooks` so the pre-commit mirror runs. Once per clone.
