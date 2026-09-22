# skill-finder design

Date: 2026-09-22
Status: approved design, not yet implemented
Location: `skills/engineering/skill-finder/`

## 1. Purpose

`skill-finder` reads work history from sources the user names, finds recurring work, compares it with the installed skill catalog, and produces ranked skill suggestions. It stops at a report. The user picks one suggestion. The skill then verifies it, harvests evals for it, and applies it after a second approval.

The skill is reusable. It is not tied to one repository. Each source is an adapter with its own knowledge document and extractor script. The first source is Claude Code sessions. The second is OpenSpec archives. New sources follow one contract.

### Goals

- Cross-session aggregation. Many files in, one evidence file out.
- Dedup against the catalog. Every suggestion names the catalog skills it checked.
- Ranking by frequency and cost.
- Three suggestion kinds, each with a concrete output.
- Evals for every applied suggestion, in the `skill-creator` format, with a target of at least 50 cases.
- Provenance on every suggestion, and staleness across runs.
- Raw history stays local. The report holds redacted summaries and pointers only.

### Non-goals

- The skill does not create a skill on its own. `new-skill` goes through `skill-creator`.
- The skill does not commit, push, or merge.
- The skill does not edit plugin cache copies.
- The skill does not read raw sessions into the main context.
- The skill does not explain harness failures. That is `agent-self-harness` and `agent-weakness-miner`.

## 2. Suggestion kinds

| Kind | Meaning | Output |
| :--- | :--- | :--- |
| `new-skill` | Recurring work. No catalog skill covers it. | A `skill-creator` handoff brief with harvested evals. |
| `silent-skill` | A catalog skill matches the work. It never fired in those episodes. | An exact description edit, old text and new text, with a trigger eval set. |
| `misfiring-skill` | A skill fired. The user corrected the agent in the same episode, repeatedly. | A `## Learnings` entry in that skill, with behavior evals. |

## 3. Pipeline

```
sources ──extract──▶ evidence.jsonl + digests/ ──audit──▶ ok
   ──summarize (Pi | subagent | none)──▶ summaries/ ──merge──▶ evidence.jsonl
catalog roots ──index──▶ catalog.json
evidence.jsonl + catalog.json + previous run ──aggregate──▶ aggregate.json
aggregate.json ──judge (model)──▶ suggestions.json + report.md
        ──Gate 1: user picks one──▶ verify ──▶ harvest evals ──▶ Gate 2: user approves brief ──▶ apply
```

Every run writes to one folder:

```
<cwd>/.skill-finder/runs/<YYYYMMDD-HHMMSS>-<slug>/
├── run.json                 sources, flags, window, backend, versions
├── evidence.jsonl           one episode per line
├── digests/<episode-id>.md  compact redacted text per episode
├── summaries/batch-NN.json  raw summary batches from the backend
├── evidence-audit.json
├── catalog.json
├── aggregate.json
├── suggestions.json
├── report.md
├── verify-<id>.json         written at Gate 1 for the picked suggestion
├── evals-<id>/              harvested evals for the picked suggestion
└── apply-<id>/              staged edits for plugin-origin skills
```

`--out <dir>` overrides the run folder. The skill warns when `.skill-finder/` is not in `.gitignore`. It does not edit `.gitignore`.

## 4. Skill layout

```
skills/engineering/skill-finder/
├── SKILL.md
├── references/
│   ├── evidence-schema.md
│   ├── summary-schema.md
│   ├── adapter-contract.md
│   ├── sources/
│   │   ├── claude-sessions.md
│   │   └── openspec-archive.md
│   ├── ranking.md
│   ├── report-format.md
│   ├── gate-brief.md
│   ├── learnings-format.md
│   └── eval-harvest.md
├── scripts/
│   ├── lib/                 shared helpers: args, jsonl, redact, tokens, paths
│   ├── extract-claude-sessions.mjs
│   ├── extract-openspec-archive.mjs
│   ├── audit-evidence.mjs
│   ├── check-summaries.mjs
│   ├── merge-summaries.mjs
│   ├── index-catalog.mjs
│   ├── aggregate.mjs
│   ├── verify-suggestion.mjs
│   ├── harvest-evals.mjs
│   ├── *.test.mjs           one test file per script
│   └── fixtures/            small synthetic inputs, see section 17
└── evals/
    ├── evals.json           behavior cases for skill-finder itself
    ├── trigger-eval.json    does the description fire
    └── fixtures/            run folders and catalogs for the eval cases
```

All scripts are Node ES modules with no dependencies outside Node 18 or later. Each script prints one JSON line on stdout as its summary. Exit codes: 0 success, 1 usage or validation failure, 2 missing or unreadable input.

## 5. Evidence record

`evidence.jsonl` holds one JSON object per line. One object is one episode. A Claude Code session is one episode. An archived OpenSpec change is one episode.

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
    { "text": "Lets wrap our skills in engineering plugin ...", "pointer": { "file": "/Users/me/.claude/projects/.../03e7c691.jsonl", "line": 3 } }
  ],
  "skillsInvoked": [ { "name": "superpowers:brainstorming", "count": 1, "sidechain": false } ],
  "commandsUsed": [ { "name": "/plan", "count": 1 } ],
  "toolsUsed": { "Bash": 120, "Edit": 9, "Skill": 3 },
  "commandPatterns": [ { "pattern": "pnpm test", "count": 4 } ],
  "userCorrections": [ { "text": "no, use pnpm not npm", "pointer": { "file": "...", "line": 88 } } ],
  "repeatedInstructions": [ { "text": "remember: always run contracts:check before ...", "pointer": { "file": "...", "line": 40 } } ],
  "artifacts": [ "contracts/openapi/MAINTENANCE.md" ],
  "outcome": "unknown",
  "size": { "userMessages": 76, "assistantMessages": 393, "toolCalls": 210, "bytes": 3800000 },
  "digest": "digests/claude-sessions__03e7c691.md",
  "summary": null,
  "redactions": [ { "kind": "api_key", "count": 1 } ]
}
```

Field rules:

- `id` starts with the source name and a colon. It is stable across runs.
- `days` lists every calendar day the episode touches, in UTC. It is empty only when the source has no dates.
- `intents` holds user-authored text only, in order, each truncated to 600 characters. Wrappers such as `<command-name>`, `<local-command-caveat>`, and `<system-reminder>` are stripped or skipped.
- `userCorrections` and `repeatedInstructions` come from heuristics in the extractor. They are hints. The summary layer is the better signal.
- `outcome` is one of `completed`, `partial`, `abandoned`, `unknown`.
- `summary` is `null` until `merge-summaries.mjs` fills it. Its shape is in section 6.
- Extractors summarize and redact. They never decide what a skill should be.

The full field list lives in `references/evidence-schema.md`.

## 6. Digests and episode summaries

### Digests

Each extractor writes `digests/<episode-id>.md`. A digest is compact, redacted text for one episode:

- the title, the source, the project, and the time range;
- every user message in order, each truncated to 600 characters;
- the assistant's final message per turn, truncated to 300 characters;
- skill and tool calls as one-liners, for example `[tool] Bash: pnpm test` or `[skill] superpowers:brainstorming`;
- for OpenSpec, the proposal and the tasks.

A digest never holds tool results or file contents. It is capped at 24 KB. When the raw text is longer, the digest keeps the first 16 KB and the last 8 KB and marks the cut.

### Summaries

One backend reads digests and returns summaries. The skill picks the first backend available, in this order:

1. `shunt:bulk-reader`. Pi reads one batch of 10 digests per call and returns one JSON array.
2. The `Agent` tool. A subagent does the same batch when Shunt is not installed.
3. None. The run continues on heuristic fields. The report states that summaries were skipped.

Before the summarize step the skill states the digest count, the total size, and the expected call count. It continues on the user's yes. `--since`, `--until`, and `--max-episodes` bound the run.

One summary per episode, in `references/summary-schema.md`:

```json
{
  "episodeId": "claude-sessions:03e7c691-22f4-42fd-9919-480a352267a3",
  "goal": "Package engineering skills as a Claude Code plugin",
  "outcome": "completed",
  "procedures": [
    { "name": "sync skill mirrors", "steps": ["edit skills/<bucket>/<name>", "run sh scripts/sync-agents.sh"], "taughtByUser": true }
  ],
  "corrections": [
    { "what": "agent hand-edited .claude/skills", "cause": "did not know the tree is generated", "fix": "edit the source tree and run the sync script" }
  ],
  "repeatedManualSteps": ["run the version sync check before commit"],
  "skillCandidates": [ { "name": "sync-skill-mirrors", "why": "the user explained the same two steps twice" } ],
  "skillsThatShouldHaveFired": [ { "name": "authoring-skills", "why": "the session added a hook without reading the conventions" } ],
  "confidence": "high"
}
```

`check-summaries.mjs` validates each batch: required fields, allowed values, `episodeId` present in `evidence.jsonl`, no duplicates. A bad batch retries once. After a second failure those episodes keep `summary: null` and the audit records a `summary_missing` warning.

`merge-summaries.mjs` writes each summary into its episode's `summary` field. It also sets `outcome` from the summary when the extractor left `unknown`.

## 7. Source adapters

### Contract

An adapter is five things. `references/adapter-contract.md` is the checklist.

1. `references/sources/<name>.md`. It states where the data lives, the record shape, which fields carry signal, what to skip, the pitfalls, and the privacy rules.
2. `scripts/extract-<name>.mjs`. Flags: `--out <run-dir>`, `--since <iso>`, `--until <iso>`, `--max-episodes <n>`, plus location flags for the source. It appends to `evidence.jsonl`, writes `digests/`, and prints `{ "source", "episodes", "skipped", "bytes" }`. Exit 2 when the location is missing or unreadable.
3. `scripts/fixtures/<name>/`. A small synthetic input that covers every signal the doc names.
4. `scripts/extract-<name>.test.mjs`. It runs the extractor on the fixture and asserts the records.
5. One eval case in `evals/evals.json` that uses the source.

Record requirements: `id` prefixed with the source name, `days` filled when dates exist, `digest` path set, redaction applied, `intents` from user-authored text only.

### claude-sessions

Location: `~/.claude/projects/<encoded-cwd>/`. The encoded name is the absolute path with every character that is not a letter or a digit replaced by `-`. Flags: `--project <path>` encodes the path, `--store <dir>` names the folder directly, `--session <id>` limits to one session.

Layout: `<session-id>.jsonl` is the main transcript. `<session-id>/subagents/agent-*.jsonl` are sidechains. Both are parsed. Sidechain skill and tool calls count in the parent episode with `sidechain: true`.

Signals:

- `ai-title` or `custom-title` records give the title. The first intent is the fallback.
- `user` records with string content, or text blocks, give intents. Records whose content array holds `tool_result` are skipped. Text that starts with `<local-command-caveat>` is skipped. A `<command-name>` marker becomes a `commandsUsed` entry.
- `assistant` records with `tool_use` blocks give `toolsUsed`. A `Skill` block gives `skillsInvoked` from `input.skill`. A `Bash` block gives `commandPatterns` from the first two tokens of `input.command`, when the second token is not a flag or a path.
- `timestamp` on `user` and `assistant` records gives the time range and `days`.
- Heuristic corrections match a small regex set, for example "no,", "not that", "instead", "you forgot", "should have". Heuristic repeated instructions match "always", "never", "remember", "you need to", "first ... then", with a length of 80 characters or more.

Pitfalls the doc records: `type` is not the first key, so a prefix filter misses every record and a substring filter is required. Single lines can be 50 MB. `attachment`, `file-history-*`, `queue-operation`, and `last-prompt` records repeat or bloat content and are skipped before parsing. A session can span days.

### openspec-archive

Location: `openspec/changes/archive/<YYYY-MM-DD-slug>/`. Flag: `--path <dir>`.

Files: `.openspec.yaml` with `schema` and `created`, `proposal.md` with Why, What Changes, Capabilities, and Impact, `design.md`, `tasks.md` with checkboxes, and `specs/<capability>/spec.md`.

Signals: the folder name gives the archive date and the slug, `created` gives the start day, the Why first paragraph and the first three What Changes bullets give intents, backtick commands in tasks give `commandPatterns`, capability folder names give `artifacts`, and the checkbox ratio gives `outcome`: all checked is `completed`, some checked is `partial`, none checked is `abandoned`.

Pitfalls the doc records: section names vary by schema, sections can be missing, and dates are the only timestamps.

### Follow-up adapters, not in v1

`codex-sessions` from `~/.codex/sessions/`, forked from the self-harness normalizer. `git-log` from commit messages and touched paths. `trace-packets` from `agent-self-harness` output. Each follows the contract above.

## 8. Evidence audit

`audit-evidence.mjs <evidence.jsonl> [--strict] [--allow-source <name>]` writes `evidence-audit.json`.

Errors, which block: `duplicate_id`, `malformed_record` when a required field is missing or has the wrong type, `unknown_source` when the source is not a registered adapter or an allowed name.

Warnings, which lower confidence: `empty_intents`, `low_information_title` for a UUID, an empty title, or "Unknown", `missing_days`, `missing_digest`, `summary_missing` when a backend ran, `high_redaction` when an episode has more than 20 redactions.

`blocking` is true when any error exists. With `--strict` a blocking audit exits 1. The judgment step never runs on a blocking audit. Warnings go into the report's limitations note.

## 9. Catalog index

`index-catalog.mjs [--root <dir> ...] [--no-plugins] [--cwd <dir>]` writes `catalog.json`.

Default roots, in priority order:

| Origin | Root |
| :--- | :--- |
| `repo` | `<cwd>/.agents/skills`, `<cwd>/.claude/skills` |
| `user` | `~/.claude/skills`, `~/.agents/skills` |
| `plugin` | for each install in `~/.claude/plugins/installed_plugins.json`, each plugin's skills — the folders its `.claude-plugin/plugin.json` lists in `skills`, or `installPath/skills/*/SKILL.md` when it lists none |

Extra `--root` folders get origin `repo`.

Each entry: `name`, `namespace` for plugins, `qualifiedName`, `description`, `triggers`, `invocation` from `disable-model-invocation`, `path`, `realPath`, `origin`, `plugin`, `aliases`.

`catalog.json` also has `warnings`. It holds one message for each `installed_plugins.json` or `plugin.json` that does not parse.

Dedup is by `realPath`, because user skills are often symlinks into a repo. The highest-priority origin wins. The other paths go into `aliases`.

Trigger phrases come from the description: clauses after "use when", "use this when", "use whenever", "trigger on", and "when the user", split on commas, "or", and semicolons, plus quoted phrases. Lowercase, 2 to 12 words, at most 30 per skill.

The file also records `roots`, `generatedAt`, `skillCount`, and `hash`, which is a SHA-256 over the sorted qualified names and descriptions.

## 10. Aggregation

`aggregate.mjs --run <dir> [--previous <dir>|auto] [--min-episodes 3] [--min-days 2]` writes `aggregate.json`.

### Clustering keys

Each episode contributes keys from four places: `summary.skillCandidates[].name`, `summary.procedures[].name`, `commandPatterns[].pattern`, and normalized correction text. Keys are lowercased, stop words removed, and stemmed lightly by stripping plural `s`. Two keys merge when their token Jaccard overlap is 0.6 or more. The model can merge clusters further in the judgment step.

### Recurrence rule

A candidate passes when it has at least 3 episodes on at least 2 distinct days. Both numbers are flags. Candidates below the rule are counted in `belowThreshold` and listed in `rejected` with the reason. Two sources for one candidate raise confidence but are not required.

### Cost and score

Cost per episode is `toolCalls + assistantMessages + 3 × corrections`, where corrections is the larger of the heuristic count and the summary count. A candidate's cost is the median over its episodes. Score is `episodes × costMedian`. The report shows frequency, cost, and score as separate columns. The weights are fixed in v1 and stated in `references/ranking.md`.

### Pre-match

For each candidate the aggregator lists the top 3 catalog skills by token overlap between the candidate labels and the skill's description plus triggers, with the overlap value and the count of candidate episodes where that skill was invoked. Names from `summary.skillsThatShouldHaveFired` are added with `named: true`.

### Kind hint

- `misfiring-skill` when one catalog skill was invoked in at least `minEpisodes` of the candidate's episodes and those episodes hold corrections.
- `silent-skill` when a catalog match has overlap of 0.3 or more, or is named, and was invoked in none of the episodes.
- `new-skill` otherwise.

The model confirms or changes the kind in the judgment step.

### Catalog usage

For every catalog skill: `invocations`, `episodes`, `lastUsed`, and `neverInvoked` over the run window.

### Previous run

With `--previous auto` the aggregator loads the newest earlier run under `.skill-finder/runs/`. Each earlier suggestion gets one status:

- `resolved`: a catalog skill now covers it, by the proposed name or by overlap of 0.5 or more with the proposed description.
- `still-open`: new episodes since that run match the candidate.
- `stale`: no new episodes match.

## 11. Judgment and ranking

The judgment step is in `SKILL.md`. It runs in the main context because it needs the catalog and the whole aggregate.

1. Read `aggregate.json`. Do not read `evidence.jsonl` whole.
2. For each candidate that passed the rule, open its evidence records and, when needed, its digests. Open nothing else.
3. Assign the kind. Use the hint, the pre-match, and the summaries. State the reason in one sentence.
4. Assign confidence: `high` with 5 or more episodes and summaries present, `medium` with 3 or 4 episodes or heuristic-only evidence, `low` when audit warnings touch most of the episodes.
5. Write the proposal. For `new-skill`: name, one-line description, trigger phrases, and an outline. For `silent-skill`: the exact description before and after. For `misfiring-skill`: the Learnings entry text.
6. Rank by score, then distinct days, then corrections.
7. Reject one-off items and work a catalog skill already handled well. Record each rejection with a reason.
8. Write `suggestions.json` and `report.md`.

`suggestions.json`:

```json
{
  "runId": "20260922-181000-pastorix",
  "generatedAt": "2026-09-22T18:30:00.000Z",
  "suggestions": [
    {
      "id": "sf-20260922-01",
      "rank": 1,
      "kind": "new-skill",
      "title": "Deploy the sim runner to staging and verify it",
      "confidence": "high",
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

For `silent-skill`, `proposal.change` is `{ "skill", "path", "origin", "descriptionBefore", "descriptionAfter" }`. For `misfiring-skill`, it is `{ "skill", "path", "origin", "learningsEntry" }`.

`report.md`, in `references/report-format.md`:

1. Summary table: rank, kind, title, episodes, days, cost, score, catalog match, confidence.
2. One short section per suggestion: evidence quotes with pointers, recurrence, cost, catalog checked, proposal, next step.
3. Previous run: each earlier suggestion with its status.
4. Catalog usage: never-invoked skills and last-used dates.
5. Rejected candidates, one line each.
6. Limitations: audit warnings, redaction counts, the summary backend used or skipped, sources skipped, thresholds.

## 12. Gates and apply

### Gate 1

The skill presents the summary table and stops. The user picks one suggestion id. Nothing is written to any skill before this.

### Verify

`verify-suggestion.mjs --run <dir> --id <id>` writes `verify-<id>.json` with three checks:

- `pointersResolve`: every evidence file exists, the line exists, and the line contains the first 40 characters of the quote after whitespace normalization.
- `catalogUnchanged`: a fresh index has the same hash, or the diff is listed.
- `notNewlyCovered`: no skill added since the run has overlap of 0.5 or more with the proposal description.

`status` is `ok` or `blocked`. A blocked verify stops before Gate 2, and the skill reports the failed check.

### Harvest

`harvest-evals.mjs` runs next. See section 13.

### Gate 2

The skill presents a brief in the shape of `references/gate-brief.md` and stops for an explicit yes:

- the suggestion, its kind, and its evidence summary;
- the verify result;
- the harvest counts: real, synthetic, shortfall;
- the exact change, which is the `skill-creator` handoff for `new-skill`, the description diff for `silent-skill`, or the Learnings entry for `misfiring-skill`;
- risks and rollback, which is `git checkout` of the touched files or removal of the new skill folder.

### Apply rules

- `new-skill`: invoke `skill-creator` with the brief. Copy the harvested `evals/` into the new skill folder once it exists.
- `silent-skill`: replace the description in `SKILL.md`. Merge the trigger set into the skill's `evals/trigger-eval.json`.
- `misfiring-skill`: append the entry under `## Learnings`. Merge the behavior cases into the skill's `evals/evals.json`.
- Only skills with origin `repo` or `user` are edited. A symlink is followed to its target, and the skill says so.
- A plugin-origin skill is never edited. The staged edit goes to `apply-<id>/` in the run folder, and the report names the upstream path.
- No commit, push, or merge. The skill lists the touched files and stops.

### Learnings format

`references/learnings-format.md`. `## Learnings` is the last section of a `SKILL.md`. One entry is one line:

```
- 2026-09-22: The agent used npm in a pnpm workspace. Read the lockfile first and use the matching package manager. Evidence: run 20260922-181000-pastorix, 4 episodes.
```

Two sentences before the evidence. When a section passes 15 entries the skill asks the user to fold entries into the body.

## 13. Eval harvest

`harvest-evals.mjs --run <dir> --id <id> [--target 50] [--out <dir>] [--merge-into <skill evals dir>]` builds evals for the picked suggestion from the same evidence. It runs for all three kinds. `references/eval-harvest.md` holds the rules.

### Files, in the `skill-creator` format

- `evals/trigger-eval.json`: an array of `{ "query", "should_trigger" }`. `run_eval.py` reads only these two fields.
- `evals/trigger-eval.provenance.json`: one entry per query with `episodeId`, `pointer`, and `origin` of `real` or `synthetic`.
- `evals/evals.json`: `{ "skill_name", "evals": [ { "id", "name", "prompt", "expected_output", "files", "expectations", "provenance" } ] }`.

### Sources of cases

- Positives: real user prompts from the suggestion's episodes, plus OpenSpec proposal leads phrased as requests.
- Negatives: near-misses. Real prompts from other episodes whose token overlap with the suggestion's keyword set is between 0.15 and 0.5, preferring episodes in another cluster or where another catalog skill was invoked.
- Behavior cases: the prompt is the episode intent that starts the work. The script writes the skeleton with `expected_output` and `expectations` empty. The model drafts them from `summary.procedures[].steps`, `corrections[].fix`, and `artifacts`. Every expectation must be verifiable: a file exists, a command ran, a text is present.

### Filters

40 to 600 characters, no command or caveat wrappers, no tool results, redaction applied, no email addresses, dedup by normalized text, near-duplicates removed at token overlap of 0.8 or more.

### Target

At least 50 in total: 20 or more should-trigger, 20 or more should-not-trigger, 10 or more behavior cases. Real cases come first. When the data is short the model adds synthetic cases marked `synthetic` in provenance. The Gate 2 brief states the real count and the shortfall. A shortfall does not block.

### Merge into an existing skill

`--merge-into` dedups against the existing queries by normalized text and continues the `id` sequence from the current maximum. Plugin-origin skills get the files in `evals-<id>/` under the run folder instead.

## 14. Privacy and scale

Redaction patterns: environment secrets, `sk-` keys, bearer tokens, private URLs, email addresses, and hex or base64 runs of 32 characters or more. Every extractor and the digest writer apply them. Redaction counts go into the record.

User text is truncated as stated in sections 5 and 6. Tool results and file contents are never copied. The raw store is never copied. Digests hold user text, so the report's limitations note says the run folder must stay out of git.

Extractors stream files line by line. A substring check on `"type":"user"` or `"type":"assistant"` runs before `JSON.parse`. A count pass over the 615 MB pastorix store took under 2 seconds with this filter. Memory stays flat on 53 MB lines.

Summaries run in batches of 10 digests. The call count is the ceiling of episodes over 10.

## 15. SKILL.md procedure

Frontmatter: `name: skill-finder`, model-invoked, no `disable-model-invocation`. The description is model-facing and pushy:

> Find which skills to create or fix from real work history. Use when the user asks what skills are missing, wants skill suggestions, asks why a skill did not fire or keeps going wrong, wants to mine Claude Code sessions, OpenSpec archives, or other work history for recurring tasks, or wants evals built from real prompts for a new or existing skill. Reads the sources the user names, ranks suggestions by frequency and cost, and hands off to skill-creator after approval.

Body, in order:

1. Dependency check. Node 18 or later. `skill-creator` is required only at apply time for `new-skill`. `shunt:bulk-reader` is optional.
2. Select sources and the window. Ask when the user did not name them. Map the answer to extractor flags.
3. Create the run folder and `run.json`.
4. Run each extractor. Show the one-line summaries.
5. Run the audit with `--strict`. Stop on blocking and show the errors.
6. Summaries. Pick the backend. State count, size, and calls. Continue on yes. Run batches, check, retry once, merge.
7. Index the catalog.
8. Aggregate, with `--previous auto`.
9. Judge, per section 11. Write `suggestions.json` and `report.md`.
10. Gate 1. Show the summary table. Stop.
11. On a pick: verify, harvest, Gate 2 brief. Stop.
12. On yes: apply per section 12. List touched files. Stop.

Stop conditions: a missing or unreadable source, a blocking audit, no candidate passes the rule, the user declines at either gate, or a blocked verify. A plugin-origin target does not stop the run; its edit is staged per section 12. When no credible suggestion exists, the report says so. The skill never forces a suggestion.

## 16. Relation to sibling skills

`agent-self-harness` and `agent-weakness-miner` answer "why did the harness fail" from one session at a time. `skill-finder` answers "what skill should exist" from many episodes. It borrows their redaction patterns, the source-prefixed id convention, the audit-before-judgment step, and the two approval gates. It does not depend on them. A `trace-packets` adapter can join the two later.

## 17. Tests

`node --test skills/engineering/skill-finder/scripts/*.test.mjs` runs every test file. Node 22 rejects a directory argument, so pass the shell glob.

Fixtures under `scripts/fixtures/`:

- `claude-sessions/`: two sessions and one subagent folder. They hold a secret to redact, a `<command-name>` marker, a `Skill` call, a `Bash` call, a correction, a repeated instruction, a `queue-operation` duplicate, and a record whose `type` is not the first key.
- `openspec-archive/`: three changes. One has partial tasks. One lacks a design file.
- `catalog/`: a repo root with three skills, a user root with a symlink to one of them, and a fake plugin install with an `installed_plugins.json`.
- `summaries/`: one valid batch and one invalid batch.
- `run/`: a complete small run for the aggregate, verify, and harvest tests, plus a previous run.

Cases per script, at minimum:

- extractors: record count, id prefix, days, redaction count, sidechain counting, skipped records, digest cap, exit 2 on a missing path.
- audit: duplicate id blocks, malformed record blocks, warnings do not block, strict exit code.
- check and merge summaries: invalid batch rejected, valid batch merged, outcome filled.
- index: dedup by real path, origin priority, plugin namespace, trigger extraction.
- aggregate: rule threshold, cost and score, pre-match, kind hint, catalog usage, previous statuses.
- verify: pointer mismatch blocks, catalog change listed, newly covered blocks.
- harvest: counts and ratios, filters, near-miss selection, merge dedup, id continuation, shortfall reported.

## 18. Evals for skill-finder

`evals/evals.json`, 12 cases over fixture runs in `evals/fixtures/`:

1. `new-skill-found`: a recurring uncovered task yields a `new-skill` with evidence pointers.
2. `silent-skill-found`: a matching catalog skill that never fired yields a description edit.
3. `misfiring-skill-found`: a fired skill with repeated corrections yields a Learnings entry.
4. `one-off-rejected`: one episode yields no suggestion and a stated reason.
5. `two-sources-merged`: a session cluster and an archive cluster merge with both sources cited.
6. `unreadable-source-stops`: a missing store stops the run with a clear message and no invented suggestions.
7. `previous-run-statuses`: earlier suggestions get `resolved`, `still-open`, and `stale`.
8. `plugin-origin-not-edited`: the edit is staged in the run folder and the upstream path is named.
9. `verify-failure-blocks-gate2`: a moved pointer blocks the brief.
10. `harvest-reaches-target`: enough real data yields 50 or more cases with no synthetic entries.
11. `harvest-reports-shortfall`: thin data yields fewer real cases, synthetic backfill is marked, and the brief states the shortfall.
12. `no-summary-backend-fallback`: with no Shunt and no subagent, the run continues on heuristics and says so.

`evals/trigger-eval.json` holds at least 20 queries, half should-trigger and half near-miss.

## 19. Repo integration

- Create `skills/engineering/skill-finder/`.
- Add `./skills/engineering/skill-finder` to `.claude-plugin/plugin.json`.
- Add the skill under Model-invoked in `skills/engineering/README.md` and the top-level `README.md`, with the name linked to its `SKILL.md`.
- Run `sh scripts/sync-agents.sh` so the mirrors and the engineering package update.
- Write all prose in ASD-STE100: short sentences, active voice, one meaning per word.
- No hook and no setup script. The description is the activation mechanism.
- Commit straight to `main`.

## 20. Follow-ups, out of scope for v1

- `codex-sessions`, `git-log`, and `trace-packets` adapters.
- A `skill-finder.json` config file that remembers sources and thresholds per repo.
- A scheduled run that posts the summary table.
- Weight tuning for cost and score from real runs.
