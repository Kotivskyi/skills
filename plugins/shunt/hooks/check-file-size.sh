#!/bin/bash
# Modified from Spotify Shunt: Pi routing and current PreToolUse output.
# Block full-file reads on large files, redirect to /shunt:bulk-reader skill
# Self-contained: all routing logic lives here, no CLAUDE.md needed

MIN_LINES="${SHUNT_MIN_LINES:-350}"
case "$MIN_LINES" in ''|*[!0-9]*) MIN_LINES=350 ;; esac

input=$(cat)

file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
offset=$(echo "$input" | jq -r '.tool_input.offset // empty')
limit=$(echo "$input" | jq -r '.tool_input.limit // empty')

# Allow targeted reads (offset or limit set) — Claude already knows what it needs
if [ -n "$offset" ] || [ -n "$limit" ]; then
  echo '{}'
  exit 0
fi

# Allow if file doesn't exist or path is empty
if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  echo '{}'
  exit 0
fi

# Allow small files — delegation overhead isn't worth it
lines=$(wc -l < "$file_path" 2>/dev/null | tr -d ' ' || echo "0")
if [ "$lines" -le "$MIN_LINES" ]; then
  echo '{}'
  exit 0
fi

jq -n --arg reason "File is ${lines} lines (threshold: ${MIN_LINES}). Use /shunt:bulk-reader to delegate this read to Pi. For exact content, use Read with offset or limit." '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
