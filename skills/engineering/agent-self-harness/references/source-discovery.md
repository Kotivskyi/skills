# Source Discovery

Use this reference after the user chooses a generic trace source.

## Codex Local Sessions

Local paths on this Mac:

```text
~/.codex/session_index.jsonl
~/.codex/sessions/YYYY/MM/DD/*.jsonl
~/.codex/sessions/YYYY/MM/DD/*.jsonl.zst
~/.codex/archived_sessions/*.jsonl
~/.codex/archived_sessions/*.jsonl.zst
```

Common discovery modes:

- Last day: search dated session folders from the last 24 hours.
- Last week: search the last 7 calendar days.
- Last month: search the last 30 calendar days.
- Exact session id: consult `session_index.jsonl`, then open the matching session JSONL.
- Current repo: filter session metadata or turn context by `cwd`.

Many session files are zstd files (`.jsonl.zst`). Each file name starts with `rollout-<timestamp>-<id>`.

The archive folder has no dated subfolders. Also search it for a time window or an exact session id:

- For a day, week, or month window, select archived files by the date in the file name. Then give `--since` and `--until` to the normalizer. It filters by the record timestamp.
- For an exact session id, match the `<id>` in the file name.

Use `scripts/normalize_codex_session.mjs` to emit trace packets from chosen JSONL files. It also reads `.jsonl.zst` files. If the Node version has no zstd support, the script stops and tells you how to decompress the file.

Each subagent thread has its own file. The packet id is the thread id (`payload.id` of `session_meta`), not the root session id (`payload.session_id`).

## Codex Sessions on a Remote Host

Codex on a remote host uses the same layout under `~/.codex/` on the host. Copy each folder to this Mac before you normalize it:

```bash
rsync -a <ssh-alias>:.codex/sessions/ ~/codex-transcripts/<host>/sessions/
rsync -a <ssh-alias>:.codex/archived_sessions/ ~/codex-transcripts/<host>/archived_sessions/
```

- The host can have no archive folder. Then the second command gives an error. Continue with the files that you have.
- The host can have no `session_index.jsonl`. To find an exact session id, match the `<id>` in the file name.

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

A session that runs on another machine writes its transcripts on that machine. This is true for a desktop app SSH session and for the Claude Code CLI on the host. The layout on the host is the same as for local sessions:

```text
~/.claude/projects/<encoded-project-path>/<session-id>.jsonl                       # the session
~/.claude/projects/<encoded-project-path>/<session-id>/subagents/agent-<id>.jsonl  # a subagent
~/.claude/projects/<encoded-project-path>/<session-id>/tool-results/               # large tool outputs
```

- The encoded folder name is the path on the host, with each `/` and each `.` changed to `-`. For example, `/home/<user>/<repo>` gives `-home-<user>-<repo>`.
- Each session worktree on the host has its own folder, for example `<project>--claude-worktrees-<name>`. Select every folder whose name starts with the encoded repo path, not only the main checkout.
- A forked or resumed session can keep its subagents under the folder of the other session id.
- Claude Code on the host deletes transcripts older than `cleanupPeriodDays` (default 30 days). Sessions that the Claude desktop app starts can be exempt.
- To keep the history for later runs, set a large `cleanupPeriodDays` in `~/.claude/settings.json` on the host. Ask the user before you change that file.

### App Copy of SSH Sessions

The Claude desktop app also keeps a copy of each SSH session on this Mac. This reference calls it the app copy. Use the app copy first, because it needs no SSH connection.

```text
~/.claude/projects/ssh-<session-id>/<session-id>.jsonl          # the session
~/.claude/projects/ssh-<session-id>/agent-<id>.jsonl            # a subagent
~/.claude/projects/ssh-<session-id>/agent-<id>.meta.json
~/.claude/projects/ssh-<session-id>/workflow-agent-<id>.jsonl   # a workflow subagent, with no meta file
```

- The subagent files are next to the session file. On the host, they are in a `subagents/` subfolder.
- The app copy has no `tool-results/` folder. It can also miss some metadata records at the end of a session file. When you need large tool outputs, copy the session from the host.
- Each session has its own folder, and the folder name does not show the repo. To select the sessions of a repo, read every `cwd` value of the records.
- Select a session when one of its `cwd` values starts with the repo path on the host. This includes `<repo>/.claude/worktrees/<name>`.
- A resumed or forked session file can hold records with more than one `sessionId`. A fork or a resume copies the earlier records first. So the normalizer uses the last `sessionId` in the file. Do not filter such a file with `--session-id`.
- The file time of an app copy is not the time of the session. For a day, week, or month window, use `--since` and `--until`. They filter by the record `timestamp`, and they keep records that have no `timestamp`.
- The app copy holds the sessions that the desktop app opened over SSH. The user can also run Claude Code on the host in a different way, for example with the CLI. Then copy the files from the host too. Ask the user if you are not sure.

### Copy From the Host

Copy the files to this Mac before you normalize them. This reference calls the result the host copy. Use the SSH alias that reaches the host:

```bash
rsync -a <ssh-alias>:.claude/projects/ ~/claude-transcripts/<host>/
```

- A full host copy can be large. To copy less, copy only the folders of the repo, one folder at a time.
- An access proxy can open a browser login at the first connection. Tell the user before the first connection. Run the copy in the foreground, so that the user can complete the login.

Then use the host copy as a Claude Code source with `scripts/normalize_claude_session.mjs`. The host copy is raw trace data: keep it local, and ask before raw inspection. On a shared host, other accounts with root can read the files.

### Normalize a Remote Session

- Use the same script for the session file and for each subagent file. Make one output file for each input file.
- A subagent packet has its own `traceId`: `claude-code:<session-id>:agent-<agent-id>`. Its `scope` is `{ "kind": "subagent", "id": "<agent-id>" }`.
- Do not use `--project-path` to select the sessions of a repo. It keeps the records whose `cwd` is exactly that path, and all records that have no `cwd`. It removes the records from a subfolder or from another worktree.
- A wrong `--project-path`, for example a path on this Mac, gives no error. The packet then holds only records that have no `cwd`. Make sure that the timeline has `user_message` events.
- An app copy holds metadata records of the desktop app, for example `api-request` and `bridge-session`. They become timeline events, and some of them can show as failures.

## Find a Session by Id or Text

The session search tool and a text search read raw transcript text. Ask the user before you use them, as "Raw Trace Access" says. Show only ids and file paths.

In the Claude desktop app, the session search tool (`search_session_transcripts`) searches local sessions and SSH sessions. A result gives a title, a `cwd`, part of the text, and a `local_<id>` value. That value is the id of the app session, not the transcript id.

To get the transcript id, read the app session file:

```text
~/Library/Application Support/Claude/claude-code-sessions/*/*/local_<id>.json
```

- `cliSessionId` is the transcript id. For an SSH session, the transcript is `~/.claude/projects/ssh-<cliSessionId>/<cliSessionId>.jsonl`. For a local session, it is `~/.claude/projects/<encoded-project-path>/<cliSessionId>.jsonl`.
- `sshRemoteTranscriptPath` is the path of the transcript on the host.
- The file is an internal file of the app. Read only these fields, and make sure that they exist.

If you have no app session id, search the transcripts for a short phrase. Use a phrase with no quote marks and no line breaks, because the JSONL files escape them:

```bash
grep -rlF --include='*.jsonl' -- '<phrase>' ~/.claude/projects/
```

## Sources Not Covered

This reference does not cover cloud sessions, for example Claude Code on the web or Codex cloud tasks. If the user selects one, tell the user. Ask for a normalized trace packet file, and follow "Explicit Trace Packets".

The user can have a JSONL export in the Claude Code or Codex format. Normalize it with the script for that source first.

## Explicit Trace Packets

If the user provides a normalized packet path, run `scripts/check_trace_packets.mjs` first. If validation fails, stop and report the field errors. Do not try to mine weaknesses from malformed packets.

## Raw Trace Access

Raw traces stay local. If compact redacted packets are insufficient and raw inspection is needed, ask explicitly and explain which source records will be opened.
