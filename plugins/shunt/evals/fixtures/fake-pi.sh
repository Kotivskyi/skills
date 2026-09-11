#!/bin/bash
# A local Pi double. It captures the request and returns configured JSON events.
set -euo pipefail
printf '%s\n' "$$" > "$FAKE_PI_CAPTURE.worker.pid"
cat > "$FAKE_PI_CAPTURE.stdin"
jq -n --rawfile stdin "$FAKE_PI_CAPTURE.stdin" \
  --arg cwd "$PWD" --arg agent_dir "${PI_CODING_AGENT_DIR:-}" \
  --slurpfile settings .pi/settings.json --args \
  '{args: $ARGS.positional, stdin: $stdin, cwd: $cwd,
    settings: $settings[0], agent_dir: $agent_dir}' -- "$@" > "$FAKE_PI_CAPTURE"
if jq -e '.spawn_child // false' "$FAKE_PI_CONFIG" >/dev/null; then
  (sleep 1; printf 'survived' > "$FAKE_PI_CAPTURE.child-survived") &
  printf '%s\n' "$!" > "$FAKE_PI_CAPTURE.child.pid"
fi
sleep "$(jq -r '.delay // 0' "$FAKE_PI_CONFIG")"
if jq -e 'has("raw")' "$FAKE_PI_CONFIG" >/dev/null; then
  jq -jr '.raw' "$FAKE_PI_CONFIG"
else
  jq -c '.events[]' "$FAKE_PI_CONFIG"
fi
jq -jr '.stderr // ""' "$FAKE_PI_CONFIG" >&2
exit "$(jq -r '.exit_code // 0' "$FAKE_PI_CONFIG")"
