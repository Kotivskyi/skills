#Branching policy: it's monobranch repo. We don't need PR's

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

The patch version is bumped automatically when the PR merges to `main`.

## Removing a skill

Move the directory to `skills/deprecated/` and remove it from `plugin.json` and both `README.md`s.

## Scripts

- `bash scripts/link-skills.sh` — symlink all active skills into `~/.claude/skills` for local dev.
- `bash scripts/list-skills.sh` — print all `SKILL.md` paths.
