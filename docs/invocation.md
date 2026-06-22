# Model-invoked vs user-invoked

Every `SKILL.md` in this repo is a skill. The one axis that splits them is **invocation** — who can reach it:

- **User-invoked** — reachable **only by the human typing its name**. Set `disable-model-invocation: true` in the frontmatter. The `description` is **human-facing**: a one-line summary read by a person browsing slash-commands. Strip trigger phrases ("Use when the user says…").
- **Model-invoked** — reachable by **model or user**. The default: omit `disable-model-invocation`. The `description` is **model-facing** and keeps rich trigger phrasing ("Use when the user wants…, mentions…, asks for…") so auto-invocation fires.

Because a user-invoked skill has no model-facing description, nothing but the human can reach it — no other skill can fire it automatically. A user-invoked skill may invoke model-invoked skills by name, but it can never reach another user-invoked skill.

## Dependencies between skills

Express dependencies as **`/skill`-style prose invocation** in the skill body ("Run the `/plan` skill"), not cross-file paths. Shared reference material (scripts, helpers) lives inside the skill directory that owns it.

## Bundled scripts

Skills that rely on a helper script keep it under `scripts/` inside the skill directory. When loaded as a plugin, reference the script via `${CLAUDE_PLUGIN_ROOT}/skills/<bucket>/<skill>/scripts/<file>`. When linked locally via `link-skills.sh`, the symlink target resolves to the same path.
