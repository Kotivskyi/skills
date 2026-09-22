# Source: claude-sessions

## Location

`~/.claude/projects/<encoded-cwd>/`. The encoded name is the absolute project path with each character that is not a letter or a digit replaced by `-`. For example, `/Users/me.name/work/app` becomes `-Users-me-name-work-app`.

Flags:

- `--project <path>` encodes the path. The default is the current folder.
- `--store <dir>` names a session folder directly. Use it more than one time. Git worktrees have their own folders, such as `<encoded-cwd>--worktree-<name>`. Name each one with `--store` when the user wants them.
- `--session <id>` reads one session.
- `--home <dir>` replaces the home folder. Tests and evals use it.

## Layout

- `<session-id>.jsonl` is the main transcript. One episode.
- `<session-id>/subagents/agent-*.jsonl` are sidechains. Their skill and tool calls count in the parent episode with `sidechain: true`. They never give intents.

## Record types

| `type` | Use |
| :--- | :--- |
| `user` | Human prompts, tool results, skill bodies, and notifications. See below. |
| `assistant` | One record for each content block. `message.id` groups blocks into one message. `tool_use` blocks give tools, skills, commands, and artifacts. |
| `ai-title` | `aiTitle` gives the title. |
| `custom-title` | `customTitle` gives the title. It wins over `aiTitle`. |
| `attachment`, `file-history-snapshot`, `file-history-delta`, `queue-operation`, `last-prompt`, `system`, `mode`, `permission-mode`, `agent-name`, `cost-state` | Skipped. |

## Which `user` records are human

| Record | Human? |
| :--- | :--- |
| String content, or text blocks, with `origin.kind` of `human` or no `origin` | Yes |
| Content with a `tool_result` block | No |
| `isMeta: true` (a skill body that Claude Code injects) | No |
| `isCompactSummary: true` or `isVisibleInTranscriptOnly: true` (a summary that Claude Code writes after compaction) | No |
| `origin.kind` of `task-notification`, `peer`, or `auto-continuation` | No |
| Text that starts with `<local-command-caveat>`, `<local-command-stdout>`, `<bash-input>`, `<bash-stdout>`, or `<task-notification>` | No |
| `<command-name>/x</command-name>` | Adds `/x` to `commandsUsed`. The `<command-args>` text is the intent. |

`<system-reminder>` blocks are removed from human text. `[Request interrupted ...]` is not an intent.

## Signals

| Evidence field | Source |
| :--- | :--- |
| `title` | `customTitle`, then `aiTitle`, then the first line of the first intent |
| `intents` | Human text, in order |
| `skillsInvoked` | `Skill` tool calls, `input.skill` |
| `commandsUsed` | `<command-name>` markers |
| `toolsUsed`, `size.toolCalls` | `tool_use` blocks, main and sidechains |
| `commandPatterns` | `Bash` tool calls, `input.command` |
| `artifacts` | `file_path` of `Write`, `Edit`, `MultiEdit`, `NotebookEdit` |
| `startedAt`, `endedAt`, `days` | `timestamp` on `user` and `assistant` records |
| `userCorrections` | Human text after the first intent that matches "no,", "not that", "instead", "you forgot", "should have", "that's wrong", "I said" |
| `repeatedInstructions` | Human text of 80 characters or more with "always", "never", "remember", "you need to", "make sure", or "first ... then" |

## Pitfalls

- `type` is not always the first key. A prefix filter misses most records. Use a substring filter.
- One line can be 50 MB, usually a tool result. The extractor skips lines that hold `"type":"tool_result"` before `JSON.parse`.
- A session can span days. `days` lists each day with activity.
- A session file can change after its last prompt. The `--since` filter first skips files whose modified time is before the window, then checks `startedAt`.
- In a real store of 164 sessions and 846 MB, the extractor ran in about 2.5 seconds with about 170 MB of memory.

## Privacy

Prompts can hold keys, tokens, email addresses, and private URLs. Redaction runs on intents, titles, command patterns, artifacts, and digest lines. Tool results are never read into evidence or digests.
