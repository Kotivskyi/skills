# Learnings format

A `misfiring-skill` fix adds one line to the `## Learnings` section of the target `SKILL.md`.

## Rules

- `## Learnings` is the last section of `SKILL.md`. When it does not exist, add it at the end.
- One entry is one line.
- The entry has a date, then two sentences, then the evidence. The first sentence states what the agent did wrong. The second sentence states what to do.
- Use ASD-STE100: short sentences, active voice.
- Do not copy a raw quote. Paraphrase.
- When the section has more than 15 entries, ask the user to fold the entries into the body of the skill.

## Format

```text
- <YYYY-MM-DD>: <What went wrong.> <What to do.> Evidence: run <runId>, <N> episodes.
```

## Example

```text
- 2026-09-22: The agent used npm in a pnpm workspace. Read the lockfile first and use the matching package manager. Evidence: run 20260922-181000-pastorix, 4 episodes.
```
