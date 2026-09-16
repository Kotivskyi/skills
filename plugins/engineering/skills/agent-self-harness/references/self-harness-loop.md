# Self-Harness Loop

Use this as the governing state machine for `agent-self-harness`.

```text
dependency checks
      |
      v
source selection
      |
      v
redacted trace packets
      |
      v
weakness packets
      |
      v
Gate 1: user selects one weakness
      |
      v
competing candidate worktrees
      |
      v
targeted evals + regression evals
      |
      v
Gate 2: user approves selected improvement
      |
      v
apply locally
```

## Invariants

- Deterministic extraction happens before LLM judgment.
- Weakness selection is user-governed.
- Candidate proposals are small, diverse, and tied to the selected failure mechanism.
- Validation uses targeted evals plus existing regression evals.
- Applying a change requires explicit final approval.
- No push happens by default.
