# decisions/

Everyday firmware decisions, one file per decision under `log/`. The log is append-only:
retire a decision with a new entry that carries `supersedes:`. Status is derived from that
graph and is not stored. Every entry carries a `bucket`; see `decision-log.json`.
