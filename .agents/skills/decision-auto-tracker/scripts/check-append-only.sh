#!/usr/bin/env bash
# check-append-only.sh — the decision log is append-only.
#
# For repos that set `"appendOnly": true` in decisions/decision-log.json.
#
# WHY: a decision entry is a record of what was decided, and when. Editing one
# rewrites history in a folder whose whole value is that it does not change. The
# practical failure is a merge conflict: if retiring a decision means editing the
# previous file, any two branches retiring the same decision conflict on that
# file. Writing a NEW entry with `supersedes:` never conflicts, because two
# branches write two different paths.
#
# So: files under the log dir may be ADDED. They may not be modified, deleted or
# renamed.
#
# THE ONE PERMITTED EDIT: deleting a `status:` line. In append-only repos status
# is derived from the supersedes graph, not stored. Entries written before that
# rule still carry the field; when such an entry is superseded, the validator asks
# for the line to go. A diff that only deletes `status:` lines is therefore allowed
# — it removes a fact, it does not rewrite one.
#
# USAGE:
#   <skill-dir>/scripts/check-append-only.sh [--log-dir decisions/log] [--base <ref>]
#
# The default base is the merge-base of HEAD with the default branch (origin/HEAD,
# else origin/main, origin/master, main, master). On the default branch itself the
# base is HEAD~1, so a local commit is still checked. The working tree is included,
# so the check sees uncommitted edits too.
#
# EXIT: 0 when the log is append-only, 1 when it is not, 0 when there is no base
# to compare against (a fresh clone with no upstream is not a violation).
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR"

SKILL_SCRIPTS=$(cd "$(dirname "$0")" && pwd)
LOG_DIR="decisions/log"
BASE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --log-dir) LOG_DIR="${2:-}"; shift 2 ;;
        --base) BASE="${2:-}"; shift 2 ;;
        -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
        *) echo "usage: $0 [--log-dir <path>] [--base <ref>]" >&2; exit 2 ;;
    esac
done

default_base() {
    local ref="" mb=""
    ref=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)
    if [ -z "$ref" ]; then
        for c in origin/main origin/master main master; do
            if git rev-parse -q --verify "$c" >/dev/null 2>&1; then ref="$c"; break; fi
        done
    fi
    [ -z "$ref" ] && return 0
    mb=$(git merge-base HEAD "$ref" 2>/dev/null || true)
    if [ -n "$mb" ] && [ "$mb" = "$(git rev-parse HEAD)" ]; then
        mb=$(git rev-parse -q --verify HEAD~1 2>/dev/null || true)
    fi
    echo "$mb"
}

if [ -z "$BASE" ]; then
    BASE=$(default_base)
fi
[ -z "$BASE" ] && exit 0   # nothing to compare against
[ -d "$LOG_DIR" ] || exit 0

# Base vs WORKING TREE, so an uncommitted edit is caught at the same moment a
# committed one is. -M asks git to report renames as R rather than as add+delete.
changes=$(git diff -M --diff-filter=MDR --name-status "$BASE" -- "$LOG_DIR" || true)
[ -z "$changes" ] && exit 0

fail=0
report=""

while IFS=$'\t' read -r kind file rest; do
    [ -n "${kind:-}" ] || continue
    case "$kind" in
        M*)
            # Allowed only when every changed line deletes a `status:` field.
            hunk=$(git diff "$BASE" -- "$file" | grep -E '^[+-]' | grep -Ev '^(\+\+\+|---)' || true)
            added=$(printf '%s\n' "$hunk" | grep -c '^+' || true)
            other_removed=$(printf '%s\n' "$hunk" | grep '^-' | grep -cvE '^-status:[[:space:]]' || true)
            if [ "$added" -eq 0 ] && [ "$other_removed" -eq 0 ]; then
                continue
            fi
            report="$report
  MODIFIED  $file"
            fail=1
            ;;
        D*)
            report="$report
  DELETED   $file"
            fail=1
            ;;
        R*)
            report="$report
  RENAMED   $file -> ${rest:-?}"
            fail=1
            ;;
    esac
done <<EOF_CHANGES
$changes
EOF_CHANGES

if [ "$fail" -ne 0 ]; then
    cat >&2 <<MSG
The decision log is append-only, and these entries changed since $(git rev-parse --short "$BASE"):
$report

Write a NEW entry instead:

    node $SKILL_SCRIPTS/new-decision.mjs "Title of the new decision" --supersedes <old-id>

The old entry stays exactly as it was written. Its status is derived from the
supersedes graph, so nothing has to be edited to retire it.

The only edit this check permits is deleting a legacy \`status:\` line, which the
validator asks for when the stored value contradicts the graph.
MSG
    exit 1
fi
exit 0
