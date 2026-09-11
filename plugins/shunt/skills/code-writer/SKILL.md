---
name: code-writer
description: "Delegate complete-file generation to Pi when source and reference files define the result: tests, configuration, documentation, or type stubs. Load before drafting the file, including test backfills and regenerated files. Keep design choices and small exact edits with the parent."
---
<!-- Modified from Spotify Shunt: use Pi with multiple references and controlled target writes. See ../../NOTICE. -->

Use Pi to draft a complete file when a spec and reference files define the result. This includes test backfills and regenerated files.
Delegate before writing the file content in the parent. Keep design decisions and small exact edits with the parent agent.
Bulk-reader supplies drafts for source-analysis reports. The parent may save and review those answers without another code-writer call.

Pass source files that define behavior and reference files that show the required patterns. At least one reference is required.

For tests, derive expectations for each exported function. Do not limit a general helper’s positive cases to values used by one caller. Include this contract coverage in the spec and review.
For fallback logic, include a nonmatching primary value with a matching fallback. Check branch combinations, not only isolated inputs.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/code-write.sh" \
  --spec "<what to generate and all relevant constraints>" \
  --reference "<source-file>" "<pattern-file>" \
  --target "<output-path>"
```

Omit `--target` to return code on stdout.

Pi cannot call tools or load `AGENTS.md` and `CLAUDE.md` automatically. Include their relevant constraints in the spec. Do not assume Pi can inspect imports or run project checks.

Each call is independent. For a follow-up, include the generated file as a reference. The reference and target can be the same file. State what to keep and what to change.

The wrapper writes only `--target`, after a successful, complete Pi response. Pi does not edit the project directly.

Review the generated code and run the relevant project checks before accepting it.
