# Evidence record

`evidence.jsonl` holds one JSON object per line. One object is one episode. An extractor writes the record. `merge-summaries.mjs` fills `summary` and can fill `outcome`. No other step edits the record.

## Episode

- A Claude Code session is one episode. Its subagent sidechains belong to the same episode.
- An archived OpenSpec change is one episode.
- A new source defines its episode in its source document.

## Fields

| Field | Type | Rule |
| :--- | :--- | :--- |
| `id` | string | `<source>:<stable key>`. It starts with the source name and a colon. It is the same in every run. |
| `source` | string | The adapter name. It must be in `KNOWN_SOURCES` in `audit-evidence.mjs`, or the audit needs `--allow-source`. |
| `project` | string or null | The absolute project path. |
| `startedAt` | ISO string or null | The first timestamp. |
| `endedAt` | ISO string or null | The last timestamp. |
| `days` | string array | Each UTC day (`YYYY-MM-DD`) with activity. It is empty only when the source has no dates. |
| `title` | string | A short title. `Unknown` when the source gives no title and no intent. |
| `intents` | array of `{ text, pointer }` | Only text that a human wrote, in order. Each text has 600 characters or less. |
| `skillsInvoked` | array of `{ name, count, sidechain }` | Skills that fired. `sidechain` is `true` for calls in a subagent. |
| `commandsUsed` | array of `{ name, count }` | Slash commands that the user typed, with the leading `/`. |
| `toolsUsed` | object | Tool call counts by tool name. |
| `commandPatterns` | array of `{ pattern, count }` | The first two tokens of a shell command, when the second token is not a flag or a path. |
| `userCorrections` | array of `{ text, pointer }` | A heuristic. User text that corrects the agent. The first intent is never a correction. |
| `repeatedInstructions` | array of `{ text, pointer }` | A heuristic. User text of 80 characters or more with "always", "never", "remember", "you need to", "make sure", or "first ... then". |
| `artifacts` | string array | Files or capabilities that the episode touched. 50 or less. |
| `outcome` | string | `completed`, `partial`, `abandoned`, or `unknown`. |
| `size` | object | `userMessages`, `assistantMessages`, `toolCalls`, and `bytes`, all numbers. Claude sessions add `sidechainToolCalls`. |
| `digest` | string or null | The digest path, relative to the run folder. |
| `summary` | object or null | `null` until `merge-summaries.mjs` fills it. See `summary-schema.md`. |
| `redactions` | array of `{ kind, count }` | How many values each redaction rule removed. |

## Pointer

A pointer is `{ "file": "<absolute path>", "line": <line number, from 1> }`. It names the source line that holds the text. `verify-suggestion.mjs` reads the line again before Gate 2. For a JSONL line, it compares the quote with the message text of that one record. For a text file, it compares the quote with that line and the next 4 lines.

## Example

```json
{
  "id": "claude-sessions:03e7c691-22f4-42fd-9919-480a352267a3",
  "source": "claude-sessions",
  "project": "/Users/me/workspace/pastorix-backend",
  "startedAt": "2026-09-04T10:12:03.000Z",
  "endedAt": "2026-09-04T14:38:51.000Z",
  "days": ["2026-09-04"],
  "title": "Engineering plugin with skills",
  "intents": [
    { "text": "Lets wrap our skills in engineering plugin ...", "pointer": { "file": "/Users/me/.claude/projects/-Users-me-workspace-pastorix-backend/03e7c691-22f4-42fd-9919-480a352267a3.jsonl", "line": 3 } }
  ],
  "skillsInvoked": [ { "name": "superpowers:brainstorming", "count": 1, "sidechain": false } ],
  "commandsUsed": [ { "name": "/plan", "count": 1 } ],
  "toolsUsed": { "Bash": 120, "Edit": 9, "Skill": 3 },
  "commandPatterns": [ { "pattern": "pnpm test", "count": 4 } ],
  "userCorrections": [ { "text": "no, use pnpm not npm", "pointer": { "file": "...", "line": 88 } } ],
  "repeatedInstructions": [ { "text": "remember: always run contracts:check before ...", "pointer": { "file": "...", "line": 40 } } ],
  "artifacts": [ "contracts/openapi/MAINTENANCE.md" ],
  "outcome": "unknown",
  "size": { "userMessages": 76, "assistantMessages": 393, "toolCalls": 210, "sidechainToolCalls": 12, "bytes": 3800000 },
  "digest": "digests/claude-sessions__03e7c691-22f4-42fd-9919-480a352267a3.md",
  "summary": null,
  "redactions": [ { "kind": "api_key", "count": 1 } ]
}
```

## Rules

- Extractors summarize and redact. They never decide what a skill should be.
- Strip the `<command-name>`, `<local-command-caveat>`, and `<system-reminder>` wrappers.
- Never copy tool results, file contents, or raw store lines.
- `audit-evidence.mjs` checks every field above. A missing field, a wrong type, or an `id` without its source prefix is `malformed_record`, and it blocks the run.

## Redaction

Every extractor and digest writer applies these rules. `redactions` counts them.

| Kind | Removes |
| :--- | :--- |
| `env_secret` | `NAME_API_KEY=...`, `..._TOKEN=...`, `..._SECRET=...`, `..._PASSWORD=...` |
| `api_key` | `sk-...` keys |
| `authorization` | `Bearer <token>` |
| `private_url` | URLs on `private`, `internal`, or `*.internal` hosts |
| `email` | Email addresses |
| `long_token` | Hex runs of 32 or more characters. Base64 runs of 32 or more characters that mix uppercase letters, lowercase letters, and digits and do not look like a path. |
