#!/bin/bash
# Install or repair the `<design-spec-tracker>` block in a project's CLAUDE.md.
#
# Needs nothing but a shell. A designer's Mac does not ship Node, so this script
# uses only bash, grep, and awk, all of which macOS provides. It is written for
# bash 3.2, the version macOS ships.
#
# The block is wrapped in a matching tag pair so it is obvious where the skill's
# instructions start and stop inside the designer's own, and so this script can
# replace it without touching anything around it.
#
# The canonical text lives in `assets/claude-md-block.md`, one directory up.
# That file is the single source of truth; this script never invents it.
#
# Usage (from the project root):
#   bash <skill-dir>/scripts/setup-claude-md.sh            # insert or repair
#   bash <skill-dir>/scripts/setup-claude-md.sh --check     # verify, write nothing
#   bash <skill-dir>/scripts/setup-claude-md.sh --print     # print the block
#   bash <skill-dir>/scripts/setup-claude-md.sh --file docs/AGENTS.md
#
# Exit codes:
#   0  already correct, or written
#   1  --check found the block missing or stale
#   2  IO error, or a damaged block a human should look at

set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLOCK_FILE="$SKILL_DIR/assets/claude-md-block.md"
OPEN_TAG="<design-spec-tracker>"
CLOSE_TAG="</design-spec-tracker>"

TARGET_REL="CLAUDE.md"
MODE="fix"

fail() { echo "setup-claude-md: $1" >&2; exit 2; }

usage() {
  cat <<USAGE
Usage: bash setup-claude-md.sh [--check] [--print] [--file <path>]

Installs or repairs the $OPEN_TAG block in the target file
(default: CLAUDE.md in the current directory).

  --check   verify only; exit 1 when missing or stale
  --print   print the canonical block and exit
  --file    target a file other than ./CLAUDE.md
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --print) MODE="print" ;;
    --file)
      shift
      [ $# -gt 0 ] || fail "--file needs a path"
      TARGET_REL="$1"
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "setup-claude-md: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -r "$BLOCK_FILE" ] || fail "cannot read the canonical block at $BLOCK_FILE"
CANONICAL="$(cat "$BLOCK_FILE")"
case "$CANONICAL" in
  "$OPEN_TAG"*) ;;
  *) fail "the canonical block does not start with $OPEN_TAG" ;;
esac
case "$CANONICAL" in
  *"$CLOSE_TAG") ;;
  *) fail "the canonical block does not end with $CLOSE_TAG" ;;
esac

if [ "$MODE" = "print" ]; then
  printf '%s\n' "$CANONICAL"
  exit 0
fi

TARGET="$TARGET_REL"
TARGET_DIR="$(dirname "$TARGET")"
[ -d "$TARGET_DIR" ] || fail "the directory for $TARGET_REL does not exist"

if [ -e "$TARGET" ] && [ ! -f "$TARGET" ]; then
  fail "$TARGET_REL is not a regular file"
fi

OPENS=0
CLOSES=0
if [ -f "$TARGET" ]; then
  [ -r "$TARGET" ] || fail "cannot read $TARGET_REL"
  OPENS=$(grep -c "^$OPEN_TAG\$" "$TARGET" 2>/dev/null || true)
  CLOSES=$(grep -c "^$CLOSE_TAG\$" "$TARGET" 2>/dev/null || true)
  OPENS=${OPENS:-0}
  CLOSES=${CLOSES:-0}
fi

# A lone or repeated tag means someone edited the block by hand and left it
# broken. Rewriting around it risks eating their text, so stop and say so.
if [ "$OPENS" -ne "$CLOSES" ]; then
  fail "$TARGET_REL has a damaged $OPEN_TAG block ($OPENS opening, $CLOSES closing tags). Fix it by hand, then re-run."
fi
if [ "$OPENS" -gt 1 ]; then
  fail "$TARGET_REL has $OPENS $OPEN_TAG blocks. Keep one, then re-run."
fi

STATE="missing"
if [ "$OPENS" -eq 1 ]; then
  # `close` is an awk builtin, so the tag variables must not be named for it.
  CURRENT="$(awk -v opentag="$OPEN_TAG" -v closetag="$CLOSE_TAG" '
    $0 == opentag { inblock = 1 }
    inblock { print }
    $0 == closetag && inblock { inblock = 0 }
  ' "$TARGET")"
  if [ "$CURRENT" = "$CANONICAL" ]; then
    STATE="current"
  else
    STATE="stale"
  fi
fi

if [ "$STATE" = "current" ]; then
  echo "setup-claude-md: $TARGET_REL is up to date"
  exit 0
fi

if [ "$MODE" = "check" ]; then
  if [ "$STATE" = "missing" ]; then
    echo "setup-claude-md: $TARGET_REL has no $OPEN_TAG block." >&2
    echo "Run the same command without --check to add it." >&2
  else
    echo "setup-claude-md: the $OPEN_TAG block in $TARGET_REL is out of date." >&2
    echo "Run the same command without --check to repair it." >&2
  fi
  exit 1
fi

TMP="$(mktemp "${TMPDIR:-/tmp}/setup-claude-md.XXXXXX")" || fail "cannot create a temporary file"
trap 'rm -f "$TMP"' EXIT

if [ "$STATE" = "stale" ]; then
  # Replace the block in place. Everything outside the tags is copied verbatim.
  awk -v opentag="$OPEN_TAG" -v closetag="$CLOSE_TAG" -v blockfile="$BLOCK_FILE" '
    $0 == opentag && !skip {
      while ((getline line < blockfile) > 0) print line
      close(blockfile)
      skip = 1
      next
    }
    skip && $0 == closetag { skip = 0; next }
    skip { next }
    { print }
  ' "$TARGET" > "$TMP" || fail "could not rewrite $TARGET_REL"
elif [ ! -f "$TARGET" ] || [ ! -s "$TARGET" ]; then
  printf '%s\n' "$CANONICAL" > "$TMP"
else
  # Append after the existing content, with one blank line between.
  awk '{ lines[NR] = $0 }
    END {
      last = NR
      while (last > 0 && lines[last] ~ /^[[:space:]]*$/) last--
      for (i = 1; i <= last; i++) print lines[i]
    }' "$TARGET" > "$TMP" || fail "could not read $TARGET_REL"
  printf '\n' >> "$TMP"
  printf '%s\n' "$CANONICAL" >> "$TMP"
fi

cat "$TMP" > "$TARGET" || fail "cannot write $TARGET_REL"

if [ "$STATE" = "stale" ]; then
  echo "setup-claude-md: repaired the $OPEN_TAG block in $TARGET_REL"
else
  echo "setup-claude-md: added the $OPEN_TAG block to $TARGET_REL"
fi
