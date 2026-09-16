# Decision Log Format Reference

Detailed rules for `decisions/log/*.md` files. The validator (`scripts/validate.mjs`) enforces these mechanically — when in doubt, run it. Per-repo settings come from `decisions/decision-log.json`; see [`config.md`](config.md).

## Filename

Pattern: `YYYY-MM-DD-NN-slug.md`

- `YYYY-MM-DD` — date the decision was _made_, not the date the file was created. If you log a decision a day later, still use the day the decision happened (`--date` on the scaffolder).
- `NN` — zero-padded `01`–`99` sequence per day. `scripts/new-decision.mjs` allocates the next free number. Two sessions or branches can allocate the same number for different slugs and merge without a git conflict, so the validator checks for duplicate ids; the fix is to renumber the later entry.
- `slug` — 2–6 kebab-case words, ASCII only. The validator errors above `maxSlugWords` (default 6). The H1 title carries the long form; the slug is the gist. Don't include the date, the sequence, or a ticket id in the slug.

Examples:

- `2026-05-18-01-pasture-replaces-piquete.md` ✅
- `2026-05-18-01-Pasture-Replaces-Piquete.md` ❌ (must be lowercase)
- `2026-05-18-1-pasture.md` ❌ (`NN` must be zero-padded)
- `2026-09-09-01-source-digest-check-reads-the-running-images-own-sha-256-via-a-hand-rolled-parser.md` ❌ (16 words — use `digest-check-reads-own-sha`)
- `decision-pasture.md` ❌ (missing date / sequence)

## Frontmatter

YAML between the first two `---` lines. The parser reads a small subset: `key: scalar`, `key: [a, b]` inline lists, and blank values. Block lists (`- item` on following lines) fail the file.

### `id` (required)

Format: `YYYY-MM-DD-NN`. Must match the filename prefix exactly.

### `date` (required)

Format: `YYYY-MM-DD`. Must match the date portion of `id`. Kept separate so the date is trivially greppable.

### `topic` (required)

Kebab-case slug. Must match the slug portion of the filename.

### `status` (depends on `statusMode`)

**Stored mode (default).** Required. One of:

- `active` — the decision currently stands
- `superseded` — replaced by a later decision, which references this one via `supersedes`
- `reversed` — the user walked it back and there is no successor

The validator checks the field against the graph: an entry that another entry supersedes must say `superseded`; an entry that says `superseded` must have a successor.

**Derived mode.** Do not write the field. An entry is `superseded` when another entry supersedes it and `active` otherwise; the validator computes that. A legacy `status:` line stays valid while it agrees with the graph; when it stops agreeing, delete the line (the one edit an append-only repo permits).

### `bucket` (only when the config lists buckets)

One of the configured names, e.g. `physics | protocol | design | process | scar | unclear`. It says what a later rewrite must carry forward. Required for entries dated on or after `bucketRequiredFrom`; older entries stay valid without one.

### `tags` (required)

Inline YAML list of kebab-case strings. Use `[]` if no tags apply. Suggested families:

- Domain: `glossary`, `terminology`, `behavior`, `protocols`, `hardware`
- Layer: `firmware`, `backend`, `mobile`, `infra`, `docs`
- Scope: `architecture`, `naming`, `process`, `tooling`, `v1-cut`

Tags are free-form — the validator checks shape, not content. Reuse existing tags before inventing new ones.

### `linear` (optional)

A tracker id matching the config's `linearPattern` (default `ABC-123` shape), or blank. If several cards apply, pick the primary one and mention the others in Source.

### `supersedes` (optional)

The prior decision this one replaces. Accepted forms:

- bare id: `supersedes: 2026-05-17-03`
- id-slug stem: `supersedes: 2026-05-17-03-cloudflare-not-route53` — required when two files share the bare id
- inline list: `supersedes: [2026-05-17-03, 2026-06-01-02]` — one decision retiring several

The validator verifies every reference resolves to exactly one existing file and that an entry does not supersede itself. Omit or leave blank for net-new decisions.

## Body

H1 title (required, first non-blank line after the frontmatter), then four `##` sections in this exact order: **Decision**, **Context**, **Reasoning**, **Source**. None may be empty or start with `TODO`.

### H1 title

A short, human-readable version of the topic. Sentence case is fine. It may be long; the slug is the short form.

### `## Decision`

One or two sentences. The actual choice. Bold the key term if helpful. No background, no rationale — those go below. The validator warns above `maxDecisionSentences` (default 2). A Decision that needs a numbered list is several decisions; split it.

### `## Context`

2–4 sentences. What conversation or problem prompted this. Helps a future reader judge whether the decision still applies. In an append-only repo, cite the id of any entry this one clarifies here.

### `## Reasoning`

1–3 sentences on why this option won. If the user gave no rationale and just made a fiat call, write `User call, no further rationale given.`

### `## Source`

Where the decision came from — a short verbatim quote or a paraphrase — ending with the date in `YYYY-MM-DD` form. Name the human, not a hook or gate: a decision whose only source is a stop-hook or CI message is an agent-harness rule and does not belong in the log.

## Edge cases

### The user makes several decisions in one message

Capture them as **separate files** with consecutive sequence numbers. Each gets its own file so it can be cited and superseded independently. "Four picks for X: (1) … (2) … (3) … (4) …" in one file is the anti-pattern the audit rubric flags as `multi-decision`.

### A task pick contains a durable rule

"Ship the decoder now; we never build a daily aggregate view for this report" is one task pick and one rule. Log the rule alone. The pick lives in the ticket.

### The user reverses a decision

- **Replacing with a new choice** — a new entry with `supersedes: <old-id>` stating the new choice. Stored mode: also set the old file's `status: superseded`. Derived / append-only mode: leave the old file untouched.
- **Walking it back with no replacement** — stored mode: set the old file's `status: reversed` and append `Reversed YYYY-MM-DD: <why>` to its Source. Append-only mode: a new entry with `supersedes: <old-id>` whose Decision says the earlier decision is withdrawn and nothing replaces it; say why in Reasoning.

### The "decision" is a clarification of an existing one

- **Stored mode** — no new file. Append a `## Clarification YYYY-MM-DD` block at the end of the existing entry's body. Its status stays `active`.
- **Append-only mode** — the old file is closed to edits, so write a new entry whose Context names the entry it clarifies. Use `supersedes` only if the clarification actually changes the decision.

### The user changes their mind mid-decision

Wait until they commit. A decision that flips three times in one minute is brainstorming.

### Two sessions allocated the same sequence number

The validator reports `duplicate id`. Renumber the later entry (filename, `id`, and any `supersedes` that pointed at it). In an append-only repo, do this before the entry merges.

### Decisions that probably want full ADRs

If a decision is architecturally significant (new external dependency, breaking wire-format change, new compliance posture), still log it _and_ say an ADR is probably warranted. Tag it `needs-adr` so a human can promote it later.

## Running the checks

From the repo root (`<skill-dir>` is this skill's directory):

```bash
node <skill-dir>/scripts/validate.mjs --quiet          # always
bash <skill-dir>/scripts/check-append-only.sh          # when the config sets appendOnly
node <skill-dir>/scripts/audit-manifest.mjs --summary  # periodic audit; see triage-rubric.md
```

The validator exits 0 when everything is fine (warnings allowed), 1 on any error. It reads only `decisions/log/*.md` and the config file — it never touches ADRs or other folders.
