# Final Approval Brief

Use this template for Gate 2. Keep the brief compact and decision-grade.

```markdown
## Proposed Improvement

- Weakness: <id and title>
- Selected candidate: <candidate id>
- Changed files: <paths>

## What Improved

<Short evidence-backed behavior change.>

## Why This Candidate Won

- Targeted evals: <pass/fail summary>
- Regression evals: <pass/fail summary>
- Token usage: <candidate comparison>
- Runtime: <candidate comparison>
- Diff size: <candidate comparison>

## Risks and Regressions

<Known risks, failed evals, weak evidence, or no regressions found.>

## Workflow / Architecture Change

<Include only when workflow, architecture, or tools changed. Use ASCII.>

```text
before -> after
```

## New Scripts or Tools

- Location:
- Purpose:
- Inputs:
- Outputs:
- Network/secrets:
- Why simpler prompt or skill change was insufficient:

## Rollback

<Exact revert or restore instructions.>

## Approval Needed

Apply this candidate locally? No merge or push will happen unless explicitly requested.
```

For self-modification, add a `Self-Modification Risk` subsection that states how the workflow can be restored if the new self-harness behavior is wrong.
