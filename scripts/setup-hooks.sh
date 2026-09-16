#!/bin/sh
# Point git at the repo's tracked hooks (.githooks). Run once after cloning.
# core.hooksPath is local git config and cannot be committed, so each clone
# must run this (or `git config core.hooksPath .githooks`) to get the hooks.
set -eu

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR"

git config core.hooksPath .githooks
echo "core.hooksPath set to .githooks"
echo "pre-commit will keep .agents/skills and .claude/skills in step with skills/"
