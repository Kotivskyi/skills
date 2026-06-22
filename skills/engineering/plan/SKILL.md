---
name: plan
description: >
  Break down a feature, bugfix, or task into a concrete implementation plan
  before touching code. Use at the start of any non-trivial piece of work to
  clarify scope, surface dependencies, and produce an ordered checklist the
  user can approve before implementation begins.
---

# Plan

Produce a structured implementation plan for the work the user described.
Stop before writing any code — the deliverable is the plan itself.

## Steps

### 1. Understand the goal

Restate the objective in one sentence. If the request is ambiguous, ask the
minimum questions needed to sharpen it before proceeding.

### 2. Explore the affected area

Read only what is needed to understand scope:

- entry points, relevant types, and interfaces in the area being changed
- existing tests covering related behaviour
- any config, migration, or schema files that would be touched

Do not read the whole codebase. Stop when you have enough to write the plan.

### 3. Identify constraints and risks

Note anything that could cause the plan to fail or expand scope unexpectedly:

- external dependencies (APIs, services, packages)
- backwards-compatibility requirements
- performance or security implications
- anything that must stay unchanged

### 4. Write the plan

Structure it as:

**Goal** — one sentence.

**Scope** — what is in and what is out.

**Steps** — ordered list. Each step should be small enough to verify
independently. Mark steps that must happen in sequence with a dependency note.

**Open questions** — anything the user must decide before or during
implementation (keep this list short; only genuine forks belong here).

**Verification** — how to confirm the work is correct when done (tests to
run, manual checks, etc.).

### 5. Get approval

Present the plan and wait. Do not start implementing until the user explicitly
approves (or adjusts and approves). If they approve, hand off to the
`/sdlc:pr-watch` skill once a PR exists, or run the implementation inline.
