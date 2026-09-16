---
name: authoring-skills
description: Conventions for building skills in this repo, covering how a skill switches itself on in someone's project. Use when creating a new skill here, adding a SessionStart hook or a setup script to an existing one, wrapping instructions in a tagged block inside a user's CLAUDE.md or AGENTS.md, or deciding whether a skill needs any activation plumbing at all. Consult it before writing anything that edits a file the user owns or that installs itself, because those need the user's explicit yes first.
---

## Purpose

This repo ships skills to other people's machines. Most of the damage a skill can do is not in its instructions; it is in the plumbing around them, in a hook that runs in every project or a script that writes into a file the user owns.

This skill covers that plumbing. For the craft of writing the instructions themselves, and the test-first loop that proves they work, use the `superpowers:writing-skills` skill. The two do not overlap.

[`design-spec-tracker`](../design-spec-tracker/SKILL.md) is the worked example for everything below.

## Ask before you auto-install

**Never add a setup script, a hook, or anything else that writes into the user's files unless the user said yes to that specific thing.**

A setup script edits a file its owner did not ask you to touch. Most skills need nothing of the sort: a good `description` is the whole activation mechanism, and adding plumbing on top is noise the user has to maintain. When you are asked to build a skill, you are not thereby authorized to install it.

So when the plumbing looks genuinely useful, propose it. Say in one sentence what it would write, into which file, and when it would run. Then wait. If the answer does not come, ship the skill without it; a skill with no installer is complete, and the installer can be added in a minute later.

This holds even when the plumbing is obviously convenient, even when you already wrote it, and even when the same user approved a similar script before. Approval does not carry across skills.

## How a skill becomes active

Take the first option that works. Each step down costs the user something more.

| Option | Cost to the user | Use when |
| :--- | :--- | :--- |
| Nothing, just the `description` | none | The default. The model finds the skill from the description alone. |
| A gated SessionStart hook | a few lines of context, and only in matching projects | The skill must fire on turns the user would not think to name, or it needs project state in context at session start. |
| A tagged block in the user's instructions file | permanent lines in a file they own | Hooks are unavailable, or the instruction must survive without the plugin. |

The second and third are not exclusive. `design-spec-tracker` uses both: the hook carries live state, the block carries the standing instruction and the reason the skill exists.

## Tagged blocks

When a skill must place instructions inside someone's `CLAUDE.md` or `AGENTS.md`, wrap them in a matching tag pair named after the skill:

```markdown
<my-skill>
…the skill's instructions…
</my-skill>
```

The tags earn their place twice. A person scanning their own instructions sees exactly where your text starts and stops, so nothing of yours is mistaken for theirs. And a script can replace the block later without parsing prose or guessing at boundaries.

Keep exactly one copy of the text, in `assets/<name>-block.md` inside the skill. Every other mention points at that file or prints it with the script. Do not paste the block into the skill body or a reference doc: the copies drift within a day, and then nobody knows which one the script installs.

## Setup scripts

A setup script has one job, to make the target file correct, and it must be safe to run on every session.

- **Default mode repairs.** Insert the block when it is missing, create the file when the file is missing, replace the block when an older version is there, and do nothing when it is already correct.
- **Touch nothing outside the tags.** Content before and after the block survives byte for byte.
- **Offer `--check`.** Verify and write nothing, exit 1 when missing or stale. This is what a precheck or CI calls.
- **Offer `--print`.** Emit the canonical block so docs never need their own copy.
- **Refuse to guess.** A mismatched or duplicated tag means a human edited the block and left it broken. Report which file and what is wrong, change nothing, exit 2.
- **Be idempotent.** Two runs in a row leave the file identical, and the second one says so.

Use exit 0 for correct or written, 1 for a `--check` failure, 2 for an IO error or damage a person must resolve.

### Pick a runtime the user already has

A script the user runs is useless if their machine cannot run it. macOS ships no Node, and Claude Code's native installer brings none, so a designer or writer on a stock Mac has no way to execute a `.mjs` file. Ruling out a whole audience is a poor trade for nicer JSON handling.

So split the scripts by who runs them:

| Who runs it | Assume | Because |
| :--- | :--- | :--- |
| The person the skill serves | a shell, plus `grep`, `sed`, `awk` | Present on any macOS or Linux box, with nothing to install |
| A developer, or CI | Node, Python, whatever the repo already needs | They have a toolchain and a `package.json` |

Write the user-facing script for `bash` 3.2, the version macOS still ships, and test it with `/bin/bash` rather than a Homebrew bash. Test it again with a bare environment, `env -i PATH=/usr/bin:/bin`, to prove the dependency is really gone.

Watch for tools that differ between BSD and GNU. The macOS `awk` rejects a variable named `close` because that is a builtin function, `sed -i` takes an argument it does not take on Linux, and `cat -A` and `grep -P` do not exist. A script that only ran under Homebrew tools is not a shell script you can ship.

## Hooks

Declare hooks in `hooks/hooks.json` at the repo root; Claude Code discovers that file on its own. A hook there runs for everyone who installs the plugin, in every project, so it must cost nothing when it has nothing to say:

- Gate it with a cheap shell test before starting an interpreter. A missing marker directory should cost one `test -d`, not a Node startup.
- Exit 0 with empty stdout when it does not apply. Empty stdout adds no context.
- Exit 0 when a tool is missing or the input is malformed. A hook must never break an unrelated session.
- Keep the emitted context to a few lines regardless of project size. Summarize past a threshold rather than listing.

Measure the idle path before you ship it. If you cannot state the cost in a project the skill does not serve, you do not know whether the hook is safe to ship.

## Checklist

- [ ] Does this skill need activation plumbing at all, or is the description enough?
- [ ] If it needs a script or a hook, did the user say yes to it?
- [ ] Is the block text in `assets/`, with no second copy anywhere?
- [ ] Are the tags named after the skill and matched?
- [ ] Does the script repair, check, print, refuse on damage, and run twice cleanly?
- [ ] Can the person it is written for actually run it, tested under `/bin/bash` and a bare `PATH`?
- [ ] Does the hook cost nothing in a project it does not serve, and did you measure that?
- [ ] Registered in `plugin.json`, the bucket `README.md`, and the top-level `README.md`?
