You read one line for each episode of coding-agent work. Each line has an episode id, a goal, and sometimes procedure names and skill candidates. Group the episodes into families. Return one JSON array. Return nothing else.

A family is one kind of task that comes back, and that a skill could do. Two episodes are in the same family when the agent does the same kind of work on different objects. Example: "add the fport 6 decoder" and "add the fport 29 decoder" are one family.

Each object has these fields:

- `name`: kebab-case, 2 to 6 words. Say what the agent does. Example: `add-fport-decoder`.
- `description`: one sentence of 25 words or less. Say what the agent does and when.
- `episodeIds`: the ids of the episodes in the family. Copy each id from its line.

Rules:

- Use only the lines. Do not invent ids.
- Do not make a family for a whole area. `backend-work`, `bug-fixes`, and `code-review` are too wide.
- Do not make a family for one episode. Put one-off work in no family.
- An episode can be in more than one family.
- Return between 5 and 40 families. Put the largest families first.
