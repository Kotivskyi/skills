# Spec file format

One file per screen, component, or flow, at `design-specs/<feature>.md`. The validator (`scripts/validate.mjs`) enforces every rule on this page.

`design-specs/tracker.json` is not a spec. It holds the project facts (`developer`, `stack`, `tokens`, `tracker`) as strings, empty when unknown. The validator ignores it; the SessionStart hook reads it.

## Filename

`<feature>.md` where `<feature>` is a kebab-case slug: lowercase letters, digits, single hyphens. Derive it from the name the designer uses ("checkout summary" → `checkout-summary`). If a Figma frame name is the only name, slug that.

Before creating a file, list `design-specs/` and reuse a file whose `feature`, `title`, or `figma` matches the current screen.

## Frontmatter

| Field | Required | Format | Notes |
|---|---|---|---|
| `feature` | yes | kebab-case slug | Must equal the filename without `.md` |
| `title` | yes | free text | Human name of the screen or flow |
| `status` | yes | `draft` \| `ready-for-dev` \| `handed-off` | Default `draft`. `ready-for-dev` is set only by the handoff check. `handed-off` is set when the developer confirms receipt or `/design-handoff` has run. |
| `figma` | yes, may be empty | URL | The frame or file the spec describes |
| `ticket` | yes, may be empty | project tracker id, e.g. `PASE-412` | Filled when known; never created by this skill |
| `updated` | yes | `YYYY-MM-DD` | Date of the last change to the body |

## Body

An H1 `# Handoff Spec: <title>` followed by exactly these eleven `##` sections, in this order:

1. Overview
2. Layout
3. Design Tokens Used
4. Components
5. States and Interactions
6. Responsive Behavior
7. Edge Cases
8. Animation / Motion
9. Accessibility Notes
10. Open Questions
11. Changelog

Sections 1 to 9 are the sections `/design-handoff` outputs, with the same names, so its template applies directly. Sections 10 and 11 exist only in the tracked spec.

### Section content rules

- A section with nothing decided contains exactly `_Not covered yet._` and nothing else.
- Otherwise a section holds one line per fact. Bullets, short tables, or the `/design-handoff` tables are all fine. Prose paragraphs are not.
- A fact is written in the designer's terms. `color-primary` if they said the token; `#1B5E20` only if they gave a hex and no token exists.
- **Open Questions** holds `- [ ]` items, one question each, or exactly `_None._`. Answered questions are deleted, not checked off; the answer lands in its section and Changelog records it.
- **Changelog** holds `- YYYY-MM-DD: <what changed>` lines, newest last. The first line is always `spec created.`

### Provenance markers

A line's source is visible from its marker:

| Marker | Meaning | Who resolves it |
|---|---|---|
| none | The designer said or decided it | Nobody, it is decided |
| `[figma]` | Pulled from the connected design tool | Nobody, it is measured |
| `[proposed]` | Claude suggested it; the designer has not confirmed | The designer, at handoff or earlier |

Every `[proposed]` line has a matching Open Questions item so it cannot be forgotten. When the designer confirms, remove the marker and the question. When they replace it, replace the line.

### Readiness

The handoff check sets `status: ready-for-dev` only when:

- no section is `_Not covered yet._`
- Open Questions is `_None._`
- no line carries `[proposed]`

The validator treats a `ready-for-dev` file with a `_Not covered yet._` section as an error. Open questions and `[proposed]` lines in a `ready-for-dev` file are warnings, because a designer may knowingly hand off with named gaps.

## Full example

```markdown
---
feature: checkout-summary
title: Checkout summary
status: draft
figma: https://www.figma.com/design/abc123/Shop?node-id=12-340
ticket: SHOP-218
updated: 2026-09-16
---

# Handoff Spec: Checkout summary

## Overview
Last step before payment on mobile. Shows line items, totals, and promo code entry.

## Layout
- Header, line-item list, promo field, totals block, primary CTA pinned to the bottom.
- Promo field sits above the totals block.

## Design Tokens Used
| Token | Usage |
|---|---|
| `color-primary` | Pay now background |
| `spacing-md` | Between list and totals |
| `font-body-bold` | Totals row |

## Components
- Button, variant `primary`, label "Pay now", full width.
- Button, variant `secondary`, label "Apply promo".
- TextField, label "Promo code".

## States and Interactions
- Totals row: bold.
- Promo field, error: red border, message below "Code not valid".
- Promo apply, loading: [proposed] inline spinner replaces the button label.

## Responsive Behavior
- Mobile only for v1. [figma] Frame width 390.

## Edge Cases
- Product names truncate at 2 lines with ellipsis.

## Animation / Motion
- Promo panel expands 200ms ease-out.

## Accessibility Notes
_Not covered yet._

## Open Questions
- [ ] Empty cart: what does this screen show?
- [ ] Promo apply loading: confirm the [proposed] inline spinner.

## Changelog
- 2026-09-15: spec created.
- 2026-09-16: promo field moved above totals (was below).
- 2026-09-16: promo error state added.
```
