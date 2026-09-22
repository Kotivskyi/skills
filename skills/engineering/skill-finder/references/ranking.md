# Ranking rules

`aggregate.mjs` applies these rules. The constants are fixed in v1.

## Constants

| Constant | Value | Use |
| :--- | ---: | :--- |
| `MERGE_JACCARD` | 0.6 | Two keys merge into one cluster. |
| `RELATED_JACCARD` | 0.5 | Two candidates share most episodes. |
| `SILENT_OVERLAP` | 0.3 | A catalog skill matches a candidate. |
| `RESOLVED_OVERLAP` | 0.5 | A catalog skill now covers an old suggestion. |
| `NEW_EPISODE_OVERLAP` | 0.6 | A new episode matches an old suggestion. |
| `MISFIRE_LIFT` | 2 | A skill fires in corrected episodes far more than usual. |
| `CORRECTION_WEIGHT` | 3 | The cost of one correction. |
| `PRE_MATCH_TOP` | 3 | Catalog skills listed for each candidate, before named skills. |
| `--min-episodes` | 3 | The recurrence rule. |
| `--min-days` | 2 | The recurrence rule. |
| `--max-candidates` | 40 | Candidates kept in `aggregate.json`. |

## Tokens and measures

- Tokens: lowercase text, split on each character that is not a letter or a digit, drop tokens of one character, drop stop words, and strip a plural `s` when the token has more than 3 characters and does not end in `ss`, `us`, or `is`.
- Jaccard: shared tokens divided by all distinct tokens.
- Overlap: shared tokens divided by the size of the smaller token set.

## Keys and clusters

Each episode gives keys from:

- `summary.skillCandidates[].name`, `summary.procedures[].name`, `summary.corrections[].what`, and `summary.goal`, when a summary exists;
- the `title`, when there is no summary and the title is not empty, `Unknown`, or a UUID;
- each `commandPatterns[].pattern`;
- each `userCorrections[].text`.

A key needs at least 2 tokens. A key joins the first cluster whose first key has Jaccard 0.6 or more with it. Otherwise it starts a new cluster. The cluster key is the most frequent task label, then the shortest.

A task episode joined the cluster through a key that is not a command pattern. The rules below use task episodes only. A cluster with no task episodes is a command cluster. It never becomes a candidate. `commandClusters` lists the top 20. Each candidate lists its `topCommands` and its `commandEpisodes` count.

## Recurrence

A candidate needs at least 3 task episodes on at least 2 distinct UTC days. Other clusters go to `belowThreshold` with a reason. Two sources raise confidence. They are not required.

## Cost and score

- Episode cost: `size.toolCalls + size.assistantMessages + 3 × corrections`. `corrections` is the larger of the heuristic count and the summary count.
- Candidate cost: the median episode cost. For an even count, the mean of the two middle values, rounded.
- Score: `episodes × costMedian`.
- Order: score, then distinct days, then corrections, then key. All high to low, except the key.

The report shows episodes, days, cost, and score in separate columns.

## Pre-match

For each candidate, the index lists the 3 catalog skills with the highest overlap between the candidate tokens and the skill tokens. Skill tokens come from the name, the description, and the trigger phrases. A skill with overlap 0 is not listed. A skill that a summary names in `skillsThatShouldHaveFired` is added with `named: true`. Each entry shows `invokedInEpisodes` and `correctedEpisodes`.

## Kind hint

Apply the first rule that matches:

1. `misfiring-skill`: a skill S fired in at least `minEpisodes` of the candidate's corrected episodes, and S's rate in those episodes is at least 2 times S's firing rate in the run. The run rate counts only episodes from sources that record invocations.
2. `silent-skill`: a pre-match skill has overlap 0.3 or more, or is named, and fired in none of the candidate's episodes. Skip a skill with `invocation: 'user'`. It cannot fire by itself, so a description edit does not help.
3. `new-skill`: all other candidates.

The hint is a start. In the judgment step, change it when the evidence says so, and write the reason.

## Confidence

- `high`: 5 or more episodes, and summaries exist for them.
- `medium`: 3 or 4 episodes, or heuristic evidence only.
- `low`: more than half of the candidate's episodes have an audit warning.

## Reject

Reject a candidate, with a reason, when:

- it is one-off work, or it is below the rule;
- a catalog skill already fires in most of its episodes and there are no corrections;
- it is a tool habit, not a task. For example, `git status` or `pnpm test`.

## Catalog usage

For each catalog skill, over the run window: `invocations`, `episodes`, `lastUsed` (a UTC day), and `neverInvoked`. Skill calls and slash commands both count. A name resolves by the exact qualified name first, then by the bare name.

## Previous run

`--previous auto` uses the newest sibling run folder, by name, that sorts before this run and holds `suggestions.json`. Each old suggestion gets one status:

- `resolved`:
  - `new-skill`: a catalog skill has the proposed name, or a skill that was not in the old `catalogChecked` list has overlap 0.5 or more with the proposed description;
  - `silent-skill`: the target description now equals `descriptionAfter`;
  - `misfiring-skill`: the target `SKILL.md` holds the first 60 normalized characters of the Learnings entry.
- `still-open`: an episode that started after the old `generatedAt` has a key with overlap 0.6 or more with the old title, name, trigger phrases, and candidate keys.
- `stale`: no such episode.
