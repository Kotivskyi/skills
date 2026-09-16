---
id: YYYY-MM-DD-NN
date: YYYY-MM-DD
topic: two-to-six-word-slug
status: active
tags: []
linear:
supersedes:
---

# Human-readable title (may be long; the slug is the short form)

<!--
Prefer `node <skill-dir>/scripts/new-decision.mjs "<title>"` over copying this
file: it derives the id, date, topic and sequence number — the four fields that
get out of step — and applies the repo's decision-log.json.

If the repo's config sets `statusMode: "derived"`, delete the `status:` line.
If it lists `buckets`, add `bucket: <name>` after `topic:`.
The first line of the file must be `---` and the first non-blank line after the
frontmatter must be the `# ` title. Remove this comment before saving.
-->

## Decision

One or two sentences. The choice itself, no fluff.

## Context

2-4 sentences. Why this came up, what was being discussed.

## Reasoning

1-3 sentences. Why this option won. If the user just picked without explaining,
write: `User call, no further rationale given.`

## Source

Quoted or paraphrased conversation excerpt from the user, plus the date (YYYY-MM-DD).
