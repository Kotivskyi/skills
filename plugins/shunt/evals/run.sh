#!/bin/bash
# Modified from Spotify Shunt: Pi tests and current PreToolUse response checks.
# Test runner for shunt evals: hook routing decisions + parent context benchmarks
#
# Usage:
#   bash evals/run.sh              # hooks and transport (no model calls)
#   bash evals/run.sh --benchmark  # also measure parent context (requires Pi auth)
#   bash evals/run.sh --all        # offline checks and token benchmarks
# Real-world behavior: node evals/real-world.mjs --repo /path/to/pastorix-backend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT
PASSED=0
FAILED=0
TOTAL=0
RUN_BENCHMARK=false

for arg in "$@"; do
  case "$arg" in
    --benchmark) RUN_BENCHMARK=true ;;
    --all)       RUN_BENCHMARK=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

generate_fixture() {
  local path="$1" lines="$2"
  if [ "$lines" -eq 0 ]; then
    touch "$path"
  else
    seq 1 "$lines" | awk '{print "line "NR}' > "$path"
  fi
}

setup_fixtures() {
  local evals_file="$1"
  rm -rf "$FIXTURES"
  mkdir -p "$FIXTURES"

  local count
  count=$(jq '.evals | length' "$evals_file")

  for ((i = 0; i < count; i++)); do
    local fixture
    fixture=$(jq -r ".evals[$i].fixture" "$evals_file")
    [ "$fixture" = "null" ] && continue

    local lines
    lines=$(jq -r ".evals[$i].fixture.lines" "$evals_file")

    local input_path
    input_path=$(jq -r ".evals[$i].input.tool_input.file_path // empty" "$evals_file")
    if [ -z "$input_path" ]; then
      input_path=$(jq -r ".evals[$i].input.tool_input.command // empty" "$evals_file" | sed -E 's/^(cat|head|tail|less|more) +(-[^ ]+ +)*//' | sed 's/ .*//' | tr -d '"'"'")
    fi
    input_path=$(echo "$input_path" | sed "s|{{FIXTURES}}|$FIXTURES|")

    # Commands the parser is not meant to extract a path from (grep, git, …)
    # reduce to the command name itself. Generating that would drop a junk file
    # in the working directory; the fixtures those evals rely on are created by
    # their siblings anyway.
    case "$input_path" in
      "$FIXTURES"/*) generate_fixture "$input_path" "$lines" ;;
    esac
  done
}

run_eval() {
  local hook="$1" name="$2" input="$3" expected="$4" reason="$5" env_json="$6"
  TOTAL=$((TOTAL + 1))

  local result actual
  if [ -n "$env_json" ] && [ "$env_json" != "null" ]; then
    local env_cmd=""
    while IFS='=' read -r key val; do
      env_cmd="$env_cmd $key=$val"
    done < <(echo "$env_json" | jq -r 'to_entries[] | "\(.key)=\(.value)"')
    result=$(echo "$input" | env $env_cmd bash "$hook" 2>/dev/null)
  else
    result=$(echo "$input" | bash "$hook" 2>/dev/null)
  fi
  actual=$(echo "$result" | jq -r '
    if . == {} then "allow"
    elif .hookSpecificOutput.hookEventName == "PreToolUse" and
         .hookSpecificOutput.permissionDecision == "deny" and
         (.hookSpecificOutput.permissionDecisionReason | length) > 0 then "block"
    else "invalid" end')

  if [ "$actual" = "$expected" ]; then
    printf "  \033[32mPASS\033[0m  %-30s %s\n" "$name" "$reason"
    PASSED=$((PASSED + 1))
  else
    printf "  \033[31mFAIL\033[0m  %-30s expected=%s got=%s\n" "$name" "$expected" "$actual"
    FAILED=$((FAILED + 1))
  fi
}

run_suite() {
  local hook="$1" evals_file="$2" label="$3"

  setup_fixtures "$evals_file"

  echo ""
  echo "$label"
  echo "────────────────────────────────────────────────────────────────"

  local count
  count=$(jq '.evals | length' "$evals_file")

  for ((i = 0; i < count; i++)); do
    local name expected reason input
    name=$(jq -r ".evals[$i].name" "$evals_file")
    expected=$(jq -r ".evals[$i].expected_decision" "$evals_file")
    reason=$(jq -r ".evals[$i].reason" "$evals_file")
    input=$(jq -c ".evals[$i].input" "$evals_file" | sed "s|{{FIXTURES}}|$FIXTURES|g")

    local env_json
    env_json=$(jq -r ".evals[$i].env // empty" "$evals_file")
    run_eval "$hook" "$name" "$input" "$expected" "$reason" "$env_json"
  done

  rm -rf "$FIXTURES"
}

# ── Transport suite ──

# Runs as a child process: the suite stubs Pi, and that stub must not
# leak into the benchmarks below, which need the real one.
run_transport_suite() {
  echo ""
  echo "Transport (Bash scripts and Pi CLI, fake Pi)"
  echo "────────────────────────────────────────────────────────────────"

  local output counts p f
  output=$(bash "$SCRIPT_DIR/transport-evals.sh" 2>&1) || true

  printf '%s\n' "$output" | grep -v '^## ' || true
  # `|| true` so a missing trailer reaches the fallback below instead of
  # tripping set -e on the failed grep.
  counts=$(printf '%s\n' "$output" | grep '^## ' | tail -1 || true)
  p=$(printf '%s' "$counts" | awk '{print $2}')
  f=$(printf '%s' "$counts" | awk '{print $3}')

  if [ -z "$p" ]; then
    printf "  \033[31mFAIL\033[0m  %-32s suite did not report results\n" "transport-evals"
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
    return
  fi

  PASSED=$((PASSED + p))
  FAILED=$((FAILED + f))
  TOTAL=$((TOTAL + p + f))
}

# ── Main ──

run_suite "$SCRIPT_DIR/../hooks/check-file-size.sh" "$SCRIPT_DIR/hook-evals.json" "Read hook (check-file-size.sh)"
run_suite "$SCRIPT_DIR/../hooks/check-bash-read.sh" "$SCRIPT_DIR/bash-hook-evals.json" "Bash hook (check-bash-read.sh)"
run_transport_suite

echo ""
echo "════════════════════════════════════════════════════════════════"
printf "Total: \033[32m%d passed\033[0m, \033[31m%d failed\033[0m, %d total\n" "$PASSED" "$FAILED" "$TOTAL"

[ "$FAILED" -gt 0 ] && exit 1

if [ "$RUN_BENCHMARK" = true ]; then
  bash "$SCRIPT_DIR/benchmark.sh"
fi

echo ""
[ "$FAILED" -gt 0 ] && exit 1
exit 0
