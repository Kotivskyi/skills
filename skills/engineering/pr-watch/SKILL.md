---
name: pr-watch
description: >
  Drives a GitHub pull request to a fully green, fully addressed state. Phase A
  gets every check on the latest head SHA green: waits for checks to finish,
  investigates failures, fixes actionable code/test issues, pushes, and repeats.
  Phase B works the review conversations: fetches thread-aware comments,
  auto-resolves the mechanical/low-risk threads (fix, reply, resolve), and
  escalates threads that need a real architecture/design or behavior/scope
  decision to the user instead of guessing — preventing AI drift. Escalates with
  a precise blocker when failures are external, flaky, or not safely fixable. Use
  when a PR still has unsuccessful checks or unresolved review comments after a
  review pass, including after greploop.
---

# PR Watch

Drive a GitHub PR to a fully green, fully addressed state — or exit with a
concrete blocker and a precise list of decisions only the user can make.

This skill has two phases:

- **Phase A — Get checks green.** Repair the CI/status checks for the latest
  head SHA.
- **Phase B — Work the review conversations.** Triage every unresolved review
  thread. Auto-resolve the mechanical and low-risk ones; surface the rest as
  explicit decisions for the user.

Run **Phase A first**, then Phase B. Phase B fixes add commits, so after Phase B
pushes anything, return to Phase A on the new head SHA until both phases are
clean against the same SHA. Stop and escalate the moment a blocker or a genuine
user decision appears — do not keep looping.

A PR can have no checks at all (path-filtered changes, repos without CI, or a
review-comment-only invocation). Treat "no expected checks for the latest SHA"
as a **green Phase A**, not a blocker, and continue to Phase B — otherwise the
skill cannot do the review-comment work it was invoked for. Only escalate a
missing check when a check is genuinely *expected* and absent (see Step 4).

## Scope

- GitHub PRs only. If the repo is GitLab, stop and use `check-pr`.
- Always work against the latest PR head SHA, not old commits.
- Phase A is about CI/status checks. Phase B is about review threads, review
  bodies, and conversation comments.
- This skill **does** make GitHub writes in Phase B (replies and thread
  resolution) — but only for threads it can address without a real decision.
  Anything that needs the user's judgment is escalated, never silently resolved.

## Inputs

- **PR number** (optional): If not provided, detect the PR for the current branch.
- **Max iterations**: default `5`.

## Worktree safety — run before any commit

Both phases make commits on an existing PR (Phase A fixes, Phase B B3/B5
follow-ups). Before the *first* commit in either phase, check the worktree so a
review-fix commit never sweeps in unrelated local work:

```bash
git status --short --branch
```

If there are uncommitted or untracked files, inspect enough diff/file context to
classify each as **related** to the PR-watch fix or **unrelated**.

If unrelated changes exist, stop and ask the user what to do with them before
staging, committing, stashing, or deleting anything. Offer concrete choices:

- leave them untouched and only stage the PR-watch fix files
- include specific files in this PR
- stash specific files
- commit them separately

Never use `git add -A`, `git add .`, `git commit -a`, `git stash`, `git
restore`, or `rm` in a mixed worktree without explicit user direction. Stage
only the specific files your fix changed (`git add <path> …`) so every commit
this skill makes contains exactly the review fix and nothing else.

## Phase A — Get checks green

### 1. Identify the PR

If no PR number is provided, detect it from the current branch:

```bash
gh pr view --json number,headRefName,headRefOid,url,isDraft
```

If needed, switch to the PR branch before making changes.

Stop early if:

- `gh` is not authenticated
- there is no PR for the branch
- the repo is not hosted on GitHub

### 2. Track the latest head SHA

Always work against the current PR head SHA:

```bash
PR_JSON=$(gh pr view "$PR_NUMBER" --json number,headRefName,headRefOid,url)
HEAD_SHA=$(echo "$PR_JSON" | jq -r .headRefOid)
PR_URL=$(echo "$PR_JSON" | jq -r .url)
```

Ignore failing checks from older SHAs. After every push, refresh `HEAD_SHA` and
restart the inspection loop.

### 3. Inventory checks for that SHA

Fetch both GitHub check runs and legacy commit status contexts:

```bash
gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/check-runs?per_page=100"
gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/status"
```

For a compact PR-level view, this GraphQL payload is useful:

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      headRefOid
      url
      statusCheckRollup {
        contexts(first:100) {
          nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl workflowName }
            ... on StatusContext { context state targetUrl description }
          }
        }
      }
    }
  }
}' -F owner=OWNER -F repo=REPO -F pr="$PR_NUMBER"
```

### 4. Wait for checks to actually run

After a new push, checks can take a moment to appear. Poll every 15-30 seconds
until one of these is true:

- checks have appeared and every item is in a terminal state
- checks have appeared and at least one failed
- no checks appear after a reasonable wait, usually 2 minutes

Treat these as terminal success states:

- check runs: `SUCCESS`, `NEUTRAL`, `SKIPPED`
- status contexts: `SUCCESS`

Treat these as pending:

- check runs: `QUEUED`, `PENDING`, `WAITING`, `REQUESTED`, `IN_PROGRESS`
- status contexts: `PENDING`

Treat these as failures:

- check runs: `FAILURE`, `TIMED_OUT`, `CANCELLED`, `ACTION_REQUIRED`, `STARTUP_FAILURE`, `STALE`
- status contexts: `FAILURE`, `ERROR`

If no checks appear for the latest SHA, inspect `.github/workflows/`, workflow
path filters, and branch protection expectations to decide whether a check is
actually *expected*:

- If no check is expected (path filters exclude these files, the repo has no CI,
  or this is a review-comment-only invocation), treat Phase A as **green** and
  proceed to Phase B.
- If a check *is* expected but never appears, and it cannot be caused or fixed
  from the repo, escalate.

### 5. Investigate failing checks

For GitHub Actions failures, inspect runs and failed logs for the current SHA:

```bash
gh run list --commit "$HEAD_SHA" --json databaseId,workflowName,status,conclusion,url,headSha
gh run view <RUN_ID> --json databaseId,name,workflowName,status,conclusion,jobs,url,headSha
gh run view <RUN_ID> --log-failed
```

For each failing check, classify it:

| Failure type | Action |
|---|---|
| Code/test regression | Reproduce locally, fix, and verify |
| Lint/type/build mismatch | Run the matching local command from the workflow and fix it |
| Flake or transient infra issue | Rerun once if evidence supports flakiness |
| External service/status app failure | Escalate with the details URL and owner guess |
| Missing secret/permission/branch protection issue | Escalate immediately |

Only rerun a failed job once without code changes. Do not loop on reruns.

### 6. Fix actionable failures

If the failure is actionable from the checked-out code:

1. Read the workflow or failing command to identify the real gate.
2. Reproduce locally where reasonable.
3. Make the smallest correct fix.
4. Run focused verification first, then broader verification if needed.
5. Commit in a logical commit — staging only your fix files, per
   [Worktree safety](#worktree-safety--run-before-any-commit).
6. Push before re-checking the PR.

Do not stop at a local fix. The loop is only complete when the remote PR checks
for the new head SHA are green.

### 7. Push and repeat

After each fix:

```bash
git push
sleep 5
```

Then refresh the PR metadata, get the new `HEAD_SHA`, and restart from Step 3.

Exit the loop only when:

- all checks for the latest head SHA are green, or
- a blocker remains after reasonable repair effort, or
- the max iteration count is reached

### 8. Escalate blockers precisely

If you cannot get the PR green, report:

- PR URL
- latest head SHA
- exact failing or missing check names
- details URLs
- what you already tried
- why it is blocked
- who should likely unblock it
- the next concrete action

Good blocker examples:

- external status app outage
- missing GitHub secret or permission
- required check name mismatch in branch protection
- persistent flake after one rerun
- failure needs credentials or infrastructure access you do not have

## Phase B — Work the review conversations

Once checks are green for the latest head SHA, work through the review
conversations. The goal is to clear every unresolved thread **without making any
decision that belongs to the user**. Mechanical and low-risk threads get fixed,
replied to, and resolved automatically so the human never has to touch them. The
threads that encode a real choice get surfaced as explicit decisions — because a
silent AI choice on architecture, design, or behavior is exactly the drift this
phase exists to prevent.

### B1. Fetch thread-aware conversation state

Reuse the bundled helper from the sibling `gh-address-comments` skill — do not
re-implement the GraphQL. It returns reviews, conversation comments, and
`review_threads` with `id`, `isResolved`, `isOutdated`, `path`, `line`, and the
comment node IDs:

```bash
# Pass explicit BASE-repo coordinates — don't rely on the coordinate-less default.
# `gh pr view` has no baseRepository JSON field, but its `url` always points at
# the base repo (https://github.com/OWNER/REPO/pull/NUMBER) — parse that.
PR_URL=$(gh pr view "$PR_NUMBER" --json url --jq .url)
OWNER=$(echo "$PR_URL" | sed -E 's#https?://[^/]+/([^/]+)/([^/]+)/pull/[0-9]+#\1#')
REPO=$(echo "$PR_URL" | sed -E 's#https?://[^/]+/([^/]+)/([^/]+)/pull/[0-9]+#\2#')
python3 "${CLAUDE_PLUGIN_ROOT}/skills/engineering/pr-watch/scripts/fetch_comments.py" --owner "$OWNER" --repo "$REPO" --number "$PR_NUMBER"
```

A review thread lives on the **base** repository, so always fetch with the base
owner/repo/number. The helper's coordinate-less default derives them from the
*head* repo (`gh pr view --json headRepositoryOwner,headRepository`), which is
wrong for a fork PR — the head repo plus the base PR number fetches the wrong PR
or no review state at all. The PR `url` encodes the base owner/repo directly, so
parsing it keeps fetches correct for same-repo and fork PRs alike. (`gh pr view`
exposes `headRepository`/`headRepositoryOwner` but no `baseRepository` field, so
don't reach for one.)

Work every unresolved thread where `isResolved` is `false`. An `isOutdated`
thread is usually already handled by later commits — verify against the current
file before treating it as done.

Do not stop at inline threads. A reviewer can request a change in a **review
body** or a **top-level conversation comment** that is not attached to any
thread — and the helper returns those in `reviews` and `conversation_comments`.
Run those through the same B2 triage so a requested change there is never
silently skipped.

Two cautions for these non-thread items:

- **They can't be resolved, so leave a durable reply, not just a report line.**
  A review body or top-level comment has no resolve state — the only signal on
  the PR that you handled it is a GitHub reply. Post one (a comment that
  references the request and says what you did or that it was escalated).
  Summarizing it only in your final chat report is not enough: the reviewer
  still sees an unacknowledged ask, and the next `pr-watch` run will re-fetch
  and re-triage the same comment with nothing showing it was addressed.
- **Check whether the request is still outstanding before acting on it.** The
  helper returns *every* review body, including an old `CHANGES_REQUESTED` that
  the reviewer later approved or acknowledged. Before you treat a review body as
  active work, check the reviewer's current state and any later activity —
  otherwise you may re-escalate an already-closed decision or apply an obsolete
  mechanical request. Skip superseded bodies.

Ignore purely informational bot output (CI/precheck summaries) that asks for
nothing.

### B2. Triage every unresolved thread

Classify each thread into exactly one bucket. The dividing line is **your
confidence**, not the topic. A fix can touch behavior and still be a clear
correctness fix you should just make. What you must never do is silently make a
call that depends on the user's intent, taste, or priorities, or that would be
costly to undo. Lean toward auto-resolving — escalation is for genuine forks,
not a receipt for every change.

| Bucket | What it looks like | Action |
|---|---|---|
| **Auto-resolve** | Anything you can fix one clearly-correct way and would recommend with confidence: typos, wording, formatting, lint/type/style nits, dead links, an obvious bug, a correctness/safety/consistency fix *even if it changes behavior*, applying a reviewer's concrete suggestion you agree is right, a thread already satisfied by current code (`isOutdated`), or a question with a clear factual answer from the code. | Address it, reply, resolve (B3). |
| **Escalate** | A genuine fork where reasonable options diverge on the user's *intent*, not on correctness: which of several valid designs / names / API shapes to adopt, whether to expand or drop scope, a product-behavior choice, or a change touching a documented decision (ADR, glossary term, entity model) that has more than one defensible answer. Also: anything costly or hard to reverse, or where you genuinely cannot pick a fix with confidence. | Do **not** fix or resolve. Collect it for B4. |

Two questions settle most threads:

1. **Can I name the single right fix and stake a recommendation on it?** If yes,
   make it — *the urge to attach a "recommended" option and then ask about it is
   the tell that you have already decided.* Asking anyway just makes the user
   rubber-stamp you, which is the friction this triage exists to avoid. Do it
   and report it.
2. **If I'm wrong, how expensive is it to undo?** A reversible fix you report
   transparently is recoverable — the user can push back after the fact — so it
   is **not** drift. Drift is silently making a consequential, intent-dependent,
   or hard-to-reverse call. Escalation protects the user from *that*.

A concrete suggested patch is not auto-resolvable *just because* it is concrete —
but it is not escalate-worthy just because it touches behavior either. Route it
to B4 only when the patch itself decides an intent-dependent question (which
design, which name, how much scope); otherwise, if you're confident it's right,
apply it. When you are genuinely torn between options that trade off on the
user's intent, that is the real signal to escalate.

### B3. Auto-resolve the mechanical threads

Address the auto-resolve threads, **then** reply and resolve them — in that
order. Resolving a thread before the fix is pushed and verified is how a PR ends
up showing a "resolved" thread while the remote still lacks the green fix, with
a reply citing a SHA that never landed. So:

1. Make the smallest correct fix for each thread (skip if the thread is a
   question or already satisfied — just verify).
2. Verify locally where reasonable.
3. Commit using the repo's commit conventions, staging only the files your fix
   touched, per [Worktree safety](#worktree-safety--run-before-any-commit).
   Batch related threads into one logical commit where it makes sense.
4. **Push, then refresh the head SHA and re-green the checks (Phase A) on the
   new SHA.** Only proceed once the push succeeded and the new SHA's checks are
   green — that is the SHA your replies will cite.
5. Now post a short factual reply on each fixed thread, then resolve it, using
   the thread `id` from the fetch helper and the *pushed* `HEAD_SHA`:

```bash
# Reply on the thread
gh api graphql -f query='
mutation($threadId:ID!, $body:String!) {
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId, body:$body}) {
    comment { id }
  }
}' -F threadId="$THREAD_ID" -F body="Fixed in $HEAD_SHA — <one-line what changed>."

# Resolve the thread
gh api graphql -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) { thread { id isResolved } }
}' -F threadId="$THREAD_ID"
```

Keep replies short and honest: what changed and where. For an already-satisfied
outdated thread (no new commit needed), reply with where it was addressed and
resolve it directly — there is nothing to push. Never resolve a thread you did
not actually address.

**Auto-resolved non-thread requests need the same acknowledgment.** When the
mechanical request came from a review body or top-level conversation comment
(the non-thread items B1 routes through triage), there is no thread to resolve —
so after the fix is pushed and green, post a durable **top-level reply** that
references the request and says what changed (`Fixed in <pushed HEAD_SHA> —
<one-line>.`). That reply is the only signal on the PR that the ask was handled;
without it the next `pr-watch` run re-fetches and re-triages the same request.
This is the auto-resolve mirror of B5's non-thread closure.

Because the auto-fix commits already moved the head SHA in step 4, the PR is
only "done" once that new SHA is fully green in Phase A and every addressed
thread is resolved against it.

### B4. Escalate the decisions — ask, do not drift

First, a gut check on the list. For each thread you're about to escalate, ask:
*if I just made my recommended fix and reported it, would the user reasonably be
annoyed I didn't ask?* If the honest answer is "no — they'd have said yes," it
was never an escalation; move it back to B3. A decision list where every item
carries the same confident "recommended" pick is the symptom of over-escalating
— that is you asking the user to rubber-stamp work you were sure about. Keep
here only the threads where you genuinely can't pick for them.

Present the threads that survive that check as a single, compact decision list.
Do not resolve or reply to them, and do not start implementing a guess. For each
decision give:

- **Where**: `path:line`, reviewer, and a link or quote of the comment.
- **The ask**: what the reviewer wants, in one sentence.
- **Why it needs you**: the specific fork — which two-plus options diverge on
  your intent/priorities, or why it's too costly to reverse to just do.
- **Options**: the realistic choices, with a brief recommendation and its
  tradeoff. Make it cheap for the user to answer with a single pick.

Then stop and wait for the user's calls. Escalation pauses a thread; it does not
abandon it. The thread stays open and unresolved *only until the user decides* —
once they do, close the loop in B5.

### B5. After the decision — close the escalated items

A decided escalation is no longer a decision you'd be making for the user, so it
should reach the same concluded end-state as an auto-resolve item. Leaving it
open after the user has answered just makes the PR look unfinished and forces a
manual cleanup. For each escalated item — inline thread, review body, or
top-level comment — once the user has given their call:

1. **Apply what they decided.** If they chose a change, make it via the B3
   mechanics (fix → commit → push → re-green Phase A on the new SHA). If they
   declined the reviewer's suggestion, there is no code change — the decision
   itself is the resolution.
2. **Reply with the outcome, then close it** — same push-before-close ordering
   and same mutations as B3. The reply records the decision so the item reads as
   concluded, not silently closed:
   - Change applied: `Per your call, did X — fixed in <pushed HEAD_SHA>.`
   - Declined: `Decision: keeping it as-is because <one-line reason>. Resolving.`
   Then close it the right way **for its type**:
   - **Inline thread** → `resolveReviewThread` the thread (as in B3).
   - **Review body or top-level conversation comment** (the non-thread items B1
     routes through triage) → there is *no* thread to resolve, so the durable
     top-level reply from B1 **is** the closure. Post it; do not call
     `resolveReviewThread`. Without that reply the original request stays
     unacknowledged and the next `pr-watch` run re-fetches and re-escalates it.

Close only after the decision is in (and, for a code change, pushed and green)
— never before. The gate on an escalated item is the *human decision*; the gate
on an auto-resolve item is your own confident fix. Both end acknowledged —
inline threads resolved, non-thread items replied to.

If the user defers a decision instead of making one, leave that thread open and
say so in the final report — an undecided thread is the one thing Phase B should
never resolve on its own.

### B6. Confirm the PR is actually mergeable, not just thread-clean

Green checks and zero unresolved threads do not mean the PR can merge. On repos
with required reviews, branch protection can still block on the PR-level review
state — and Phase B's own pushes can dismiss a prior approval, so the state may
have changed under you. Before reporting "fully addressed," check it:

```bash
gh pr view "$PR_NUMBER" --json reviewDecision,mergeStateStatus,reviews \
  --jq '{reviewDecision, mergeStateStatus}'
```

If `reviewDecision` is `REVIEW_REQUIRED` or `CHANGES_REQUESTED` (or
`mergeStateStatus` is `BLOCKED`/`BEHIND`), the PR is *not* done even with green
checks and clean threads — report it as awaiting reviewer approval/dismissal (or
a rebase) rather than claiming completion. This is a reporting gate, not
something to resolve yourself: approving or dismissing reviews is the reviewer's
call, never the skill's.

## Output

When the skill completes, report:

- PR URL and branch
- final head SHA
- green/pending/failing check summary (Phase A)
- PR review/merge state (`reviewDecision`, `mergeStateStatus`) — flag if it
  still blocks merge despite green checks
- conversation summary (Phase B): threads auto-resolved (with one-line each),
  threads escalated-then-resolved after the user's decision, and any threads
  still open because a decision is pending
- fixes made and verification run
- whether changes were pushed
- the open decision list, if any threads await a user decision
- blocker summary if not fully green

**Always end the final report with the PR's clickable URL**, no matter how the
run concludes — green, blocked, escalating, or stopped on a blocker. It is the
one thing the user needs to act on the result, so make it the last line and
never omit it (use the `url` from `gh pr view`).

## Notes

- This skill is intentionally narrower than `check-pr`: it is a repair-and-clear
  loop for PR checks and review threads, not a full PR review.
- Phase B reuses `gh-address-comments`'s `fetch_comments.py` for thread state.
  That sibling skill is read-only by default; pr-watch is the one that performs
  the reply + resolve writes — automatically for threads that need no decision
  (B3), and after the user's call for escalated ones (B5). Only an *undecided*
  escalation stays open.
- This skill complements `greploop`: Greptile can be perfect while CI is still
  red, or while review threads are still open.
- The anti-drift rule is the heart of Phase B, but it cuts both ways. Drift is
  silently making a consequential, intent-dependent, or hard-to-reverse call —
  *not* applying a confident, reversible fix and reporting it. Escalate the
  genuine forks; auto-resolve and report the rest. A decision list that is all
  "recommended" picks means you escalated too much and turned the user into a
  rubber stamp — the opposite of saving their attention.
