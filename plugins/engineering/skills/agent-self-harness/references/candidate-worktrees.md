# Candidate Worktrees

Use this reference only after Gate 1 selects a weakness and the targeted eval strategy is visible.

## Location

Create candidate worktrees under:

```text
/tmp/agent-team.worktrees/
```

Branch pattern:

```text
agent-self-harness/<run>/<candidate>
```

## Candidate Rules

- Generate multiple competing candidates for the selected weakness.
- Each candidate tests one conceptual mechanism.
- A candidate may touch multiple files only when that mechanism requires it.
- Cross-surface competition is allowed when the weakness packet names multiple plausible surfaces.
- Candidate surfaces can include a new skill, an existing skill edit, a prompt/harness edit, or a bundled script/tool.
- Document any new script/tool with purpose, inputs, outputs, location, network/secrets needs, and why a simpler skill or prompt change was insufficient.

## Validation Order

1. Run targeted evals for all candidates.
2. Run full regression evals only for candidates that clear the targeted bar.
3. Exclude candidates with targeted failure or material regression.
4. Rank behavior first. If quality is materially similar, rank lower token usage first, runtime second, diff size third.

## Cleanup

Keep candidate worktrees through final approval. After final approval or rejection, clean rejected candidate worktrees and short-lived branches unless the user asks to keep them. No push happens by default.
