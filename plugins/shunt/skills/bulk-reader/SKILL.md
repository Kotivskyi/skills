---
name: bulk-reader
description: "Delegate cross-file questions, evidence checks, source surveys, and large-file summaries to Pi before reading or searching file contents. Use even when the requested evidence may be absent. Keep focused debugging and exact edits with the parent."
---
<!-- Modified from Spotify Shunt: use Pi and state the worker context limits. See ../../NOTICE. -->

Use this skill for questions across source files, even when those files may not contain the answer.
Select inputs from file names and sizes. Use Pi before broad content reads or searches.

If a hook blocks a broad read, use Pi. Do not reconstruct the whole file with limited reads or Bash commands.
Use focused reads to check a specific claim, resolve an ambiguity, or prepare an exact edit.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/bulk-read.sh" --question "<question and relevant constraints>" --paths "<file1>" "<file2>"
```

Pass all files needed to answer the question. To read a large diff, save it to a file first.

Pi cannot call tools or load project instructions automatically. Put relevant constraints in the question.

Ask Pi to cite source expressions for type checks and comparisons that affect the answer.
Preserve both operands and the operator. Copy the source expression instead of shortening it.
After saving a report, verify its comparisons and behavior claims against executable source, including tables and conclusions.
For each claim, locate the condition and action that support it. If only a comment or call name supports it, state that limit.
Keep the report within the question's scope. Remove unrelated behavior summaries instead of generalizing them.
Correct the saved file before finishing.

Describe the caller's action and make implementation limits clear. Calls and comments do not prove storage or deployment guarantees.
Before generalizing across callers, check each caller's branches. Preserve successful recovery, propagation, and conditional outcomes in the conclusion.
When requested evidence is absent, limit the answer to unknown facts, relevant source observations, and missing artifacts.
Do not expand that answer into a general review of helpers or callers. Omit explanations that require outside library or database behavior.
A conclusion may repeat supported findings but must not introduce or broaden a behavior claim.
When saving a report, keep behavior claims in that report. The final status message should name the file and checks.

Each call starts a new session. For a follow-up, pass the files again. This reduces parent context use; Pi still processes the files each time.

Check exact values and line numbers with focused reads before using them in edits.
