# Per-repo config: `decisions/decision-log.json`

The skill's defaults fit a small repo with one contributor. Larger repos adjust behaviour with one JSON file that sits **next to** the log dir (not inside it, so an append-only log stays untouched):

```
decisions/
├── decision-log.json   # this file (optional)
└── log/
```

`scripts/validate.mjs`, `scripts/new-decision.mjs` and `scripts/audit-manifest.mjs` all read it. Pass `--config <path>` to use another location. Every key is optional; unknown keys are an error.

## Keys

| Key | Default | Meaning |
| --- | --- | --- |
| `statusMode` | `"stored"` | `"stored"`: `status` is a required frontmatter field the author maintains (`active` / `superseded` / `reversed`). `"derived"`: status is computed from the `supersedes` graph and never written; a legacy `status:` line must agree with the graph or be deleted. |
| `appendOnly` | `false` | `true`: files under the log dir are never edited, renamed or deleted; a decision is retired only by a new entry with `supersedes`. Requires `statusMode: "derived"`. Enforced in git by `scripts/check-append-only.sh`. |
| `buckets` | `null` | Optional classification field. When set to a list of kebab-case names, every entry's `bucket` must be one of them. `null` disables the field. |
| `bucketRequiredFrom` | `null` | With `buckets` set: `bucket` is required only for entries dated on or after this `YYYY-MM-DD`. Older entries stay valid without one. `null` = required for all. |
| `linearPattern` | `"^[A-Z][A-Z0-9]*-\\d+$"` | Regex the `linear` field must match when non-empty. Narrow it to your tracker prefix, e.g. `"^ABC-\\d+$"`. |
| `maxSlugWords` | `6` | Filename slug limit. Error above it. `new-decision.mjs` refuses a longer slug and asks for `--slug`. |
| `maxDecisionSentences` | `2` | `## Decision` length. Warning above it (does not fail the run). |
| `ratchetFrom` | `null` | Length rules and duplicate-id detection bind only entries dated on or after this `YYYY-MM-DD`. Use it to adopt the rules in a repo with a legacy log. `null` = all entries. |
| `templateNote` | `null` | A house writing rule `new-decision.mjs` inserts as a `DRAFTING NOTE` HTML comment under the title. It guides the author while the stubs are filled in; delete it with the stubs, since it is not part of the record. |

## Examples

**Small repo, defaults.** No file needed.

**Repo with a legacy log and a tracker prefix:**

```json
{
  "linearPattern": "^ABC-\\d+$",
  "ratchetFrom": "2026-10-01"
}
```

Entries dated before 2026-10-01 keep their long slugs and shared ids; new entries must comply.

**Append-only repo with a classification field:**

```json
{
  "statusMode": "derived",
  "appendOnly": true,
  "buckets": ["physics", "protocol", "design", "process", "scar", "unclear"],
  "bucketRequiredFrom": "2026-08-27",
  "ratchetFrom": "2026-10-01",
  "templateNote": "Write in Simplified Technical English. Quote sources exactly as they read."
}
```

Wire both checks into CI:

```bash
node <skill-dir>/scripts/validate.mjs --quiet
bash <skill-dir>/scripts/check-append-only.sh
```

## How the modes differ in the workflow

| Step | `stored` | `derived` / `appendOnly` |
| --- | --- | --- |
| New entry | `status: active` written by the scaffolder | no `status` line |
| Supersede | new entry carries `supersedes: <old>`; **edit the old file** to `status: superseded` | new entry carries `supersedes: <old>`; **old file untouched** |
| Reverse with no successor | edit old file to `status: reversed` | new entry whose Decision says the earlier one is withdrawn, with `supersedes: <old>` |
| Clarify | append `## Clarification YYYY-MM-DD` to the old file | new entry whose Context cites the old id; no `supersedes` |

## `supersedes` references

Either form works in both modes:

- bare id: `supersedes: 2026-05-17-03`
- id-slug stem: `supersedes: 2026-05-17-03-cloudflare-not-route53`
- inline list: `supersedes: [2026-05-17-03, 2026-06-01-02-old-name]`

A bare id that two files share is rejected as ambiguous; use the stem. Block lists (`- item` lines) are not supported by the frontmatter parser.
