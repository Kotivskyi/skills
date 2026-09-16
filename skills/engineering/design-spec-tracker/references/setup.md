# Setup

Two things make the skill active in a designer's project:

1. A `design-specs/` folder. The plugin's SessionStart hook sees it and adds two or three lines of context.
2. A `<design-spec-tracker>` block in the project's `CLAUDE.md`. It states what the skill does and how it relates to the `design` plugin, and it keeps working where hooks do not.

The first design turn creates both, so in the normal case the designer does nothing.

## Install once

```bash
claude plugin marketplace add Kotivskyi/skills
```

```bash
claude plugin install kotivskyi-skills@kotivskyi-skills
```

Restart Claude Code. Keep Anthropic's `design` plugin installed. `/design-handoff`, `/design-critique`, `/accessibility-review`, and the rest keep working as before.

## The CLAUDE.md block

The canonical text is [`assets/claude-md-block.md`](../assets/claude-md-block.md), and that file is the only copy. It is wrapped in a matching tag pair, so anyone reading the designer's `CLAUDE.md` can see exactly where the skill's instructions start and stop inside their own.

To read it without opening the file:

```bash
bash <skill-dir>/scripts/setup-claude-md.sh --print
```

Do not paste it by hand. Run the setup script from the project root:

```bash
bash <skill-dir>/scripts/setup-claude-md.sh
```

It adds the block when `CLAUDE.md` has none, creates `CLAUDE.md` when the file is missing, and replaces the block when an older version is present. It leaves everything outside the tags alone and does nothing when the block is already correct, so it is safe to run on every session.

It uses only a shell, grep, and awk, all of which macOS provides. The designer needs nothing installed.

Other modes:

| Flag | Effect |
| :--- | :--- |
| `--check` | Verify only. Exit 1 when the block is missing or stale. |
| `--print` | Print the canonical block. |
| `--file <path>` | Target a file other than `./CLAUDE.md`, such as `AGENTS.md`. |

If the block has been edited by hand into a broken state, with a mismatched or duplicated tag, the script stops and reports it rather than guessing which text to keep.

## Project facts

`design-specs/tracker.json` holds the facts the spec needs and the conversation rarely states. The skill creates it with empty strings and fills what it learns:

```json
{
  "developer": "Vitalii",
  "stack": "React + Tailwind",
  "tokens": "Figma variables in the Shop file",
  "tracker": "Linear team SHOP"
}
```

Empty values appear as one bullet in the handoff gap list, so they get filled the first time a design is declared done.

## What the hook adds to context

Only in a project with `design-specs/`, and only these lines:

```
design-spec-tracker is active in this project. Load the design-spec-tracker skill before replying to any turn about a screen, component, flow, state, or design decision; it keeps the developer spec current without being asked.
Specs in design-specs/: checkout-summary (draft, 6/9 covered, 3 open, 1 proposed); onboarding-flow (ready-for-dev).
Developer: Vitalii. Stack: React + Tailwind. Design tokens: Figma variables in the Shop file.
```

With more than eight specs the second line becomes a count per status. In a project with no `design-specs/` folder the hook prints nothing at all.

## What needs Node, and what does not

macOS does not ship Node, and nothing the designer touches requires it. Only the validator does, and it is optional:

| Piece | Runtime | Without Node |
| :--- | :--- | :--- |
| Setup script | shell, grep, awk | works |
| The `CLAUDE.md` block | none | works |
| Spec writing and the handoff check | none, the model does it | works |
| Validator | Node | skipped; the model checks the format against [`spec-format.md`](spec-format.md) instead |
| SessionStart hook | shell, sed, awk | works |

## Developer: reading the specs

The validator is for whoever builds the design, who has Node. From the designer's project root:

```bash
node ~/.claude/plugins/cache/kotivskyi-skills/kotivskyi-skills/*/skills/engineering/design-spec-tracker/scripts/validate.mjs --summary
```

It prints one row per spec with status, covered sections, open questions, and proposed items, then any format errors.
