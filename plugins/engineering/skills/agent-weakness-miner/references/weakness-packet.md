# Weakness Packet

The weakness miner emits a machine-readable file and a compact Markdown review.

## JSON Shape

```json
{
  "weaknesses": [
    {
      "id": "W1",
      "title": "Repeated missing verification after failed command",
      "affectedTraceIds": ["codex:fixture-session"],
      "evidence": ["compact quoted or paraphrased evidence"],
      "suspectedMechanism": "why the harness likely allowed the failure",
      "severity": "medium",
      "frequency": "2/3 traces",
      "confidence": "medium",
      "proposedSurfaces": ["existing skill", "prompt/harness file"],
      "targetedEvalIdeas": ["eval idea tied to evidence"],
      "notOneOffNoise": "why this pattern recurs"
    }
  ]
}
```

## Field Rules

- `id`: stable within a run, for example `W1`.
- `title`: short and behavior-focused.
- `affectedTraceIds`: trace ids from the packet input. Do not omit them.
- `evidence`: compact evidence snippets or paraphrases with source trace ids when useful.
- `suspectedMechanism`: a hypothesis, not proof.
- `severity`: `low`, `medium`, or `high`.
- `frequency`: source-grounded count, such as `2/5 traces`.
- `confidence`: `low`, `medium`, or `high`.
- `proposedSurfaces`: plausible surfaces only, such as `new skill`, `existing skill`, `prompt/harness file`, or `script/tool`.
- `targetedEvalIdeas`: eval ideas that would fail before the improvement and pass after.
- `notOneOffNoise`: explicit reason this should be fixed now, or a statement that evidence is thin.

## Markdown Review

Use this compact layout:

```markdown
# Weakness Review

| ID | Weakness | Severity | Frequency | Confidence | Proposed surfaces |
| --- | --- | --- | --- | --- | --- |
| W1 | ... | medium | 2/3 | medium | existing skill, prompt |

## W1: <title>

- Evidence: <compact bullets>
- Suspected mechanism: <one paragraph>
- Targeted eval ideas: <bullets>
- Why not one-off noise: <one sentence>
```

Use ASCII diagrams only when they reduce cognitive load.
