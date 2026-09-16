#!/bin/bash
# SessionStart hook for design-spec-tracker.
#
# Needs nothing but a shell. macOS ships no Node, so a designer on a stock Mac
# must still get this context. Everything here is bash 3.2, grep, and awk.
#
# The plugin is enabled in every project of everyone who installs it, so this
# hook must be free when it has nothing to say. A project without a
# `design-specs/` folder costs one directory test and exits with empty stdout,
# which adds no context. It never fails a session: any surprise exits 0.
#
# Output, only in a project that tracks specs, is one JSON object on stdout:
#   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":…}}

set -uo pipefail

SPEC_DIR_NAME="design-specs"
MAX_LISTED=8
ACTIVATION="design-spec-tracker is active in this project. Load the design-spec-tracker skill before replying to any turn about a screen, component, flow, state, or design decision; it keeps the developer spec current without being asked."

INPUT=""
if [ ! -t 0 ]; then
  INPUT="$(cat 2>/dev/null || true)"
fi

# Project dir: the hook's stdin `cwd`, then CLAUDE_PROJECT_DIR, then the shell cwd.
PROJECT="$(printf '%s' "$INPUT" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
PROJECT="${PROJECT:-${CLAUDE_PROJECT_DIR:-$PWD}}"

SPEC_DIR="$PROJECT/$SPEC_DIR_NAME"
[ -d "$SPEC_DIR" ] || exit 0
[ -r "$SPEC_DIR" ] || exit 0

# One record per spec: feature, status, covered, open questions, proposed.
# A single awk pass over every file; FNR==1 flushes the previous file.
STATS="$(awk '
  function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
  function flush(  i, name) {
    if (curfile == "") return
    covered = 0
    for (i = 1; i <= 9; i++) {
      name = handoff[i]
      if (seen[name] && !placeholder[name]) covered++
    }
    if (feature == "") { feature = curfile; sub(/\.md$/, "", feature) }
    if (status == "") status = "draft"
    printf "%s\t%s\t%d\t%d\t%d\n", feature, status, covered, openq, proposed
  }
  function reset(  k) {
    feature = ""; status = ""; section = ""; infm = 0; fmdone = 0
    openq = 0; proposed = 0; oqnone = 0
    split("", seen); split("", placeholder); split("", nonblank); split("", firstline)
  }
  BEGIN {
    handoff[1] = "Overview";                handoff[2] = "Layout"
    handoff[3] = "Design Tokens Used";      handoff[4] = "Components"
    handoff[5] = "States and Interactions"; handoff[6] = "Responsive Behavior"
    handoff[7] = "Edge Cases";              handoff[8] = "Animation / Motion"
    handoff[9] = "Accessibility Notes"
    for (i = 1; i <= 9; i++) ishandoff[handoff[i]] = 1
    reset()
  }
  FNR == 1 {
    flush()
    reset()
    curfile = FILENAME
    sub(/^.*\//, "", curfile)
  }
  # Frontmatter is the first --- delimited block.
  FNR == 1 && $0 == "---" { infm = 1; next }
  infm && $0 == "---" { infm = 0; fmdone = 1; next }
  infm {
    if (match($0, /^feature[[:space:]]*:/)) {
      feature = trim(substr($0, index($0, ":") + 1)); gsub(/^["'"'"']|["'"'"']$/, "", feature)
    } else if (match($0, /^status[[:space:]]*:/)) {
      status = trim(substr($0, index($0, ":") + 1)); gsub(/^["'"'"']|["'"'"']$/, "", status)
    }
    next
  }
  /^## / {
    section = trim(substr($0, 4))
    if (!seen[section]) { seen[section] = 1; first[section] = 1 } else { first[section] = 0 }
    next
  }
  section != "" && first[section] {
    line = trim($0)
    if (line != "") {
      nonblank[section]++
      if (nonblank[section] == 1) firstline[section] = line
      placeholder[section] = (nonblank[section] == 1 && firstline[section] == "_Not covered yet._")
    }
    if (ishandoff[section]) {
      tmp = $0
      proposed += gsub(/\[proposed\]/, "", tmp)
    }
    if (section == "Open Questions") {
      if (line == "_None._" && nonblank[section] == 1) oqnone = 1
      if (line != "") oqnone = (nonblank[section] == 1 && firstline[section] == "_None._")
      if ($0 ~ /^- \[ \]/) openq++
    }
  }
  END { flush() }
' "$SPEC_DIR"/*.md 2>/dev/null)"

# Open Questions counts only when the section is not exactly `_None._`; a
# `_None._` section has no `- [ ]` lines, so the count is already zero.

COUNT=0
if [ -n "$STATS" ]; then
  COUNT=$(printf '%s\n' "$STATS" | grep -c . || true)
  COUNT=${COUNT:-0}
fi

if [ "$COUNT" -eq 0 ]; then
  SPEC_LINE="Specs in $SPEC_DIR_NAME/: none yet."
elif [ "$COUNT" -gt "$MAX_LISTED" ]; then
  SUMMARY="$(printf '%s\n' "$STATS" | awk -F'\t' '
    { if (!(($2) in c)) { order[++n] = $2 }; c[$2]++ }
    END {
      out = ""
      for (i = 1; i <= n; i++) out = out (i > 1 ? ", " : "") c[order[i]] " " order[i]
      print out
    }')"
  SPEC_LINE="Specs in $SPEC_DIR_NAME/: $COUNT ($SUMMARY). Run scripts/validate.mjs --summary for the list."
else
  SPEC_LINE="Specs in $SPEC_DIR_NAME/: $(printf '%s\n' "$STATS" | awk -F'\t' '
    {
      if ($2 != "draft") { item = $1 " (" $2 ")" }
      else {
        item = $1 " (draft, " $3 "/9 covered"
        if ($4 > 0) item = item ", " $4 " open"
        if ($5 > 0) item = item ", " $5 " proposed"
        item = item ")"
      }
      out = out (NR > 1 ? "; " : "") item
    }
    END { print out }')."
fi

# Project facts from tracker.json. A flat file the skill writes itself, so a
# tolerant field read is enough and avoids depending on jq.
TRACKER="$SPEC_DIR/tracker.json"
# Reads one string field, honouring JSON escapes. A plain regex grab is wrong
# twice over: it leaves `\\` doubled, and it stops at the first quote character,
# so an escaped quote silently truncates the value. `\uXXXX` is passed through
# as written rather than decoded; these four fields are plain prose.
fact() {
  [ -r "$TRACKER" ] || return 0
  awk -v key="$1" '
    { buf = buf $0 "\n" }
    END {
      pat = "\"" key "\""
      at = index(buf, pat)
      if (at == 0) exit
      rest = substr(buf, at + length(pat))
      if (!sub(/^[[:space:]]*:[[:space:]]*/, "", rest)) exit
      if (substr(rest, 1, 1) != "\"") exit
      rest = substr(rest, 2)
      n = length(rest)
      i = 1
      while (i <= n) {
        c = substr(rest, i, 1)
        if (c == "\\") {
          e = substr(rest, i + 1, 1)
          if (e == "n") out = out "\n"
          else if (e == "t") out = out "\t"
          else if (e == "r") out = out "\r"
          else if (e == "b" || e == "f") out = out " "
          else if (e == "u") { out = out substr(rest, i, 6); i += 6; continue }
          else out = out e
          i += 2
          continue
        }
        if (c == "\"") break
        out = out c
        i++
      }
      printf "%s", out
    }
  ' "$TRACKER" 2>/dev/null
}
FACTS=""
add_fact() {
  value="$(fact "$1")"
  [ -n "$value" ] || return 0
  FACTS="${FACTS:+$FACTS }$2: $value."
}
add_fact developer "Developer"
add_fact stack "Stack"
add_fact tokens "Design tokens"
add_fact tracker "Tracker"
if [ -z "$FACTS" ]; then
  FACTS="Project facts (developer, stack, tokens) are not set in $SPEC_DIR_NAME/tracker.json."
fi

# Escape for a JSON string, then join the three lines with \n.
CONTEXT="$(printf '%s\n%s\n%s\n' "$ACTIVATION" "$SPEC_LINE" "$FACTS" \
  | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' \
  | awk 'BEGIN { ORS = "" } { if (NR > 1) printf "\\n"; print }')"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$CONTEXT"
