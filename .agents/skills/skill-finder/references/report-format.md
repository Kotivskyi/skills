# Report format

The judgment step writes two files: `suggestions.json` for the scripts and `report.md` for the user.

## suggestions.json

- `id` is `sf-<YYYYMMDD>-<NN>`, from the run date and the rank.
- `signal` is copied from the first candidate: `cluster`, `named-skill`, or `family`.
- `candidateKeys` lists the `aggregate.json` candidate keys that the suggestion came from. The eval harvest and the next run use it.
- `evidence` holds 3 to 8 entries. Each `quote` is a short redacted excerpt of an intent or a correction, copied from `evidence.jsonl`. Each `pointer` is copied from the same record.
- `catalogChecked` lists each pre-match skill with a verdict in a few words.
- `catalogMatch` is the qualified name of the target skill for `silent-skill` and `misfiring-skill`, and `null` for `new-skill`.
- `rejected` lists the candidates that you rejected, with a reason.

```json
{
  "runId": "20260922-181000-pastorix",
  "generatedAt": "2026-09-22T18:30:00.000Z",
  "suggestions": [
    {
      "id": "sf-20260922-01",
      "rank": 1,
      "kind": "new-skill",
      "signal": "family",
      "title": "Deploy the sim runner to staging and verify it",
      "kindReason": "No catalog skill covers the deploy steps, and the user repeats them each week.",
      "confidence": "high",
      "candidateKeys": ["deploy sim runner to staging"],
      "recurrence": { "episodes": 7, "distinctDays": 5, "sources": ["claude-sessions", "openspec-archive"] },
      "cost": { "median": 143, "score": 1001, "corrections": 4 },
      "catalogChecked": [ { "qualifiedName": "gateway-sim-running", "overlap": 0.41, "invokedInEpisodes": 0, "verdict": "different scope" } ],
      "catalogMatch": null,
      "evidence": [ { "episodeId": "claude-sessions:...", "quote": "deploy the sim runner to staging again and check grafana", "pointer": { "file": "...", "line": 12 } } ],
      "proposal": {
        "name": "deploy-sim-runner",
        "description": "...",
        "triggerPhrases": ["deploy the sim runner", "push the simulator to staging"],
        "outline": ["build", "deploy", "verify dashboards", "report"],
        "change": null
      },
      "provenance": {
        "runId": "20260922-181000-pastorix",
        "sources": [ { "type": "claude-sessions", "store": "~/.claude/projects/-Users-me-workspace-pastorix-backend", "since": "2026-06-01", "until": null } ],
        "catalogSnapshot": { "roots": ["..."], "skillCount": 61, "hash": "sha256:..." },
        "episodeIds": ["..."]
      }
    }
  ],
  "rejected": [ { "key": "rotate grafana token", "reason": "1 episode" } ]
}
```

`proposal` for each kind:

| Kind | `name`, `description`, `triggerPhrases`, `outline` | `change` |
| :--- | :--- | :--- |
| `new-skill` | Filled | `null` |
| `silent-skill` | `null`, `null`, trigger phrases to add, `[]` | `{ "skill", "path", "origin", "descriptionBefore", "descriptionAfter" }` |
| `misfiring-skill` | `null`, `null`, `[]`, `[]` | `{ "skill", "path", "origin", "learningsEntry" }` |

`descriptionBefore` is the exact current description from `catalog.json`. `descriptionAfter` keeps the old meaning and adds the missing trigger phrases. `learningsEntry` follows `learnings-format.md`.

## report.md

Use these sections in this order. Keep each quote short.

```markdown
# Skill suggestions: <runId>

Window: <since> to <until>. Sources: <source: episodes, ...>. Summaries: <backend, or "skipped: <reason>">.

## Suggestions

| Rank | Id | Kind | Title | Episodes | Days | Cost | Score | Catalog match | Confidence |
| ---: | :--- | :--- | :--- | ---: | ---: | ---: | ---: | :--- | :--- |
| 1 | sf-20260922-01 | new-skill | Deploy the sim runner to staging | 7 | 5 | 143 | 1001 | none | high |

## sf-20260922-01: Deploy the sim runner to staging

- Kind: new-skill. <kindReason>
- Signal: family. <family description, the named skill, or the cluster key>
- Recurrence: 7 episodes on 5 days. Sources: claude-sessions, openspec-archive.
- Cost: median 143, score 1001, corrections 4.
- Catalog checked: gateway-sim-running (overlap 0.41, fired 0 times): different scope.
- Evidence:
  - "deploy the sim runner to staging again and check grafana" (`<file>:12`)
- Proposal: <name, description, trigger phrases, outline; or the exact change>
- Next step: pick this id to verify it and build its evals.

## Previous run

| Id | Title | Status | New episodes |
| :--- | :--- | :--- | ---: |

## Catalog usage

Never invoked in this window: <names>.

| Skill | Origin | Episodes | Last used |
| :--- | :--- | ---: | :--- |

## Rejected

| Key | Reason |
| :--- | :--- |

## Limitations

- Audit warnings: <code: count, ...>.
- Redactions: <kind: count, ...>.
- Summaries: <backend>, <merged> merged, <missing> missing. Or: skipped, because <reason>.
- Families: <backend>, <count> families, <assigned> episodes assigned. Or: skipped, because <reason>.
- Skipped sources: <names, or none>.
- Thresholds: 3 episodes on 2 days, merge at Jaccard 0.6, a family holds at most half of the episodes.
- The run folder holds redacted work history. Keep it out of git.
```

When no candidate passes, write the header and a line that says no candidate passed the rule. Then write the Previous run, Catalog usage, Rejected, and Limitations sections.
