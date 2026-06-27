---
name: fix
description: >-
  Fix a bug or adjust existing behavior in code AND keep its OpenSpec capability spec
  consistent — fast. Use whenever the user types /fix, or makes the two-part "fix X and
  keep the spec / scenario / capability in sync" request: a wrong status code, off-by-one
  or validation logic, an auth guard accepting or rejecting the wrong tokens, a UI not
  behaving, a health check racing — paired with keeping openspec consistent. Also covers
  "fix the code; does the spec need to change?". The skill's one job is the
  spec-consistency decision: most quick fixes need NO spec change (just fix the code),
  some need a surgical delta on an active change, a few touch an archived spec and need a
  new change (usually minimal, occasionally a full audited one). Always the lightest touch
  that fits — never spawning heavy OpenSpec ceremony that isn't warranted, because fix
  time matters. Gates every fix behind a lean, approvable plan (the change + the
  spec-consistency decision) in plan mode before editing. NOT for pure diagnosis with no
  code change (use diagnosing-bugs), and NOT for net-new capabilities or large contract
  changes (use /opsx:propose).
---

# /fix — plan, approve, then keep specs consistent, fast

Your one job: make the fix and leave the capability's spec **consistent** with it, with
the **least ceremony that fits the risk** — and **never touch code or specs until the
user has approved a plan**. **Fix time matters — do not spawn OpenSpec ceremony you don't
need.** Most fixes need no spec change at all.

The invariant that constrains you: `openspec/specs/<area>/<capability>/spec.md` is a
**generated mirror** — never hand-edit it. A spec changes only by putting a delta in a
*change* and running the sync helper.

## The gate: plan before you touch code

**Every `/fix` passes through this gate before any edit — even a one-liner.** The plan is
lean (two lines), so a trivial fix costs one approval, not ceremony. The point is to get
sign-off on the skill's one real judgement call — the spec path — *before* anything
changes.

1. **Investigate read-only.** Plan mode forbids edits — lean into that. Reproduce or
   locate the bug (running existing tests is fine), locate the capability (below), and
   make the spec-path decision (below). No test-*writing* yet — authoring a repro test is
   an edit, so it waits for approval.

2. **Present the lean plan and wait for approval.** Use plan mode's native approval gate:
   write the plan to the plan file, then call `ExitPlanMode` (enter plan mode first with
   `EnterPlanMode` if you aren't already in it). Keep it to two lines:
   ```
   Fix:  <what changes + file>
   Spec: <No change | surgical delta on <active-change> | minimal/full new change> → <area/cap>
   ```
   `ExitPlanMode` *is* the approval — don't ask "is this plan OK?" some other way.

3. **On approval, implement** (below). If the user redirects, fold it in and re-present
   the plan; don't start editing until they approve.

## The spec-path decision

This is what you settle in step 1 and what fills the plan's **Spec:** line. State your
answer + the capability; proceed unless it's genuinely ambiguous.

**Does this fix change what a spec SAYS** (a capability's documented behavior or contract)?

| Spec change? | Who owns the capability | Plan's Spec line → action |
|---|---|---|
| **No** | — | **No change** — most fixes land here; don't manufacture spec work. |
| **Yes** | an active change | **Surgical delta** — patch that change's delta + `tasks.md` in place; it carries itself forward (you don't archive it; its own apply implements). |
| **Yes** | archived only — fix is small / low-risk / obvious | **Minimal new change** *(default)* — schema by type, author **only the delta**, sync, archive. |
| **Yes** | archived only — **+ an escalation trigger** | **Full new change** — run the schema's flow to persist the audit trail (proportionately). |
| **Net-new capability / broad contract change** | — | **Stop → `/opsx:propose`** — that's not a fix; say so in the plan instead of editing. |

**Escalate minimal → full only if a trigger applies (otherwise stay minimal):**
- a real **bug / regression / incident** where persisting reproduce→test evidence + a
  named regression test matters (security, data integrity, a prod incident, a
  hard-to-reproduce flake);
- the fix needs a **migration or rollback** plan;
- it **spans multiple capabilities** or has non-obvious design trade-offs worth recording;
- **root cause is uncertain** and reproduce-before-fix discipline de-risks it.

Default is **minimal**. Escalating without a trigger re-introduces the ceremony cost this
skill exists to avoid; minimal still *proves* the fix (implement step 1) — it just
doesn't persist the proof as artifacts.

## Locating the capability (quick)

Area map is `openspec/specs/README.md`; each area README lists its capabilities. Match the
fix to a capability, then check ownership: an active change under
`openspec/changes/<n>/` (it has a `specs/<area>/<cap>/` folder; read its `.openspec.yaml`
for the schema) owns it → active path; otherwise only the archived mirror owns it.

## After approval: implement

1. **Fix the code.** Prove it works with a proportionate red→green check (a
   failing→passing test or repro for anything non-trivial; the repo is TDD-default).
   Reuse `diagnosing-bugs` / `tdd-loop`. Don't over-test a one-liner.

2. **Execute the approved spec path.** No change → done. Surgical delta → patch the active
   change in place. New change → scaffold and author the delta (paths below).

## New change paths (only when an archived spec must change)

Scaffold either way (the area is carried by the delta **path**, not a flag — do **not**
pass `--areas`, which is rejected for a repo-local change):
```
openspec new change fix-<slug> --schema <bugfix-workflow|superpowers-workspace>
```
Route by type — bug → `bugfix-workflow`, intended behavior change → `superpowers-workspace`.
This only records the schema as provenance in `.openspec.yaml`.

**Minimal (default):** author **only the delta** at `specs/<area>/<cap>/spec.md`. Do NOT
run the schema's artifact flow — no `brainstorm.md`/`design.md`/`plan.md`/`report.md`/
`reproduce.md`/`retrospective.md`. If you catch yourself writing `brainstorm.md` for a
small fix, stop.

**Full (only on an escalation trigger):** run the schema's real flow, proportionately —
- `bugfix-workflow` → persist `reproduce.md` (the RED evidence from implement step 1) +
  `test.md` (`**Result**: PASS`) + `verify.md`; a `retrospective.md` only if there are
  real learnings. Skip `brainstorm.md`/`design.md` unless the root cause genuinely needs them.
- `superpowers-workspace` → `proposal.md` + `design.md` (decisions / trade-offs /
  migration) + the delta + `tasks.md`.
Even "full" stays proportionate — don't write artifacts that say nothing.

**Sync + archive (both paths):**
```
node openspec/schemas/superpowers-workspace/bin/sync-nested-specs.mjs <change> --check   # validate
node openspec/schemas/superpowers-workspace/bin/sync-nested-specs.mjs <change>           # mirror delta -> openspec/specs/**
openspec archive -y --skip-specs <change>
```

## Rules that keep it honest (and fast)

- **Plan first, always.** No code or spec edit before the user approves the plan via
  `ExitPlanMode`. The plan stays lean (two lines) so this is one click, never ceremony.
- **Never hand-edit `openspec/specs/**`** — it's generated; deltas flow through a change
  plus the sync helper.
- **Surgical only**: targeted delta ops (`ADDED` / `MODIFIED` (full updated content) /
  `REMOVED` (with **Reason** + **Migration**) / `RENAMED`), scenarios at **exactly four
  hashtags** (`#### Scenario:`). Never regenerate a whole spec.
- **Ceremony scales with risk, downward by default.** Most fixes → no spec change; a spec
  change → a delta; a new change → minimal; full only on a trigger; `/opsx:propose` only
  for genuinely large work.

## Delegates to (reuse, don't rebuild)
`diagnosing-bugs` / `tdd-loop` (the red→green), the `sync-nested-specs.mjs` helper,
`openspec archive`, `/opsx:propose` (large work only), `superpowers:finishing-a-development-branch` (PR).
