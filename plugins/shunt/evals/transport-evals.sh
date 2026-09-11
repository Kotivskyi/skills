#!/bin/bash
# Black-box Bash + jq checks. No Pi account, model, network, or Python is used.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/shunt-evals.XXXXXX")
trap 'rm -rf "$WORKDIR"' EXIT
mkdir "$WORKDIR/bin"
cat > "$WORKDIR/bin/python3" <<'STUB'
#!/bin/bash
printf 'Python was invoked\n' > "$PYTHON_TRAP"
printf 'Python is not allowed in these tests\n' >&2
exit 91
STUB
cp "$WORKDIR/bin/python3" "$WORKDIR/bin/python"
chmod +x "$WORKDIR/bin/python3" "$WORKDIR/bin/python"
export PATH="$WORKDIR/bin:$PATH"
PASSED=0 FAILED=0

fail() { printf '%s\n' "$*" >&2; exit 1; }
assert() { "$@" || fail "Check failed: $*"; }
eq() { [ "$1" = "$2" ] || fail "Expected [$1], got [$2]"; }
output_is() { cmp -s "$OUT" <(printf '%s' "$1") || fail 'Unexpected stdout'; }
captured() {
  assert test -s "$FAKE_PI_CAPTURE"
  jq -e "$@" "$FAKE_PI_CAPTURE" >/dev/null || {
    jq '{args,cwd,settings,agent_dir}' "$FAKE_PI_CAPTURE" >&2
    fail "Captured request failed: $*"
  }
}

configure() {
  jq -n --arg text "${1-answer from Pi}" --arg reason "${2:-stop}" '
    {events: [{type:"agent_start"}, {type:"agent_end", messages:[{
      role:"assistant", api:"openai-responses", provider:"test", model:"test",
      timestamp:1700000000000, stopReason:$reason,
      content:[{type:"thinking",thinking:"private reasoning"},{type:"text",text:$text}]
    }]}]}' > "$FAKE_PI_CONFIG"
}
config_patch() {
  jq "$@" "$FAKE_PI_CONFIG" > "$CASE/config-next.json" || fail 'Invalid test config'
  mv "$CASE/config-next.json" "$FAKE_PI_CONFIG"
}
setup() {
  local key
  for key in $(compgen -A variable SHUNT_); do unset "$key"; done
  CASE="$WORKDIR/case $((PASSED + FAILED))"
  mkdir -p "$CASE/caller/.pi"
  CALLER=$(cd "$CASE/caller" && pwd -P)
  TEST_PLUGIN="$PLUGIN_DIR"
  OUT="$CASE/stdout" ERR="$CASE/stderr"
  SOURCE="$CALLER/source file.ts" TARGET="$CALLER/target file.ts"
  printf 'export const original = 42;\n' > "$SOURCE"
  printf 'keep this file\n' > "$TARGET"
  printf '{"defaultModel":"caller-model"}\n' > "$CALLER/.pi/settings.json"
  cp "$SCRIPT_DIR/fixtures/fake-pi.sh" "$CALLER/fake pi"
  chmod +x "$CALLER/fake pi"
  export PI_BIN="$CALLER/fake pi" PI_CODING_AGENT_DIR=""
  export FAKE_PI_CONFIG="$CASE/config.json" FAKE_PI_CAPTURE="$CASE/capture.json"
  export PYTHON_TRAP="$CASE/python-used" PORTAL_CLI_BIN=/usr/bin/false
  configure
}
invoke() {
  local script="$1" worker guard
  shift
  rm -f "$FAKE_PI_CAPTURE" "$CASE/guard-fired"
  (cd "$CALLER" && "$TEST_PLUGIN/scripts/$script" "$@") > "$OUT" 2> "$ERR" &
  worker=$!
  (
    trap 'kill "$sleeper" 2>/dev/null; exit' TERM
    sleep 3 & sleeper=$!
    wait "$sleeper"
    printf 'timeout\n' > "$CASE/guard-fired"
    kill -TERM "$worker" 2>/dev/null
  ) &
  guard=$!
  wait "$worker"; RC=$?
  kill "$guard" 2>/dev/null || true
  wait "$guard" 2>/dev/null || true
  assert test ! -e "$CASE/guard-fired"
  assert test ! -e "$PYTHON_TRAP"
}
bulk() { invoke bulk-read.sh --question 'Explain the file.' --paths "$SOURCE" "$@"; }
writer() { invoke code-write.sh --spec 'Write one function.' --reference "$SOURCE" "$@"; }
success() { [ "$RC" = 0 ] || { cat "$ERR" >&2; fail "Worker exited $RC"; }; }
rejected() { assert test "$RC" -ne 0; output_is ''; }
unchanged() {
  rejected
  eq 'keep this file' "$(cat "$TARGET")"
  assert test -s "$FAKE_PI_CAPTURE"
}
before_pi() { rejected; assert test ! -e "$FAKE_PI_CAPTURE"; }
copy_plugin() {
  TEST_PLUGIN="$CASE/plugin copy"
  mkdir -p "$TEST_PLUGIN/.pi"
  cp -R "$PLUGIN_DIR/scripts" "$TEST_PLUGIN/scripts"
  cp "$PLUGIN_DIR/.pi/settings.json" "$TEST_PLUGIN/.pi/settings.json"
}

test_bulk() {
  bulk; success; output_is $'answer from Pi\n'
  captured '.stdin | contains("export const original = 42;\n") and contains("Explain the file.")'
  captured '.args | join(" ") | contains("export const original") | not'
}
test_flags() {
  bulk; success
  captured '.args as $a | ["--print","--no-session","--approve","--no-tools",
    "--no-extensions","--no-skills","--no-prompt-templates","--no-context-files","--no-themes"]
    | all(. as $flag | $a | index($flag) != null)'
  captured '.args | .[index("--mode")+1] == "json" and
    .[index("--append-system-prompt")+1] == ""'
  captured '.args | index("--provider") == null and index("--model") == null and index("--thinking") == null'
}
test_settings() {
  local command
  for command in bulk writer; do
    "$command"; success
    captured --arg cwd "$PLUGIN_DIR" --slurpfile settings "$PLUGIN_DIR/.pi/settings.json" \
      '.cwd == $cwd and .settings == $settings[0]'
  done
}
test_settings_edits() {
  copy_plugin
  printf '{"defaultModel":"custom","retry":{"enabled":false,"maxRetries":1}}' > "$TEST_PLUGIN/.pi/settings.json"
  bulk; success; captured '.settings.defaultModel == "custom" and .settings.retry.maxRetries == 1'
  printf '{"defaultModel":"changed","defaultThinkingLevel":"high"}' > "$TEST_PLUGIN/.pi/settings.json"
  writer; success; captured '.settings.defaultModel == "changed" and .settings.defaultThinkingLevel == "high"'
}
test_invalid_settings() {
  local content
  copy_plugin
  for content in '{broken' '[]' 'null'; do
    printf '%s' "$content" > "$TEST_PLUGIN/.pi/settings.json"
    writer --target "$TARGET"; before_pi
    assert grep -Fq '.pi/settings.json' "$ERR"
    eq 'keep this file' "$(cat "$TARGET")"
  done
  rm "$TEST_PLUGIN/.pi/settings.json"
  bulk; before_pi; assert grep -Fq '.pi/settings.json' "$ERR"
}
test_relative_paths() {
  mkdir "$CALLER/existing agent"
  configure 'export const changed = 1;'
  PI_BIN='./fake pi' PI_CODING_AGENT_DIR='./existing agent' \
    invoke code-write.sh --spec Change --reference 'source file.ts' --target 'target file.ts'
  success; output_is ''; eq 'export const changed = 1;' "$(cat "$TARGET")"
  captured --arg cwd "$PLUGIN_DIR" \
    '.cwd == $cwd and (.stdin | contains("export const original = 42;"))'
  eq "$CALLER/existing agent" "$(cd "$(jq -r .agent_dir "$FAKE_PI_CAPTURE")" && pwd -P)"
}
test_shared_settings() {
  SHUNT_PI_PROVIDER=shared-provider SHUNT_PI_MODEL=shared-model SHUNT_PI_THINKING=low bulk
  success
  captured '.args | .[index("--provider")+1] == "shared-provider" and
    .[index("--model")+1] == "shared-model" and .[index("--thinking")+1] == "low"'
}
test_role_settings() {
  export SHUNT_PI_PROVIDER=shared SHUNT_PI_MODEL=shared SHUNT_PI_THINKING=low
  export SHUNT_BULK_READER_PROVIDER=bulk-provider SHUNT_BULK_READER_MODEL=bulk-model SHUNT_BULK_READER_THINKING=medium
  export SHUNT_CODE_WRITER_PROVIDER=writer-provider SHUNT_CODE_WRITER_MODEL=writer-model SHUNT_CODE_WRITER_THINKING=high
  bulk; success
  captured '.args | .[index("--provider")+1] == "bulk-provider" and
    .[index("--model")+1] == "bulk-model" and .[index("--thinking")+1] == "medium"'
  writer; success
  captured '.args | .[index("--provider")+1] == "writer-provider" and
    .[index("--model")+1] == "writer-model" and .[index("--thinking")+1] == "high"'
}
test_code() {
  printf 'test("example", () => {});\n' > "$CALLER/pattern test.ts"
  configure $'```ts\nexport const generated = 1;\n```'
  writer "$CALLER/pattern test.ts" --target "$TARGET"; success; output_is ''
  eq 'export const generated = 1;' "$(cat "$TARGET")"
  captured '.stdin | contains("export const original = 42;") and contains("test(\"example\", () => {});")'
}
test_target_permissions() {
  local mode actual
  for mode in 444 755; do
    chmod "$mode" "$TARGET"
    configure 'export const replacement = 2;'
    writer --target "$TARGET"; success; output_is ''
    eq 'export const replacement = 2;' "$(cat "$TARGET")"
    actual=$(stat -c '%a' "$TARGET" 2>/dev/null || stat -f '%Lp' "$TARGET")
    eq "$mode" "$actual"
  done
}
test_interior_fences() {
  local code=$'const text = `\n```ts\nconst a = 1;\n```\n`;\n'
  configure "$code"; writer; success; output_is "$code"
}
test_file_boundaries() {
  printf NO_TRAILING_NEWLINE > "$CALLER/a & \"b\" <c>.ts"
  bulk "$CALLER/a & \"b\" <c>.ts"; success
  captured '.stdin | contains("a &amp; &quot;b&quot; &lt;c&gt;.ts") and contains("NO_TRAILING_NEWLINE\n</file>\n")'
}
test_final_answer() {
  configure 'final answer'
  config_patch '.events = [.events[0], (.events[1] | .willRetry=true |
    .messages[0].content=[{type:"text",text:"old answer"}]), .events[1]]'
  bulk; success; output_is $'final answer\n'
}
test_rejected_events() {
  local filter
  for filter in \
    '.events[-1].willRetry=true' \
    '.events[-1].type="message_end"' \
    '.events[-1].messages=[]' \
    'del(.events[-1].messages[0].stopReason)' \
    '.events += [{type:"agent_start"}]' \
    '.events[-1].messages[0].content=[{type:"toolCall",name:"bash"}]'; do
    configure 'must not be written'; config_patch "$filter"
    writer --target "$TARGET"; unchanged
  done
}
test_stop_reasons() {
  local reason
  for reason in length error aborted toolUse; do
    configure 'incomplete code' "$reason"
    writer --target "$TARGET"; unchanged
  done
  configure 'old answer'
  config_patch '.events += [(.events[-1] | .messages[0].stopReason="error")]'
  writer --target "$TARGET"; unchanged
}
test_bad_streams() {
  local raw
  for raw in '' 'not JSON' '{"type":"agent_end"' '[]' 'null'; do
    jq -n --arg raw "$raw" '{raw:$raw}' > "$FAKE_PI_CONFIG"
    writer --target "$TARGET"; unchanged
  done
  configure 'old answer'
  config_patch '{raw: ((.events | map(tojson) | join("\n")) + "\nbroken JSON\n")}'
  writer --target "$TARGET"; unchanged
}
test_empty_or_unclosed_code() {
  local text
  for text in '' $' \n\t' $'```\n```' $'```ts\n\n```' $'```ts\n' $'```ts\nconst unfinished ='; do
    configure "$text"; writer --target "$TARGET"; unchanged
  done
}
test_stderr_and_exit() {
  configure 'answer'
  config_patch '.stderr="warning from Pi\n"'
  bulk; success; output_is $'answer\n'
  config_patch '.exit_code=7 | .stderr="provider auth failed\n"'
  writer --target "$TARGET"; unchanged
  assert grep -Fq 'provider auth failed' "$ERR"; assert grep -Fq '7' "$ERR"
}
test_large_stdin() {
  head -c 150000 /dev/zero | tr '\0' x > "$SOURCE"
  bulk; success
  captured --rawfile source "$SOURCE" \
    '(.stdin | contains($source)) and (.args | join(" ") | length < 10000)'
}
test_limits() {
  head -c 400001 /dev/zero | tr '\0' x > "$SOURCE"
  bulk; before_pi; assert grep -Fq 400000 "$ERR"
  printf 'small file\n' > "$SOURCE"
  SHUNT_MAX_PAYLOAD_BYTES=10 bulk; before_pi; assert grep -Fq 10 "$ERR"
}
test_invalid_limits() {
  local value
  for value in 0 -1 1.5 bad; do
    SHUNT_MAX_PAYLOAD_BYTES="$value" bulk; before_pi; assert grep -Fq SHUNT_MAX_PAYLOAD_BYTES "$ERR"
  done
  for value in 0 -1 bad nan inf; do
    SHUNT_TIMEOUT_SECONDS="$value" bulk; before_pi; assert grep -Fq SHUNT_TIMEOUT_SECONDS "$ERR"
  done
}
test_bad_arguments() {
  invoke bulk-read.sh --question; before_pi
  invoke bulk-read.sh --question Q --paths; before_pi
  bulk --typo; before_pi
  invoke code-write.sh --spec; before_pi
  invoke code-write.sh --spec S --reference; before_pi
  writer --target; before_pi
  writer --typo; before_pi
  invoke bulk-read.sh --question Q --paths missing.ts; before_pi; assert grep -Fq missing.ts "$ERR"
  invoke code-write.sh --spec S --reference missing.ts --target "$TARGET"; before_pi
  eq 'keep this file' "$(cat "$TARGET")"
  PI_BIN='./missing pi' bulk; before_pi; assert grep -Fq 'missing pi' "$ERR"
}
test_argument_compatibility() {
  local pattern="$CALLER/pattern file.ts" first_target="$CALLER/first target.ts" flag
  printf 'export const pattern = 7;\n' > "$pattern"
  printf 'keep the first target\n' > "$first_target"
  invoke bulk-read.sh --question 'Old question.' --paths "$SOURCE" \
    --question 'Final question.' --paths "$pattern"
  success
  captured '.stdin | contains("Question: Final question.") and
    (contains("Old question.") | not) and contains("export const original = 42;") and
    contains("export const pattern = 7;") and
    (index("export const original = 42;") < index("export const pattern = 7;"))'
  configure 'export const replacement = 8;'
  invoke code-write.sh --target "$first_target" --reference "$SOURCE" --spec 'Old spec.' \
    --target "$TARGET" --reference "$pattern" --spec 'Final spec.'
  success; output_is ''
  eq 'keep the first target' "$(cat "$first_target")"
  eq 'export const replacement = 8;' "$(cat "$TARGET")"
  captured '.stdin | contains("Spec: Final spec.") and (contains("Old spec.") | not) and
    contains("export const original = 42;") and contains("export const pattern = 7;") and
    (index("export const original = 42;") < index("export const pattern = 7;"))'
  invoke bulk-read.sh --question $' \t\n' --paths "$SOURCE"; before_pi
  invoke code-write.sh --spec $' \t\n' --reference "$SOURCE"; before_pi
  for flag in --spec --reference --target; do
    bulk "$flag" ignored; before_pi
  done
  for flag in --question --paths; do
    writer "$flag" ignored; before_pi
  done
}
test_timeout() {
  config_patch '.spawn_child=true | .delay=5'
  # Start the short watchdog after the fixture creates the child under test.
  # The outer guard still bounds fixture startup and this readiness wait.
  sleep() {
    if [ "$1" = 0.3 ]; then
      until [ -s "$FAKE_PI_CAPTURE.child.pid" ]; do command sleep 0.01; done
    fi
    command sleep "$@"
  }
  export -f sleep
  SHUNT_TIMEOUT_SECONDS=0.3 writer --target "$TARGET"
  unchanged; assert grep -Eiq 'timed out|timeout' "$ERR"
  assert test -s "$FAKE_PI_CAPTURE.child.pid"
  sleep 1.1
  if [ -e "$FAKE_PI_CAPTURE.child-survived" ]; then
    kill "$(cat "$FAKE_PI_CAPTURE.worker.pid")" 2>/dev/null || true
    fail 'A child process survived the timeout'
  fi
}

tests=(bulk flags settings settings_edits invalid_settings relative_paths shared_settings \
  role_settings code target_permissions interior_fences file_boundaries final_answer rejected_events stop_reasons \
  bad_streams empty_or_unclosed_code stderr_and_exit large_stdin limits invalid_limits bad_arguments argument_compatibility timeout)
[ "$#" -eq 0 ] || tests=("$@")
for name in "${tests[@]}"; do
  if (setup; "test_$name") > "$WORKDIR/test.log" 2>&1; then
    printf '  PASS  %s\n' "$name"
    PASSED=$((PASSED + 1))
  else
    printf '  FAIL  %s\n' "$name"
    cat "$WORKDIR/test.log"
    FAILED=$((FAILED + 1))
  fi
done
printf '## %s %s\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
