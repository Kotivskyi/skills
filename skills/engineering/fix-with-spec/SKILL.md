---
name: fix-with-spec
description: >-
  Fix a bug or adjust existing behavior in code AND keep its OpenSpec capability spec
  consistent — fast, in ANY OpenSpec-managed repo, under WHATEVER schema that repo uses.
  Use this whenever the user types /fix-with-spec, or makes the two-part "fix X and keep
  the spec / scenario / capability in sync" request: a wrong status code, an off-by-one or
  validation bug, an auth guard accepting the wrong tokens, a flaky health check, a UI
  misbehaving — paired with keeping OpenSpec consistent. Also covers "fix the code; does
  the spec need to change?" and "patch this and update the openspec change/delta". The
  skill's one real job is the spec-consistency decision: most quick fixes need NO spec
  change (just fix the code), some need a surgical delta on an active change, a few touch
  an archived spec and need a new change (usually minimal, occasionally a full audited
  one). It discovers the repo's schemas with the OpenSpec CLI instead of assuming any
  fixed schema, so it works the same whether the project runs the default `spec-driven`
  schema or a bespoke one. Always the lightest touch that fits — it never spawns OpenSpec
  ceremony that isn't warranted, because fix time matters. Gates every fix behind a lean,
  approvable plan (the change + the spec-consistency decision) in plan mode before
  editing. Hard-depends on the project's `diagnosing-bugs`, `tdd`, and
  `/opsx:propose` skills — invoke them, don't reimplement them. NOT for pure diagnosis
  with no code change (use diagnosing-bugs alone), and NOT for net-new capabilities or
  large contract changes (use /opsx:propose).
---

# /fix-with-spec — plan, approve, then keep OpenSpec specs consistent, fast

Your one job: make the fix and leave the capability's spec **consistent** with it, with
the **least ceremony that fits the risk** — and **never touch code or specs until the
user has approved a plan**. **Fix time matters — do not spawn OpenSpec ceremony you don't
need.** Most fixes need no spec change at all.

This skill is **repo-agnostic**: it does not assume a particular OpenSpec schema, area
layout, or sync script. It discovers all of that from the OpenSpec CLI at runtime
(`openspec schemas`, `openspec list --specs`, `openspec instructions …`). That is what
lets the same skill serve a project on the stock `spec-driven` schema and one on a
bespoke, area-aware schema with a custom sync helper.

The invariant that constrains you in **every** OpenSpec repo: the applied specs under
`openspec/specs/**` are a **generated mirror of change deltas** — never hand-edit them. A
spec changes only by putting a delta inside a *change* and running that schema's apply
step (plain `openspec archive`, or a schema-bundled sync helper + archive — the schema's
`openspec schemas` description tells you which; see below).

## Hard dependencies — invoke, don't rebuild

This skill orchestrates three skills. When the flow reaches their job, **invoke them**; do
not re-implement their logic inline.

- **`diagnosing-bugs`** — reproduce-and-locate for anything whose root cause isn't obvious.
  Ships in this same plugin, so it travels with `/fix-with-spec` wherever it's installed.
- **`tdd`** — the red→green discipline for the actual fix. Also bundled in this plugin.
- **`/opsx:propose`** — the OpenSpec project's own proposal workflow, for net-new
  capabilities or broad contract changes. This one is **not** bundled — it belongs to the
  OpenSpec-managed repo. When the spec-path decision lands here, you **stop and hand off**
  to it rather than treating the work as a fix.

If one of these isn't present in the session, say so in the plan instead of silently doing
its job by hand — a missing skill changes the risk picture the user is approving. (The
likely gap is `/opsx:propose`, since the bundled two travel with this skill.)

## The gate: plan before you touch code

**Every run passes through this gate before any edit — even a one-liner.** The plan is
lean (two lines), so a trivial fix costs one approval, not ceremony. The point is to get
sign-off on the skill's one real judgement call — the spec path — *before* anything
changes.

1. **Investigate read-only.** Plan mode forbids edits — lean into that. Reproduce or
   locate the bug (running existing tests is fine; reach for `diagnosing-bugs` if the
   cause is unclear), locate the capability (below), and make the spec-path decision
   (below). No test-*writing* yet — authoring a repro test is an edit, so it waits for
   approval.

2. **Present the lean plan and wait for approval.** Use plan mode's native approval gate:
   write the plan, then call `ExitPlanMode` (enter plan mode first with `EnterPlanMode` if
   you aren't already in it). Keep it to two lines:
   ```
   Fix:  <what changes + file>
   Spec: <No change | surgical delta on <active-change> | minimal/full new change via <schema>> → <area-or-cap>
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
| **Yes** | archived only — fix is small / low-risk / obvious | **Minimal new change** *(default)* — scaffold a change on the right schema, author **only the delta**, apply, archive. |
| **Yes** | archived only — **+ an escalation trigger** | **Full new change** — run the schema's artifact flow to persist the audit trail (proportionately). |
| **Net-new capability / broad contract change** | — | **Stop → `/opsx:propose`** — that's not a fix; say so in the plan instead of editing. |

**Answer the spec-change question *before* the ownership question — and don't pollute an
unrelated active change.** The "active change → surgical delta" row assumes the active
change is the *natural home* for your fix. Often it isn't: a change can own a capability's
spec while being about something entirely different (an `increment/archive` change that
happens to own `pasture-management`), or the capability may have **no applied spec yet** —
it exists only as that in-flight change's delta. Before reaching for surgical-delta,
confirm your fix genuinely sits within that change's scope. If it doesn't, grafting your
scenario onto it pollutes someone's in-flight work — prefer **No change** (when no spec
actually asserts the behavior you're fixing), or defer a standalone change until the
in-flight one lands. The point of asking "does a spec *say* this?" first is exactly to
avoid being railroaded into editing the wrong change.

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

## Discovering schemas and locating the capability (quick, generic)

Don't assume schema names or a particular spec layout — ask the CLI:

- **Schemas available + the project default:** `openspec schemas` lists every schema with
  a description (which is bug-oriented, which is feature/behavior-oriented, which needs a
  bundled sync helper). The project default is the `schema:` key in
  `openspec/config.yaml` (used when you omit `--schema`).
- **Capabilities + their specs:** `openspec list --specs`, then `openspec spec show <id>`
  to read the applied spec. If the repo keeps an area map (e.g.
  `openspec/specs/README.md`), use it as a shortcut — but treat it as a hint, not a
  requirement; the CLI is the source of truth.
- **Active changes (ownership):** `openspec list` shows active changes. A change owns a
  capability if it carries a `specs/.../<cap>/spec.md` delta for it (read its
  `.openspec.yaml` for the schema); then it's the **surgical-delta** path. Otherwise only
  the archived mirror owns it → **new change** path.

**Routing a new change to a schema:** match the fix to the schema whose description fits —
a bug-oriented schema if the repo has one, otherwise the project default for an intended
behavior change. Pick from `openspec schemas` output; never invent a schema name. When in
doubt, the project default (`openspec/config.yaml`) is the safe choice.

## After approval: implement

1. **Fix the code.** Prove it works with a proportionate red→green check via **`tdd`**
   (a failing→passing test or repro for anything non-trivial), reaching for
   **`diagnosing-bugs`** when the cause was unclear. Don't over-test a one-liner.

2. **Execute the approved spec path.** No change → done. Surgical delta → patch the active
   change in place. New change → scaffold and author the delta (below).

## New change paths (only when an archived spec must change)

Scaffold on the routed schema. The capability's area/path is carried by the delta **file
path**, not a flag — so don't pass area flags the CLI rejects for a repo-local change:
```
openspec new change fix-<slug> --schema <schema-from-`openspec schemas`>
```
(Omit `--schema` to take the project default from `config.yaml`.) This records the schema
as provenance in the change's `.openspec.yaml`.

**Minimal (default):** author **only the delta** — the `specs/.../<cap>/spec.md` change.
Do NOT run the schema's other artifacts (no `brainstorm.md` / `design.md` / `proposal.md`
/ `tasks.md` / `reproduce.md` / `retrospective.md`). If you catch yourself writing a
`brainstorm.md` for a small fix, stop.

**Full (only on an escalation trigger):** run the schema's real artifact flow,
proportionately. Don't guess the artifact list — ask the schema:
`openspec status --change <change>` shows what's required, and
`openspec instructions <artifact> --change <change>` prints how to author each one. Author
the artifacts that carry real signal (e.g. an executed reproduce/test record for a
regression, a design note for a migration); skip artifacts that would say nothing. Even
"full" stays proportionate.

**Apply + archive (both paths).** First validate the delta — note the `--type change`,
without it `openspec validate <name>` resolves to a *spec* and errors `Unknown item`:
```
openspec validate <change> --type change          # delta is well-formed
```
Then apply. **Pick the mechanism from the schema, not from `openspec instructions apply`** —
for a minimal fix that command just reports `Blocked: missing artifacts …` and points at
`openspec-continue-change`; it does *not* print the sync/archive recipe. Read the schema's
description in `openspec schemas` (it says whether the schema mirrors nested specs via a
bundled helper) and/or check for `openspec/schemas/<schema>/bin/` — that tells you which of
these two verified recipes applies:

- **Flat schema** (e.g. stock `spec-driven`): `openspec archive -y <change>` — archive
  applies the `specs/<cap>/spec.md` delta straight into `openspec/specs/**`.
- **Area-aware / nested schema with a bundled sync helper** (e.g. `superpowers-workspace`):
  run the helper first, then archive skipping specs —
  `node openspec/schemas/<schema>/bin/sync-nested-specs.mjs <change>` then
  `openspec archive -y --skip-specs <change>`.

Both archive forms apply the delta even though you deliberately skipped the schema's other
artifacts — that's the minimal path working as intended, not a workaround. (These two
recipes are verified against `spec-driven` and `superpowers-workspace`.)

## Rules that keep it honest (and fast)

- **Plan first, always.** No code or spec edit before the user approves the plan via
  `ExitPlanMode`. The plan stays lean (two lines) so this is one click, never ceremony.
- **Never hand-edit `openspec/specs/**`** — it's a generated mirror; deltas flow through a
  change plus the schema's apply step.
- **Surgical only**: targeted delta ops (`ADDED` / `MODIFIED` (full updated content) /
  `REMOVED` (with **Reason** + **Migration**) / `RENAMED`), scenarios at the depth the
  schema expects (commonly `#### Scenario:`, four hashtags). Never regenerate a whole spec.
- **Ceremony scales with risk, downward by default.** Most fixes → no spec change; a spec
  change → a delta; a new change → minimal; full only on a trigger; `/opsx:propose` only
  for genuinely large work.
- **Discover, don't assume.** Schema names, areas, apply steps, and the sync helper all
  come from the CLI — so this skill behaves correctly in any OpenSpec repo, not one
  specific project.

## Delegates to (hard deps + helpers)
`diagnosing-bugs` and `tdd` (the red→green), `/opsx:propose` (large work only — a
hard handoff, not a fix), the OpenSpec CLI (`schemas` / `list` / `validate` /
`instructions` / `archive` and any schema-bundled sync helper named in `openspec schemas`), and
`finishing-a-development-branch` for the PR when one is wanted.
