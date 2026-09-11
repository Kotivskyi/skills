---
name: code-writer
description: "Use Pi to generate code from reference files, including tests, configuration, documentation, and type stubs with established patterns."
---
<!-- Modified from Spotify Shunt: use Pi with multiple references and controlled target writes. See ../../NOTICE. -->

Use this skill when a spec and reference files can define the result. Keep design decisions and exact edits with the parent agent.

Pass source files that define behavior and reference files that show the required patterns. At least one reference is required.

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
