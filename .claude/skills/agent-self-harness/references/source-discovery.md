# Source Discovery

Use this reference after the user chooses a generic trace source.

## Codex Local Sessions

Local paths on this Mac:

```text
~/.codex/session_index.jsonl
~/.codex/sessions/YYYY/MM/DD/*.jsonl
```

Common discovery modes:

- Last day: search dated session folders from the last 24 hours.
- Last week: search the last 7 calendar days.
- Last month: search the last 30 calendar days.
- Exact session id: consult `session_index.jsonl`, then open the matching session JSONL.
- Current repo: filter session metadata or turn context by `cwd`.

Use `scripts/normalize_codex_session.mjs` to emit trace packets from chosen JSONL files.

## Claude Code Local Sessions

Local paths on this Mac:

```text
~/.claude/projects/<encoded-project-path>/*.jsonl
```

The project path is encoded by replacing path separators with hyphen-style segments. For this repo the observed project key was:

```text
~/.claude/projects/-Users-vitalii-kotivskyi-workspace-agent-team
```

Common discovery modes:

- Project path: select the encoded project folder for the repo.
- Exact session id: filter records by `sessionId`.
- Last day/week/month: filter record timestamps.
- Subagent/sidechain review: preserve sidechain markers as timeline context.

Use `scripts/normalize_claude_session.mjs` to emit trace packets from chosen JSONL files.

## Claude Code Sessions on a Remote Host

A session that runs on another machine writes its transcripts on that machine, not on this Mac. This is true for a Claude Desktop SSH session and for the Claude Code CLI on a remote host. The layout is the same as for local sessions:

```text
<remote>:~/.claude/projects/<encoded-project-path>/*.jsonl
```

- Each session worktree on the host has its own encoded folder, for example `<project>--claude-worktrees-<name>`. Select every folder of the repo, not only the main checkout.
- Subagent transcripts and large tool outputs are in a folder with the same name as the session file.
- Claude Code on the host deletes transcripts older than `cleanupPeriodDays` (default 30 days). Sessions that Claude Desktop starts can be exempt. To keep the history for later runs, set a large `cleanupPeriodDays` in `~/.claude/settings.json` on the host.

Copy the files to this Mac before you normalize them. Use the SSH alias that reaches the host:

```bash
rsync -a <ssh-alias>:.claude/projects/ ~/claude-transcripts/<host>/
```

Then use the copy as a Claude Code source with `scripts/normalize_claude_session.mjs`. The copy is raw trace data: keep it local, and ask before raw inspection. On a shared host, other accounts with root can read the files.

## Explicit Trace Packets

If the user provides a normalized packet path, run `scripts/check_trace_packets.mjs` first. If validation fails, stop and report the field errors. Do not try to mine weaknesses from malformed packets.

## Raw Trace Access

Raw traces stay local. If compact redacted packets are insufficient and raw inspection is needed, ask explicitly and explain which source records will be opened.
