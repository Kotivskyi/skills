---
name: design-spec-tracker
description: Keep a developer handoff spec written and current while a designer works, without being asked. Use on every turn where the user describes, shows, iterates on, or decides anything about a screen, component, flow, or interaction — pastes a Figma link or screenshot, asks for feedback on a layout, picks a spacing, color, type, or copy value, mentions hover, focus, loading, empty, or error states, breakpoints, motion, or accessibility — even when they only ask a design question and never say "spec", "doc", or "handoff". Also use when the designer says a design is done, ready, final, or that they are sending it to a developer. Extends the `design` plugin by writing the same spec `/design-handoff` produces, incrementally, so the handoff exists even when nobody runs the command.
---

## Purpose

`/design-handoff` produces a complete developer spec in one pass, at the end. It only helps when the designer remembers to run it. In practice the design gets forwarded, the spec never gets written, and the developer reconstructs it from screenshots and guesses.

This skill removes the "remember" step. While the designer talks through a screen with Claude, every decided fact lands in a spec file under `design-specs/` as a side effect. The file uses the same sections as `/design-handoff`, so when the design is forwarded the spec already exists, and when the designer does run `/design-handoff` it starts from a filled-in file instead of a blank one.

Two constraints shape everything below:

1. **The designer's attention is the scarce resource.** They opened Claude to design, not to document. The spec is written for them, never by them, and never interrupts them.
2. **The developer must be able to tell what the designer decided from what Claude filled in.** A spec that silently guesses is worse than a spec with gaps, because the developer builds the guess. Gaps stay visible and Claude's suggestions are marked.

## How this fits the `design` plugin

| Plugin skill | Relationship |
|---|---|
| `/design-handoff` | Same output sections. Run it on the spec file for the final polished sheet, exact Figma pulls, or ticket linking. This skill is the continuous half; that one is the final pass. |
| `/design-critique`, `/accessibility-review` | When the designer accepts a finding from these, record the resulting decision in the spec. Findings they reject or ignore are not recorded. |
| `/design-system` | Use the token names the design system documents. Reference tokens, not raw values, whenever a token exists. |
| `~~design tool` (Figma) connected | Pull measurements and tokens from the frame and mark them `[figma]`. |
| `~~project tracker` connected | Put the ticket id in `ticket:`. Do not create tickets; `/design-handoff` does that. |

## Storage layout

```
design-specs/
├── tracker.json          # project facts: developer, stack, tokens, tracker
├── checkout-summary.md
├── onboarding-flow.md
└── …
```

`tracker.json` holds the four facts the spec needs and the conversation rarely states: `developer`, `stack`, `tokens`, `tracker`. Create it with empty strings the first time you create `design-specs/`, and fill any value the designer or the project's `CLAUDE.md` states. The plugin's SessionStart hook reads it, so the next session starts with the facts already in context. In the same turn, run the setup script described under Setup so the project's `CLAUDE.md` carries the skill's block.

One spec file per screen, component, or flow. The filename is the kebab-case slug of the name the designer uses. It is created on first mention. Before creating a file, list `design-specs/` and reuse an existing one whose `title`, `feature`, or `figma` matches. A second file for the same screen is the most common failure, and it leaves the developer with two partial specs and no trusted one.

## Spec file format

The full format with every rule is in [`references/spec-format.md`](references/spec-format.md); a copy-paste starting point is [`template.md`](template.md). The parts that matter on every turn:

- Frontmatter: `feature`, `title`, `status` (`draft` | `ready-for-dev` | `handed-off`), `figma`, `ticket`, `updated`.
- Eleven `##` sections in fixed order: the nine from `/design-handoff` (Overview, Layout, Design Tokens Used, Components, States and Interactions, Responsive Behavior, Edge Cases, Animation / Motion, Accessibility Notes) plus `Open Questions` and `Changelog`.
- A section with nothing decided yet contains exactly `_Not covered yet._`
- Provenance markers on a line: none means the designer said it; `[figma]` means pulled from the design tool; `[proposed]` means Claude suggested it and the designer has not confirmed.
- `Open Questions` is a `- [ ]` checklist. `Changelog` is `- YYYY-MM-DD: what changed`.

## The turn contract

On every turn that touches a design, the reply has this shape, in this order:

1. **The answer to what the designer asked.** Feedback, options, copy, whatever they wanted. Written exactly as it would be without this skill.
2. **The spec update, done silently.** Extract the facts from this turn, write them into the right sections of the file, run the validator, fix what it flags.
3. **One trailer line, only if the file changed:**

   ```
   Spec updated: design-specs/checkout-summary.md (+2 states, 1 open question)
   ```

   Nothing changed, no trailer. The trailer never has a second line and never asks a question.

The order matters. A designer who sees spec talk before their answer learns to skim past Claude's replies. A designer who sees one trailing line learns the spec is being kept and stops thinking about it.

## What to capture, and where

| The designer… | Write to | Example line |
|---|---|---|
| Names the screen, its purpose, who uses it | Overview | Checkout summary. Last step before payment; shows cart totals and promo entry. |
| Describes structure, grid, order of regions | Layout | Header, line-item list, totals block, primary CTA pinned to bottom on mobile. |
| Picks a color, size, spacing, font, radius | Design Tokens Used | `color-primary` for CTA background. |
| Names a component or variant | Components | Button, variant `secondary`, label "Apply promo". |
| Describes hover, focus, active, disabled, loading, empty, error | States and Interactions | Promo field, error: red border, message below "Code not valid". |
| Mentions mobile, tablet, desktop, collapse, wrap | Responsive Behavior | Below 768px the totals block stacks under the list. |
| Mentions long text, many items, no data, slow network | Edge Cases | Product names truncate at 2 lines with ellipsis. |
| Mentions transition, duration, easing, gesture | Animation / Motion | Promo panel expands 200ms ease-out. |
| Mentions focus order, labels, contrast, keyboard | Accessibility Notes | Promo error announced via `aria-live="polite"`. |
| Weighs options without picking | Open Questions | `- [ ] Promo field above or below totals?` |
| Leaves a state or behavior unmentioned that the developer will need | Open Questions | `- [ ] Empty cart: what does this screen show?` |

Write what was said, in the designer's terms, one line per fact. Do not expand a fact into a paragraph, and do not add facts the designer did not give. If a token exists for the value, use the token name.

Two rules that are easy to get wrong:

- **A question is not a decision.** "Should the button be full width?" goes to Open Questions, not Layout. "Make the button full width" goes to Layout.
- **Silence is a gap, not a default.** If the designer never mentioned the loading state, the spec says so in Open Questions. It does not say "spinner" because most screens use a spinner. When a default is genuinely obvious, write it with `[proposed]` and still add the matching Open Questions line.

## Changing a decision

When the designer reverses or refines something already in the spec:

1. Replace the old line in place. Do not keep both.
2. Add a Changelog entry: `- 2026-09-16: promo field moved above totals (was below).`
3. If the change answers an Open Questions item, delete that item.

When the designer reopens a decision without picking a replacement, keep the existing line and append `(under review, see Open Questions)`, then add the question. The developer then sees that the line is current but contested.

The spec always reads as the current design. History lives only in Changelog.

## Handoff moment

The designer signals they are done when they say the design is done, ready, final, finished, or approved, or that they are sending, forwarding, or handing it to a developer, or they name the developer as the next recipient. Any of those triggers the handoff check. This is the one moment where a few lines of spec talk are welcome, because the designer has stopped designing.

The handoff check:

1. Read the spec. Count sections still at `_Not covered yet._`, open questions, and `[proposed]` lines. An empty `developer`, `stack`, or `tokens` value in `tracker.json` is one more gap; list it as a single bullet.
2. If all three are zero, set `status: ready-for-dev`, update `updated`, and reply with one line: `Spec ready for dev: design-specs/checkout-summary.md`
3. Otherwise leave `status: draft` and reply with the gap list, at most five bullets, most important first:

   ```
   Handoff check: design-specs/checkout-summary.md is not ready (3 gaps)
   - Responsive Behavior: not covered
   - Edge Cases: long product names, truncation not decided
   - States: loading state is [proposed] skeleton rows, not confirmed
   Answer these here, or say "confirm proposed" to accept the suggestions, and I will mark it ready.
   ```

4. When the designer answers, apply the answers with the normal capture rules and re-run the check.

A spec can be forwarded while still `draft`. The point of the gap list is that the developer receives the gaps as written questions instead of discovering them mid-build. If the designer wants the polished sheet, Figma-exact measurements, or a linked ticket, tell them once: `Run /design-handoff design-specs/checkout-summary.md for the full sheet.`

## Validation

`scripts/validate.mjs` checks every file in `design-specs/`:

- Filename is a kebab-case slug and matches `feature`
- Frontmatter has all required fields; `status` is allowed; `updated` is `YYYY-MM-DD`
- The eleven sections exist in order and none is empty
- `Open Questions` lines are `- [ ]` items or `_None._`; `Changelog` lines are dated
- `status: ready-for-dev` has no `_Not covered yet._` section

The validator needs Node, and a designer's Mac often has none. Treat it as an accelerator, not a requirement. After every write, from the project root:

```bash
node <skill-dir>/scripts/validate.mjs
```

`<skill-dir>` is the directory containing this SKILL.md. There is no need to read the script's source; the rules above are the complete list, and the script only makes them fast.

When the command fails because `node` is missing, that is not a problem to report, work around, or solve by asking the designer to install anything. Check the file yourself against the rules above and [`references/spec-format.md`](references/spec-format.md), then carry on. The checks are the same either way, so a spec written without the validator is just as correct.

`--summary` prints a readiness table per spec, which is what the developer runs to see what is ready. Fix format errors silently; they are never the designer's problem.

## Common mistakes

| Mistake | Why it hurts | Instead |
|---|---|---|
| Asking the designer "what should the empty state be?" mid-flow | Breaks their focus; they stop trusting the skill to be quiet | Write `- [ ] Empty state?` in Open Questions; it surfaces at handoff |
| Filling a section with sensible defaults, unmarked | Developer builds the default as if decided | Mark `[proposed]` and add the Open Questions line, or leave `_Not covered yet._` |
| Creating `checkout-v2.md` when `checkout-summary.md` exists | Two specs, both partial, neither trusted | List `design-specs/` first and continue the match |
| Restating the spec in the reply | Doubles the reply length every turn | One trailer line |
| Marking `ready-for-dev` because the designer said "done" | "Done" is a signal to check, not a verdict | Run the handoff check; status follows the check |
| Copying the whole conversation into Overview | Spec becomes unreadable | One line per fact, in the section that owns it |

## Setup

Two things make the skill active in a designer's project, and the turn that creates the first spec sets up both.

**The `design-specs/` folder.** The SessionStart hook (`scripts/session-start.sh`) sees it and adds two or three lines of context: an activation line, the status of each spec, and the facts from `tracker.json`. It reads the specs with shell tools alone, so it works on a machine with no Node. In a project without the folder it prints nothing at all.

**A `<design-spec-tracker>` block in the project's `CLAUDE.md`.** The matching tags make it obvious where the skill's instructions start and stop inside the designer's own, and the block keeps working where hooks are unavailable. It also records why the skill exists next to the `design` plugin, which is the part a new reader needs most.

Install or repair the block by running this from the project root, never by pasting the text:

```bash
bash <skill-dir>/scripts/setup-claude-md.sh
```

It adds the block when it is missing, replaces it when an older version is present, and does nothing when it is already correct, so running it again costs nothing. `--check` verifies without writing. It needs only a shell, because a designer's Mac does not ship Node. The canonical text lives in [`assets/claude-md-block.md`](assets/claude-md-block.md) and is the only copy; do not retype it here or anywhere else.

Install steps, the block itself, and what the hook adds are in [`references/setup.md`](references/setup.md).
