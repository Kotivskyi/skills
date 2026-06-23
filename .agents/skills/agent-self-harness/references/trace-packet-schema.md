# Trace Packet Schema

Normalizers emit a JSON array of packets. Each packet represents one source trace or one cohesive issue/run slice. The extractor can summarize and redact, but it must not decide what the weakness is.

## Required Shape

```json
[
  {
    "traceId": "codex:fixture-session",
    "source": "codex",
    "scope": { "kind": "session", "id": "fixture-session" },
    "task": { "goal": "short user-visible task goal" },
    "outcome": { "status": "failed", "signals": ["test_failed"] },
    "timeline": [],
    "failures": [],
    "userInterventions": [],
    "artifacts": [],
    "redactions": [],
    "rawPointers": []
  }
]
```

## Allowed Sources

- `codex`
- `claude-code`
- `paperclip`
- `external`

## Field Notes

- `traceId`: stable id combining source and source-local id.
- `source`: one of the allowed source values.
- `scope`: source-local scope, such as session, time window, issue, run, or explicit file.
- `task.goal`: the best short task statement recoverable from the trace.
- `outcome.status`: `succeeded`, `failed`, `blocked`, `partial`, or `unknown`.
- `outcome.signals`: short machine-friendly signals such as `test_failed`, `user_correction`, `tool_error`, `missing_artifact`, or `timeout`.
- `timeline`: ordered compact events with `timestamp`, `actor`, `kind`, `summary`, and optional `details`.
- `failures`: extracted observable failures, not inferred root causes.
- `userInterventions`: user corrections, redirects, approvals, or stop requests.
- `artifacts`: produced or modified files, commits, reports, branches, worktrees, or external objects.
- `redactions`: redaction notes with `kind`, `count`, and optional `example`.
- `rawPointers`: local-only pointers back to raw records, line numbers, API endpoints, or session ids.

## Redaction Defaults

Redact secrets, tokens, authorization headers, private URLs, long file contents, and environment variable values by default. Keep a redaction note so the weakness miner knows evidence was removed deliberately.
