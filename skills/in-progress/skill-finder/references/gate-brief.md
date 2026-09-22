# Gates

## Gate 1

Show the Suggestions table from `report.md`. Then ask:

> Pick one suggestion id to verify and build evals for, or say none.

Stop. Do not write to any skill. Do not run `verify-suggestion.mjs` before the user picks.

## Gate 2

Write this brief after `verify-suggestion.mjs` returns `ok` and the harvest is done. Then ask for an explicit yes, and stop.

```markdown
## Gate 2: <id>, <title>

- Kind: <kind>. <kindReason>
- Evidence: <episodes> episodes on <days> days. <one-line summary of the quotes>
- Verify: pointers <checked> of <checked> resolve. Catalog <unchanged | changed: added, removed, changed>. Not covered by a new skill.
- Evals: <counts.positives> should-trigger, <counts.negatives> should-not-trigger, <counts.behavior> behavior cases. Real: <real.total>. Synthetic: <synthetic.total>. Shortfall against the target of <target>: <shortfall.total>.
- Change: <the exact change, below>
- Target: <path>. Origin: <repo | user | plugin>. <For a symlink: "The real file is <real path>.">
- Risks: <for example, a wider description can fire on near-miss prompts>
- Rollback: <see below>

Reply "yes" to apply, or tell me what to change.
```

The exact change for each kind:

- `new-skill`: the name, the description, the trigger phrases, the outline, and the eval folder that `skill-creator` gets.
- `silent-skill`: the old description and the new description, in full.
- `misfiring-skill`: the Learnings line, in full.
- Plugin origin: the staged file path in `<run>/apply-<id>/` and the upstream path.

## Rollback

| Kind | Rollback |
| :--- | :--- |
| `new-skill` | Remove the new skill folder. |
| `silent-skill` | `git checkout -- <SKILL.md> <evals files>` in the repo that owns the skill. |
| `misfiring-skill` | `git checkout -- <SKILL.md> <evals files>` in the repo that owns the skill. |
| Plugin origin | Remove `<run>/apply-<id>/`. Nothing else changed. |

When the skill folder is not in git, copy the files to `<run>/apply-<id>/backup/` before the edit, and give the copy as the rollback.
