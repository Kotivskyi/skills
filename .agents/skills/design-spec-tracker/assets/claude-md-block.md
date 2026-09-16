<design-spec-tracker>
Design project. Load the `design-spec-tracker` skill before replying to any turn
about a screen, component, flow, state, or design decision, even when I only ask
a question.

This skill matters most alongside Anthropic's `design` plugin. That plugin's
`/design-handoff` writes the developer spec in one pass, at the end, and only
when someone remembers to run it. This skill keeps that same spec current while
the design changes, so the handoff exists even when nobody runs the command.
`/design-critique`, `/accessibility-review`, `/design-system` and the rest work
as before; run `/design-handoff` on the tracked file for the final sheet.

Specs live in `design-specs/`, one file per screen or flow; project facts are in
`design-specs/tracker.json`. Do not ask me to write or fill a spec. Write it from
what I say, mark your own suggestions `[proposed]`, and put anything I have not
decided in "Open Questions". Answer my question first and keep spec talk to one
trailing line.
</design-spec-tracker>
