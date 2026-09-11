#!/bin/bash
# Modified from Spotify Shunt: estimate parent context with native Bash and Pi.
# These estimates exclude Pi token use and provider billing.
set -euo pipefail

eval_root=$(cd "$(dirname "$0")" && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/shunt-benchmark.XXXXXX")
trap 'rm -rf "$temporary"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'printf "Benchmark failed.\n" >&2' ERR

estimate() {
  local count
  count=$(wc -m < "$1" | tr -d '[:space:]')
  printf '%s' "$(((count + 3) / 4))"
}

jq -ce '.benchmarks | if type == "array" and length > 0 then .[]
  else error("benchmarks must be a nonempty array") end' \
  "$eval_root/benchmarks.json" > "$temporary/cases.jsonl"
: > "$temporary/rows"

while IFS= read -r benchmark_case; do
  name=$(jq -er '.name | select(type == "string" and length > 0)' <<< "$benchmark_case")
  kind=$(jq -er '.type' <<< "$benchmark_case")
  printf 'Running %s with Pi...\n' "$name" >&2

  case "$kind" in
    bulk-read)
      request=$(jq -er '.question | select(type == "string" and length > 0)' <<< "$benchmark_case")
      jq -ce '.paths | select(type == "array" and length > 0)
        | if all(.[]; type == "string" and length > 0) then .
          else error("paths must contain file names") end' \
        <<< "$benchmark_case" > "$temporary/paths.json"
      worker=("$eval_root/../scripts/bulk-read.sh" --question "$request" --paths)
      ;;
    code-write)
      request=$(jq -er '.spec | select(type == "string" and length > 0)' <<< "$benchmark_case")
      jq -ce '([.reference] + .context_files)
        | if all(.[]; type == "string" and length > 0) then
            reduce .[] as $path ([]; if index($path) then . else . + [$path] end)
          else error("references must contain file names") end' \
        <<< "$benchmark_case" > "$temporary/paths.json"
      worker=("$eval_root/../scripts/code-write.sh" --spec "$request" --reference)
      ;;
    *) printf 'Benchmark failed: unknown type %s\n' "$kind" >&2; exit 1 ;;
  esac

  jq -j '.[] | ., "\u0000"' "$temporary/paths.json" > "$temporary/paths"
  paths=()
  while IFS= read -r -d '' path; do
    paths+=("$eval_root/$path")
  done < "$temporary/paths"
  worker+=("${paths[@]}")

  : > "$temporary/corpus"
  printf '%s' "$request" > "$temporary/parent-request"
  separator=''
  for path in "${paths[@]}"; do
    printf '%s' "$separator" >> "$temporary/corpus"
    cat "$path" >> "$temporary/corpus"
    if [[ -n "$separator" ]]; then printf ' ' >> "$temporary/parent-request"; fi
    printf '%s' "$path" >> "$temporary/parent-request"
    separator=$'\n'
  done

  if [[ "$kind" == code-write ]]; then
    target="$temporary/generated.ts"
    rm -f "$target"
    worker+=(--target "$target")
    printf '%s' "$target" >> "$temporary/parent-request"
  fi
  if ! "${worker[@]}" > "$temporary/stdout" 2> "$temporary/stderr"; then
    cat "$temporary/stderr" >&2
    printf 'Benchmark failed: %s worker failed\n' "$name" >&2
    exit 1
  fi

  direct_input=$(estimate "$temporary/corpus")
  direct_output=0
  if [[ "$kind" == code-write ]]; then
    if [[ ! -s "$target" ]] || ! grep -q '[^[:space:]]' "$target"; then
      printf 'Benchmark failed: code generation produced an empty target\n' >&2
      exit 1
    fi
    direct_output=$(estimate "$target")
    parent_input=$(estimate "$temporary/stderr")
  else
    parent_input=$(estimate "$temporary/stdout")
  fi
  parent_output=$(estimate "$temporary/parent-request")
  printf '%s | %s | %s | %s | %s\n' \
    "$name" "$direct_input" "$direct_output" "$parent_input" "$parent_output" >> "$temporary/rows"
done < "$temporary/cases.jsonl"

printf 'Scenario | Direct input | Direct output | Shunt parent input | Shunt parent output\n'
cat "$temporary/rows"
printf 'Estimates use characters / 4. Direct output is generated code only.\n'
printf 'Counts exclude tool syntax, later review, Pi tokens, and provider billing.\n'
