#!/bin/sh
# Strict one-way mirror: `skills/` is the sole source of truth.
#
#   skills/<bucket>/<name>/  ->  .agents/skills/<name>/
#                            ->  .claude/skills/<name>/
#   skills/engineering/<name>/ -> plugins/engineering/skills/<name>/
#   hooks/hooks.json          -> plugins/engineering/hooks/hooks.json
#
# The two dot-trees are GENERATED copies. They exist so agents working inside
# this repo load the same skills the plugin ships. Never edit them by hand:
# edit `skills/<bucket>/<name>/` and run this script. Anything you type into a
# dot-tree is destroyed on the next sync.
#
# The mirror is flat, keyed by skill name, because that is the layout both
# `.agents/skills/` and `.claude/skills/` expect. Buckets exist only in the
# source tree. `deprecated/` and `in-progress/` are never mirrored: they are
# not shipped, and `scripts/link-skills.sh` already skips them for the same
# reason.
#
# Deliberately NOT rsync. macOS ships openrsync and CI runs GNU rsync; a flag
# the two read differently would make the drift check disagree between a laptop
# and CI. `cp -R` and `find` behave the same on both.
#
# Usage:
#   scripts/sync-agents.sh           Regenerate the copies from the working tree
#   scripts/sync-agents.sh --staged  Regenerate from the git index and stage the
#                                    copies (used by the pre-commit hook)
#   scripts/sync-agents.sh --check   Verify the copies are in sync; exit 1 on
#                                    drift, write nothing (used by CI)
set -eu

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR"

SRC_ROOT="skills"
DST_AGENTS=".agents/skills"
DST_CLAUDE=".claude/skills"
DST_ENGINEERING="plugins/engineering"

# Package only engineering skills. Keep all files inside the plugin cache root.
build_engineering() {
    build_mirror "$1/skills/engineering" "$2/skills"
    mkdir -p "$2/hooks"
    sed 's|/skills/engineering/|/skills/|g' "$1/hooks/hooks.json" > "$2/hooks/hooks.json"
}

install_engineering() {
    for component in skills hooks; do
        rm -rf "$DST_ENGINEERING/$component"
        mkdir -p "$DST_ENGINEERING/$component"
        cp -R "$1/$component/." "$DST_ENGINEERING/$component/"
    done
}

# Build a flat mirror of the active skills from $1 into the directory $2.
# Fails loudly on a duplicate skill name, because flattening would otherwise
# silently drop one of them.
build_mirror() (
    src_root=$1
    out=$2
    mkdir -p "$out"
    [ -d "$src_root" ] || return 0

    find "$src_root" -name SKILL.md \
        -not -path '*/deprecated/*' \
        -not -path '*/in-progress/*' \
        -not -path '*/node_modules/*' \
        | sort \
        | while IFS= read -r skill_md; do
            src=$(dirname "$skill_md")
            name=$(basename "$src")
            if [ -e "$out/$name" ]; then
                echo "sync-agents: duplicate skill name '$name' across buckets; rename one." >&2
                exit 1
            fi
            mkdir -p "$out/$name"
            cp -R "$src/." "$out/$name/"
        done

    # Ephemeral build and eval artefacts never belong in a mirror.
    find "$out" -type d \
        \( -name '*-workspace' -o -name 'skill-evals' -o -name 'node_modules' \) \
        -prune -exec rm -rf {} + 2>/dev/null || true
)

install_mirror() {
    # $1 = staging dir holding the freshly built mirror
    for dst in "$DST_AGENTS" "$DST_CLAUDE"; do
        rm -rf "$dst"
        mkdir -p "$dst"
        cp -R "$1/." "$dst/"
    done
}

do_sync() {
    tmp=$(mktemp -d)
    build_mirror "$SRC_ROOT" "$tmp/mirror"
    build_engineering . "$tmp/engineering"
    install_mirror "$tmp/mirror"
    install_engineering "$tmp/engineering"
    rm -rf "$tmp"
    echo "sync-agents: updated $DST_AGENTS, $DST_CLAUDE, and $DST_ENGINEERING"
}

do_staged() {
    # Generate from the git index, not the working tree, so the committed copies
    # always match the committed source. Unstaged edits under skills/ are
    # deliberately ignored until they are staged.
    tmp=$(mktemp -d)
    src="$tmp/src"
    out="$tmp/out"
    mkdir -p "$src" "$out"

    # git write-tree fails on an unmerged index (mid-conflict) — bail clearly.
    tree=$(git write-tree) || {
        echo "sync-agents: cannot build a tree from the index (merge in progress?)." >&2
        rm -rf "$tmp"
        return 1
    }
    git archive "$tree" -- "$SRC_ROOT" hooks/hooks.json | tar -x -C "$src"

    if [ ! -d "$src/$SRC_ROOT" ]; then
        echo "sync-agents: $SRC_ROOT is not in the index; nothing to sync." >&2
        rm -rf "$tmp"
        return 0
    fi

    build_mirror "$src/$SRC_ROOT" "$out"
    build_engineering "$src" "$tmp/engineering"
    install_mirror "$out"
    install_engineering "$tmp/engineering"
    rm -rf "$tmp"
    git add -A -- "$DST_AGENTS" "$DST_CLAUDE" "$DST_ENGINEERING/skills" "$DST_ENGINEERING/hooks"
}

do_check() {
    rc=0
    tmp=$(mktemp -d)
    expected="$tmp/expected"
    build_mirror "$SRC_ROOT" "$expected"
    build_engineering . "$tmp/engineering"

    for dst in "$DST_AGENTS" "$DST_CLAUDE"; do
        if [ ! -d "$dst" ]; then
            echo "DRIFT: $dst is missing"
            rc=1
            continue
        fi
        out=$(diff -r "$expected" "$dst" 2>&1) || true
        if [ -n "$out" ]; then
            echo "DRIFT: $dst is out of sync with $SRC_ROOT"
            printf '%s\n' "$out" | head -40
            rc=1
        fi
    done

    for component in skills hooks; do
        if ! diff -r "$tmp/engineering/$component" "$DST_ENGINEERING/$component"; then
            echo "DRIFT: $DST_ENGINEERING/$component is out of sync"
            rc=1
        fi
    done

    rm -rf "$tmp"
    if [ "$rc" -ne 0 ]; then
        echo "Fix: run scripts/sync-agents.sh and commit the result." >&2
    else
        echo "sync-agents: skill mirrors and engineering package match their sources"
    fi
    return "$rc"
}

case "${1:-}" in
    --check)  do_check ;;
    --staged) do_staged ;;
    "")       do_sync ;;
    *)        echo "usage: $0 [--staged|--check]" >&2; exit 2 ;;
esac
