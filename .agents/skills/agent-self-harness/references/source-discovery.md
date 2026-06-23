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

## Explicit Trace Packets

If the user provides a normalized packet path, run `scripts/check_trace_packets.mjs` first. If validation fails, stop and report the field errors. Do not try to mine weaknesses from malformed packets.

## Raw Trace Access

Raw traces stay local. If compact redacted packets are insufficient and raw inspection is needed, ask explicitly and explain which source records will be opened.
