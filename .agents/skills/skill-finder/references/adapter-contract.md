# Adapter contract

An adapter turns one kind of work history into evidence records. Each adapter has five parts:

1. `references/sources/<name>.md`: the knowledge document.
2. `scripts/extract-<name>.mjs`: the extractor.
3. `scripts/fixtures/<name>/`: small synthetic inputs.
4. `scripts/extract-<name>.test.mjs`: the tests.
5. One eval case in `evals/evals.json`.

Then add the name to `KNOWN_SOURCES` in `scripts/audit-evidence.mjs`. Until you do, the audit needs `--allow-source <name>`.

## Knowledge document

State these items:

- Location: where the data is, and how the user names it.
- Record shape: the record types and the fields that the extractor reads.
- Episode: what one episode is.
- Signals: which fields give each evidence field.
- Skipped data: what the extractor ignores, and why.
- Pitfalls: surprises in real data.
- Privacy: what can hold secrets, and how the extractor redacts it.

## Extractor CLI

```text
extract-<name>.mjs --out <run-dir> [--since <iso>] [--until <iso>] [--max-episodes <n>] [source-location flags]
```

- Append records to `<run-dir>/evidence.jsonl`. Skip an `id` that the file already holds, so a second run adds nothing.
- Write one digest for each record to `<run-dir>/digests/<source>__<key>.md`. Use `digestPath(id)` from `lib/paths.mjs` and `capDigest` from `lib/digest.mjs`.
- Print one JSON line: `{ "source", "episodes", "skipped", "bytes" }`.
- Exit 2 when the location is missing or unreadable. Exit 1 for a usage error. Do not write a record then.
- `--since` and `--until` accept an ISO time or a date. A date-only `--until` covers the whole day. `--max-episodes` keeps the newest episodes.

## Required record rules

- `id` is `<source>:<stable key>`.
- `days` is filled when the source has dates.
- `digest` names a file that exists.
- Redaction runs on every text through `redact()` from `lib/redact.mjs`, with a counter. Store the counts in `redactions`.
- `intents` hold only text that a human wrote.
- Stream large inputs line by line with `readLines()` from `lib/jsonl.mjs`. Test a cheap substring before `JSON.parse`.

## Test cases

Each extractor test covers: record count, `id` prefix, `days`, redaction count, skipped records, the digest cap, and exit 2 on a missing path.
