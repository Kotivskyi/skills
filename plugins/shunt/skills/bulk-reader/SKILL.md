---
name: bulk-reader
description: "Use Pi to answer questions about large files, groups of files, or saved diffs without loading them into the parent context."
---
<!-- Modified from Spotify Shunt: use Pi and state the worker context limits. See ../../NOTICE. -->

Use bulk reading when a summary or specific answer is sufficient. Use focused reads for exact edits and debugging.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/bulk-read.sh" --question "<question and relevant constraints>" --paths "<file1>" "<file2>"
```

Pass all files needed to answer the question. To read a large diff, save it to a file first.

Pi cannot call tools or load project instructions automatically. Put relevant constraints in the question.

Each call starts a new session. For a follow-up, pass the files again. This reduces parent context use; Pi still processes the files each time.

Check exact values and line numbers with focused reads before using them in edits.
