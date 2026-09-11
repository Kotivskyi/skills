#!/bin/bash
# Shared Bash support for the Pi CLI. Modified from Spotify Shunt; see NOTICE.

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

cleanup() {
  for pid in "${pi_pid:-}" "${watchdog_pid:-}"; do
    [ -z "$pid" ] || kill -KILL -- "-$pid" 2>/dev/null || true
  done
  [ -z "${output_tmp:-}" ] || rm -f "$output_tmp"
  [ -z "${work:-}" ] || rm -rf "$work"
}

shunt_prepare() {
  local text_option files_option label instruction= files=()
  role="$1"
  target=
  shift
  case "$role" in
    bulk-reader) text_option=--question files_option=--paths label=Question ;;
    code-writer) text_option=--spec files_option=--reference label=Spec ;;
  esac
  while [ "$#" -gt 0 ]; do
    case "$1" in
      "$text_option") [ "$#" -ge 2 ] || die "$1 needs a value."; instruction="$2"; shift 2 ;;
      "$files_option")
        shift
        [ "$#" -gt 0 ] && [[ "$1" != --* ]] || die "$files_option needs a file."
        while [ "$#" -gt 0 ] && [[ "$1" != --* ]]; do files+=("$1"); shift; done ;;
      --target)
        [ "$role" = code-writer ] || die "Unknown argument: $1"
        [ "$#" -ge 2 ] || die '--target needs a value.'
        target="$2"; shift 2 ;;
      *) die "Unknown argument: $1" ;;
    esac
  done
  [[ "$instruction" =~ [^[:space:]] ]] || die "$text_option is required."
  [ "${#files[@]}" -gt 0 ] || die "$files_option is required."

  command -v jq >/dev/null || die 'jq is required.'
  pi_bin=$(type -P -- "${PI_BIN-pi}") || die "Pi executable not found: ${PI_BIN-pi}"
  case "$pi_bin" in /*) ;; *) pi_bin="$(pwd -P)/$pi_bin" ;; esac
  settings="$PLUGIN_ROOT/.pi/settings.json"
  jq -es 'length == 1 and (.[0] | type == "object")' "$settings" >/dev/null 2>&1 ||
    die "Cannot load Pi settings: $settings (expected a JSON object)."
  max_bytes="${SHUNT_MAX_PAYLOAD_BYTES-400000}"
  seconds="${SHUNT_TIMEOUT_SECONDS-180}"
  [[ "$max_bytes" =~ ^[0-9]+$ ]] && [ "$max_bytes" -gt 0 ] ||
    die 'SHUNT_MAX_PAYLOAD_BYTES must be a positive integer.'
  [[ "$seconds" =~ ^([0-9]+([.][0-9]*)?|[.][0-9]+)$ ]] &&
    awk -v value="$seconds" 'BEGIN {exit !(value > 0)}' ||
    die 'SHUNT_TIMEOUT_SECONDS must be a positive number.'
  if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
    case "$PI_CODING_AGENT_DIR" in
      '~') PI_CODING_AGENT_DIR="$HOME" ;;
      '~/'*) PI_CODING_AGENT_DIR="$HOME/${PI_CODING_AGENT_DIR#\~/}" ;;
      /*) ;;
      *) PI_CODING_AGENT_DIR="$(pwd -P)/$PI_CODING_AGENT_DIR" ;;
    esac
    export PI_CODING_AGENT_DIR
  fi
  work=$(mktemp -d)
  pi_pid= watchdog_pid= output_tmp=
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  : > "$work/prompt"
  shunt_files "${files[@]}"
  printf '%s: %s\n' "$label" "$instruction" >> "$work/prompt"
  if [ "$role" = code-writer ]; then printf 'Target path: %s\n' "$target" >> "$work/prompt"; fi
}

shunt_files() {
  local path escaped
  for path in "$@"; do
    [ -f "$path" ] && [ -r "$path" ] || die "File not found or unreadable: $path"
    [ "$(wc -c < "$path")" -le "$max_bytes" ] || die "File exceeds the $max_bytes byte limit: $path"
    escaped=$(jq -nr --arg path "$path" '$path | @html')
    printf '<file path="%s">\n' "$escaped" >> "$work/prompt"
    cat < "$path" >> "$work/prompt"
    printf '\n</file>\n\n' >> "$work/prompt"
  done
}

shunt_pi() {
  local system_prompt="$1" prefix key common value option rc=0 bytes
  bytes=$(wc -c < "$work/prompt")
  [ "$bytes" -le "$max_bytes" ] || die "Request is over the $max_bytes byte limit. Send fewer or smaller files."
  local args=(--print --mode json --no-session --approve --no-tools --no-extensions
    --no-skills --no-prompt-templates --no-context-files --no-themes
    --system-prompt "$system_prompt" --append-system-prompt '')
  prefix="SHUNT_$(printf '%s' "$role" | tr '[:lower:]-' '[:upper:]_')"
  for option in PROVIDER MODEL THINKING; do
    key="${prefix}_$option" common="SHUNT_PI_$option"
    value="${!key:-${!common:-}}"
    [ -z "$value" ] || args+=("--$(printf '%s' "$option" | tr '[:upper:]' '[:lower:]')" "$value")
  done

  # Each background job gets its own process group, including its children.
  set -m
  (cd "$PLUGIN_ROOT"; exec "$pi_bin" "${args[@]}" < "$work/prompt") > "$work/events" 2> "$work/errors" &
  pi_pid=$!
  (sleep "$seconds"; : > "$work/timed-out"; kill -KILL -- "-$pi_pid" 2>/dev/null || true) < /dev/null &
  watchdog_pid=$!
  set +m
  wait "$pi_pid" 2>/dev/null || rc=$?
  kill -KILL -- "-$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  watchdog_pid=
  [ ! -f "$work/timed-out" ] || die "Pi timed out after ${seconds}s. Raise SHUNT_TIMEOUT_SECONDS or split the task."
  if [ "$rc" -ne 0 ]; then
    cat "$work/errors" >&2
    die "Pi failed (exit $rc)."
  fi

  # Pi can exit zero on model errors or truncation. Accept only a completed answer.
  jq -enj '
    reduce inputs as $e (null;
      if ($e | type) != "object" then error("Invalid Pi event")
      elif $e.type == "agent_start" then null
      elif $e.type == "agent_end" then $e else . end)
    | if . == null or .willRetry == true then error("No completed Pi answer") else . end
    | .messages | if type != "array" then error("Invalid Pi messages") else . end
    | map(select(type == "object" and .role == "assistant")) | last
    | if .stopReason != "stop" then error(.errorMessage // .stopReason // "No completed assistant answer") else . end
    | .content | if type != "array" then error("Invalid Pi content") else . end
    | map(if .type == "text" and (.text | type) == "string" then .text
          elif .type == "thinking" then "" else error("Invalid Pi text") end) | join("")
    | if test("\\S") then . else error("Pi returned no text") end
  ' "$work/events" > "$work/answer" || { cat "$work/errors" >&2; die 'Pi returned an invalid or incomplete answer.'; }
  if [ -n "$(tail -c 1 "$work/answer")" ]; then printf '\n' >> "$work/answer"; fi
  printf '[shunt: ~%s input tokens | delegated to Pi %s]\n' "$((bytes / 4))" "$role" >&2
}
