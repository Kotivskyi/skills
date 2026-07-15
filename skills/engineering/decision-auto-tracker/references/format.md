# Decision Log Format Reference

Detailed rules for `decisions/log/*.md` files. The validator (`scripts/validate.mjs`) enforces these mechanically — when in doubt, run it.

## Filename

Pattern: `YYYY-MM-DD-NN-slug.md`

- `YYYY-MM-DD` — date the decision was _made_, not the date the file was created. If you log a decision a day later, still use the day the decision happened.
- `NN` — zero-padded `01`-`99` sequence per day. Increment by scanning `decisions/log/` for files with the same date prefix and picking the next free number.
- `slug` — 2-6 kebab-case words. ASCII only. Don't include the date or sequence in the slug.

Examples:

- `2026-05-18-01-pasture-replaces-piquete.md` ✅
- `2026-05-18-01-Pasture-Replaces-Piquete.md` ❌ (must be lowercase)
- `2026-05-18-1-pasture.md` ❌ (`NN` must be zero-padded)
- `decision-pasture.md` ❌ (missing date / sequence)

## Frontmatter

YAML between the first two `---` lines. All fields below.

### `id` (required)

Format: `YYYY-MM-DD-NN`. Must match the filename prefix exactly. The validator compares strings.

### `date` (required)

Format: `YYYY-MM-DD`. Must match the date portion of `id`. Keeping it separate from `id` makes the date trivially greppable.

### `topic` (required)

Kebab-case slug. Must match the slug portion of the filename. Keep it short — the H1 below is for the human-readable version.

### `status` (required)

One of:

- `active` — the decision currently stands
- `superseded` — replaced by a later decision (which should reference this one via `supersedes`)
- `reversed` — the user explicitly walked it back and there's no successor; effectively "we decided not to do this after all"

### `tags` (required)

YAML list of kebab-case strings. Use `[]` if no tags apply. Suggested tag families:

- Domain: `glossary`, `terminology`, `behavior`, `protocols`, `hardware`
- Layer: `firmware`, `doctor`, `backend`, `infra`, `docs`
- Scope: `architecture`, `naming`, `process`, `tooling`, `v1-cut`

Tags are free-form — the validator only checks shape, not content. Reuse existing tags before inventing new ones.

### `linear` (optional)

A Linear card id like `PASE-387`, or omit / leave blank. If multiple cards are relevant, pick the primary one and mention others in the Source section.

### `supersedes` (optional)

An `id` (e.g. `2026-05-17-03`) of a prior decision this one replaces. When set:

- The old file's `status` must be updated to `superseded`.
- The validator verifies the referenced file exists.

Omit or leave blank for net-new decisions.

## Body

H1 title (required), then four `##` sections in this exact order: **Decision**, **Context**, **Reasoning**, **Source**.

### H1 title

A short, human-readable version of the topic. Sentence case is fine. Example: `# Pasture replaces Piquete`.

### `## Decision`

One or two sentences. The actual choice. Bold the key term if helpful. No background, no rationale — those go below.

### `## Context`

2-4 sentences. What conversation / problem prompted this. Helps a future reader understand whether the decision still applies.

### `## Reasoning`

1-3 sentences on why this option won over alternatives. If the user gave no rationale and just made a fiat call, write `User call, no further rationale given.` — the section must not be empty.

### `## Source`

Where the decision came from. Two common shapes:

1. **Quoted excerpt** — short verbatim line from the user.
2. **Paraphrase** — short summary if the original wording was long or scattered across messages.

Always end with the date in `YYYY-MM-DD` form so the source is dateable even if filenames are renamed later.

## Edge cases

### The user makes multiple decisions in one message

Capture them as **separate files** with incrementing sequence numbers. Each decision gets its own file so they can be cited independently.

### The user reverses a decision

Two cases:

- **Replacing with a new choice** — write a new decision file with `supersedes: <old-id>`, and edit the old file's `status` to `superseded`. The old file is preserved; only its status changes.
- **Walking it back with no replacement** — edit the old file's `status` to `reversed`. Add a brief note at the bottom of the Source section: `Reversed YYYY-MM-DD: <why>`.

### The "decision" is actually a clarification of an existing one

Don't create a new file. Add a `## Clarification YYYY-MM-DD` block at the end of the existing decision's body. Frontmatter status stays `active`.

### The user changes their mind mid-decision

Wait until they actually commit. A decision that flips three times in one minute isn't a decision yet — it's brainstorming.

### Decisions that probably want full ADRs

If a decision is architecturally significant (new external dependency, breaking change to a wire format, new compliance posture, etc.), still log it under `decisions/log/` _and_ mention that an ADR is probably warranted. Tag it `needs-adr`. The human can promote it to a full ADR later.

## Running the validator

From the repo root (`<skill-dir>` is this skill's directory):

```bash
node <skill-dir>/scripts/validate.mjs
```

Exits 0 if everything is fine, non-zero with a per-file report otherwise. The validator only reads `decisions/log/*.md` — it never touches the numbered ADR files or other folders.
