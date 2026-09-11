#!/bin/bash
# Make worker routing visible before the parent selects source-reading tools.
set -euo pipefail
jq -n '{hookSpecificOutput: {
  hookEventName: "SessionStart",
  additionalContext: "Shunt uses Pi for broad source analysis and file generation. Load Skill shunt:bulk-reader before broad content reads or searches for source surveys, cross-file reports, or questions about missing evidence. Use focused reads to verify source claims. For these analysis tasks, do not replace denied broad reads with chunks or a different tool. Load Skill shunt:code-writer before drafting code or a complete file from established patterns. Bulk-reader handles analysis reports; the parent may save its answers. After saving and checking an analysis report, finish with its file path and checks only. Keep behavior claims in the checked report; do not restate them in the completion message. Keep exact edits and focused debugging with the parent."
}}'
