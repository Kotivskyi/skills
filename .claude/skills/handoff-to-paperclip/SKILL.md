---
name: handoff-to-paperclip
description: >
  Hand off the task you are working on in this interactive session to the Paperclip
  agent team so an autonomous agent (the CTO by default) continues it end-to-end —
  isolated git worktree, spec-driven-development continuation, and a real PR to the
  branch you choose. Use whenever the user wants to delegate, hand off, or "pass this
  to Paperclip / the CTO / the agents", let the team take over the current work,
  offload an in-progress OpenSpec change, or says things like "hand this off",
  "let the agents finish it", "delegate to CTO", or "ship this through Paperclip" —
  even if they don't name Paperclip explicitly but clearly want this session's work
  continued by the company.
---

# Hand off to Paperclip

Package the work from **this** conversation and hand it to Paperclip's agent team.
By default the task is assigned to the **CTO**, who owns spec-driven delivery and
drives the change through to a PR. You prepare a clean, isolated worktree and a rich
context document so the agent can pick up exactly where you left off.

This skill orchestrates other skills and a live Paperclip instance. It is
**interactive and gated**: you never create the task until the user approves the
plan. Hard dependency: the **`handoff`** skill (writes the context doc). It also
leans on the **`paperclip`** skill's API conventions and the repo's OpenSpec
spec-driven-development (SDD) workflow.

## The flow at a glance

```
 you (this session)                          Paperclip (CTO agent)
 ─────────────────────                       ──────────────────────
 0. commit / clean tree  ──┐
 1. target branch?         │  pre-flight
 2. clean worktree         │  (.worktrees/<slug>, off target)
    .worktrees/<slug>    ──┘
 3. handoff skill ─────────►  HANDOFF.md (context for the agent)
 4. classify SDD state ────►  case A / B / C  (see below)
 5. SUMMARY + approval  ◄──►  user approves or edits   ⟵ STOP here
 6. create task ───────────►  POST issue, assignee = CTO
                                     │
                                     ▼
                       continues SDD ─► implement ─► verify
                       ─► QA Gate ─► G2 ─► PR to your target branch
                                     │
                                     ▼
                            board approval → merge
```

Walk the phases in order. Do not skip the approval gate (phase 5).

---

## Phase 0 — Pre-flight: commit the current state

The agent picks up from committed history, so loose changes would be lost.

1. Run `git status --porcelain`. If anything is uncommitted (staged, unstaged, or
   untracked that matters), **stop and ask the user to commit** before continuing —
   this is their decision, not yours. Offer to stage and commit for them, but let
   them confirm the message and scope.
2. Re-check until the tree is clean (or the user explicitly says the leftover files
   are intentional and should be ignored). Record the current branch and HEAD sha —
   you will report them in the summary.

Do not weaken or bypass any `rm -rf`-style guardrails to "clean" a tree; route around
with git (`git stash`, `git worktree remove`, etc.) instead.

## Phase 1 — Clarify the target branch

Ask the user where the finished work should land: **the current branch** or **`main`**.
This choice does two things:

- It is the **base** the new worktree branches from.
- It is the **PR target** the CTO opens the pull request against.

Per this user's decision for handed-off tasks, the CTO **opens a real PR** against the
chosen branch (this is an explicit, user-requested override of the repo's
merge-direct/no-PR default — note it in the task so the CTO knows a PR is intended and
needs a GitHub remote). The CTO still **stops at G2 for board approval** and must not
self-merge without a verifiable board-approval record — never bypass that gate.

## Phase 2 — Create a clean worktree

Give the agent an isolated place to work so it never disturbs the user's checkout.

1. Pick a short kebab-case **slug** for the task (derive it from the active OpenSpec
   change name, or from the task title — e.g. `harden-g2-gate`).
2. Ensure `.worktrees/` is ignored so worktree contents never get committed to the
   parent repo:
   - If `.gitignore` lacks a `.worktrees/` line, append it (and commit that one-line
     change, since phase 0 left the tree clean).
3. Create the worktree on a fresh branch, based on the chosen target:
   ```bash
   # target = current branch:
   git worktree add .worktrees/<slug> -b handoff/<slug>
   # target = main:
   git worktree add .worktrees/<slug> -b handoff/<slug> main
   ```
   Use the absolute path to `.worktrees/<slug>` when you reference it later — the
   Paperclip agent may resolve paths from a different cwd.

To remove a worktree later, use `git worktree remove .worktrees/<slug>` — never
`rm -rf` it.

## Phase 3 — Gather context with the `handoff` skill

Invoke the **`handoff`** skill to compact this conversation into a handoff document.
Pass a short description of what the next session is for (e.g. "Continue implementing
OpenSpec change `<name>` from the Spec Review Gate through to a PR").

Then make the doc travel with the work:

- Copy it into the worktree root as `HANDOFF.md` (it lives on the `handoff/<slug>`
  branch but does not need to be committed — leave it untracked or add it to the
  worktree's local ignore).
- Keep the original temp path too; you will both reference it in the task and attach
  it to the issue.

The handoff doc's "suggested skills" section should point the agent at the right SDD
skills for the case you classify next.

## Phase 4 — Classify the SDD state (the core decision)

Continuing a spec-driven change is the primary use case. Figure out which of three
cases applies, because it tells the CTO *where to start*.

Detect the active change:
```bash
openspec list            # active changes (excludes archived)
ls openspec/changes/     # fallback: any dir other than `archive/`
```

| Case | Condition | What the CTO should do |
|------|-----------|------------------------|
| **A — no spec yet** | No active change, and the task has no spec started | **Start** the SDD workflow from the top: brainstorm → proposal → design → specs → tasks → plan → Spec Review Gate. (`openspec-propose`) |
| **B — spec not yet review-passed** | An active change exists but the **Spec Review Gate (formerly G1) is NOT passed** — no `review.html` artifact on the change and the user has not confirmed a review | **Continue** the SDD workflow up to the gate: finish/repair the proposal & specs, get Architect spec review, reach the Spec Review Gate. Do **not** start implementation yet. |
| **C — review passed** | The user confirmed the review in this chat, **or** a `review.html` artifact is present for the change | Count the **G1 / Spec Review Gate as passed** and **continue with implementation**: apply tasks → verify → QA Gate → G2 → **open the PR** to the chosen branch. (`openspec-apply-change`, then verify/archive) |

How to check for case C evidence:
```bash
find openspec/changes/<change> -iname 'review.html'   # artifact present → gate passed
```
Also treat an explicit user statement in this conversation ("I reviewed it, it's
good", "review's done") as passing G1 — say in the summary which signal you used.

When unsure between B and C, **default to B** (safer: the agent re-confirms the gate
rather than building on an unreviewed spec) and say so in the summary so the user can
override.

## Phase 5 — Summarize and get approval  ⟵ STOP

Before creating anything in Paperclip, show the user a **short** summary so they can
approve or modify. Keep it tight. Include:

- **Task title** and **assignee** (CTO by default).
- **Target branch** + that a **real PR** will be opened against it.
- **Worktree**: `.worktrees/<slug>` on branch `handoff/<slug>`, based on `<target>`.
- **SDD case** (A/B/C) and the one-line "what the CTO starts with", plus which signal
  you used to classify it.
- The handoff doc path.

Render the flow compactly (reuse the diagram above, trimmed to this task). Then **wait
for explicit approval.** If the user edits anything (different branch, different
assignee, reclassify the SDD case), apply it and re-summarize.

Example summary skeleton:
```
Handing off → CTO
  Task   : Continue change `harden-g2-gate` through to PR
  Branch : main  (real PR will target main)
  Tree   : .worktrees/harden-g2-gate  (branch handoff/harden-g2-gate, off main)
  SDD    : Case C — G1 passed (review.html found) → implement → verify → QA → G2 → PR
  Context: /tmp/handoff-harden-g2-gate.md (attached to the task)
Approve? (yes / edit …)
```

## Phase 6 — Create the Paperclip task

Only after approval. Use the bundled helper so company + CTO resolution stays
deterministic (it resolves the assignee by **role**, so no hard-coded ids):

```bash
python3 skills/engineering/handoff-to-paperclip/scripts/handoff_task.py \
  --title "<task title>" \
  --body-file <path-to-task-body.md> \
  --assignee-role cto \
  --priority high \
  --attach /tmp/handoff-<slug>.md \
  --dry-run            # preview first, then re-run without --dry-run
```

Always **dry-run first**, show the resolved company/assignee/payload, then run for
real. The helper prints the created task identifier (e.g. `PAS-87`) and a final JSON
line with `issueId`/`identifier` you can relay to the user.

Compose the **task body** (the `--body-file`) so the CTO can act without re-reading
this chat. Include, as markdown:

1. **Goal** — one or two sentences on the outcome.
2. **Working directory** — the absolute worktree path and branch
   (`handoff/<slug>`), and that history is committed & clean.
3. **Target & PR** — the chosen branch; "**open a real PR** against it (explicit
   request); stop at G2 for board approval — do **not** self-merge without a
   verifiable board-approval record."
4. **SDD starting point** — the case (A/B/C) and the exact next step, naming the skill
   to use (`openspec-propose` / continue specs+Architect review / `openspec-apply-change`).
5. **Context** — reference `HANDOFF.md` in the worktree and note the attached handoff
   doc; link any active change by name.
6. **Definition of done** — change implemented, `verify.md` passing, `retrospective.md`
   present, specs synced, QA Gate `pass`, change archived, PR opened to `<target>`
   carrying the complete archived cycle, board approval recorded before any merge.

If the API returns 401/403, the instance needs a board API key — ask the user and pass
it via `--api-key` / `PAPERCLIP_API_KEY`.

## Phase 7 — Confirm and report

Tell the user: the created task identifier + assignee, the worktree path/branch, the
target branch, and the SDD starting point. Remind them the CTO runs on **heartbeats**,
so pickup is not instant; they can watch the task in Paperclip. Leave the worktree in
place for the agent.

---

## Defaults & overrides

- **Assignee:** CTO. Override only if the user names a different role/agent
  (`--assignee-role <role>`); the helper resolves by role then by name.
- **Priority:** `high`. Adjust if the user signals urgency or that it can wait.
- **Base URL:** `http://localhost:3100` (Paperclip Desktop) unless `PAPERCLIP_API_URL`
  is set or the user gives another.
- **Mono-branch repos:** the real-PR behavior here is a deliberate, user-chosen
  override for handed-off tasks. If a future user wants the repo's merge-direct
  default instead, say so in the task body and drop the PR instruction — everything
  else (worktree, SDD continuation, gates) is unchanged.
