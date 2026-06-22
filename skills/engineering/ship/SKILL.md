---
name: ship
description: >
  Run a pre-merge/pre-deploy checklist for a branch or PR before it goes to
  production. Verifies the PR is green, reviewed, and safe to merge; checks
  for missing migrations, env vars, changelog entries, or risky flag changes;
  and produces a clear go/no-go with any blockers spelled out.
---

# Ship

Run a pre-merge/pre-deploy gate on the current branch or a specified PR and
produce a go / no-go verdict with an explicit blocker list.

## Inputs

- **PR number** (optional): detected from the current branch if omitted.
- **Environment** (optional): `staging` or `production` — affects which
  checks are required. Defaults to `production`.

## Steps

### 1. Identify the PR and branch

```bash
gh pr view --json number,url,headRefName,headRefOid,reviewDecision,mergeStateStatus,isDraft
```

Stop immediately if:
- no PR exists for the current branch
- the PR is a draft
- `mergeStateStatus` is `DIRTY` (merge conflict)

### 2. Check CI status

```bash
gh pr checks
```

All required checks must be green. Treat any failing or pending required check
as a hard blocker. Pending optional checks are a soft warning only.

### 3. Check review state

```bash
gh pr view --json reviewDecision,reviews
```

- `APPROVED` → pass
- `REVIEW_REQUIRED` or `CHANGES_REQUESTED` → hard blocker; name the reviewer

### 4. Scan the diff for risky patterns

```bash
gh pr diff
```

Look for:

| Pattern | Risk | Action |
|---|---|---|
| New DB schema / model changes | Missing migration | Check migration file exists and is committed |
| New env vars referenced in code | Missing config | Confirm var is documented / added to infra config |
| Feature flag additions or removals | State divergence | Note flag name for ops awareness |
| Secrets or credentials in diff | Security | Hard blocker — flag immediately |
| Dependency version bumps | Breaking changes | Spot-check changelog / release notes |

### 5. Changelog / version bump

If the repo has a `CHANGELOG.md`, `CHANGELOG`, or a version field in
`package.json` / `pyproject.toml` / `Cargo.toml`, verify it was updated when
the PR touches user-facing behaviour. A missing entry is a soft warning, not a
hard blocker, unless the project's `CONTRIBUTING.md` requires it.

### 6. Produce the verdict

**GO** — all hard checks pass. List any soft warnings the team should be aware
of after merge.

**NO-GO** — one or more hard blockers. For each:

- what is blocked and why
- the specific action needed to unblock it
- who should act (engineer, reviewer, ops)

End with the PR URL regardless of verdict.
