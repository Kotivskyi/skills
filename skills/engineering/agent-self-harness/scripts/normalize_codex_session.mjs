#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function usage(message) {
  if (message) console.error(message);
  console.error('usage: normalize_codex_session.mjs --input <jsonl> --output <json> [--session-id <id>] [--since <iso>] [--until <iso>]');
  process.exit(1);
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => {
      try {
        return { record: JSON.parse(line), line: index };
      } catch (error) {
        usage(`invalid JSON on line ${index}: ${error.message}`);
      }
    });
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

function getTimestamp(record) {
  return record.timestamp || record.time || record.created_at || record.payload?.timestamp || null;
}

function getSessionId(record) {
  return record.session_id || record.sessionId || record.payload?.session_id || record.payload?.sessionId || record.payload?.id || record.id || 'unknown-session';
}

function redactText(text, counts) {
  const replacements = [
    { kind: 'env_secret', pattern: /\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^"'\s]+/g, value: '[REDACTED_ENV_SECRET]' },
    { kind: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]+/g, value: '[REDACTED_API_KEY]' },
    { kind: 'authorization', pattern: /\bBearer\s+[A-Za-z0-9._-]+/g, value: 'Bearer [REDACTED]' },
    { kind: 'private_url', pattern: /https?:\/\/(?:private|internal)[^"'\s)]+/g, value: '[REDACTED_PRIVATE_URL]' }
  ];
  let output = text;
  for (const replacement of replacements) {
    output = output.replace(replacement.pattern, () => {
      counts.set(replacement.kind, (counts.get(replacement.kind) || 0) + 1);
      return replacement.value;
    });
  }
  return output;
}

function summarize(record, counts) {
  const raw = collectStrings(record).join(' ');
  const compact = raw.replace(/\s+/g, ' ').trim() || JSON.stringify(record);
  return redactText(compact.slice(0, 700), counts);
}

function actorFor(record) {
  if (record.role) return record.role;
  if (record.type === 'user') return 'user';
  if (record.type === 'assistant' || record.type === 'response_item') return 'assistant';
  if (record.type === 'session_meta') return 'system';
  return record.type || 'unknown';
}

function kindFor(record, summary) {
  if (record.type === 'session_meta') return 'session_meta';
  if (record.payload?.tool || record.payload?.command || /npm|pnpm|pytest|node --test|shell|bash/i.test(summary)) return 'tool';
  if (actorFor(record) === 'user') return 'user_message';
  if (actorFor(record) === 'assistant') return 'assistant_message';
  return record.type || 'event';
}

function isFailure(summary) {
  return /\b(fail(?:ed|ure)?|error|exit code [1-9]|non-zero|missing artifact|assertion)\b/i.test(summary);
}

function isUserIntervention(record, summary) {
  return actorFor(record) === 'user' && /\b(failed|missing|please|forgot|skipped|verify|correction|rerun)\b/i.test(summary);
}

function extractArtifacts(summary) {
  const found = new Set();
  for (const match of summary.matchAll(/\b[\w./-]+\.(?:md|html|json|csv|txt|mjs|js|ts|tsx|py|yaml|yml)\b/g)) {
    found.add(match[0]);
  }
  return [...found].map((path) => ({ path }));
}

function inTimeWindow(record, since, until) {
  const timestamp = getTimestamp(record);
  if (!timestamp) return true;
  const time = Date.parse(timestamp);
  if (since && time < Date.parse(since)) return false;
  if (until && time > Date.parse(until)) return false;
  return true;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.output) usage();

const rows = parseJsonl(await readFile(args.input, 'utf8')).filter(({ record }) => {
  const rowSessionId = getSessionId(record);
  if (args['session-id'] && rowSessionId !== 'unknown-session' && rowSessionId !== args['session-id']) return false;
  return inTimeWindow(record, args.since, args.until);
});

const redactionCounts = new Map();
const sessionId = args['session-id'] || rows.map(({ record }) => getSessionId(record)).find((id) => id !== 'unknown-session') || 'unknown-session';
const timeline = [];
const failures = [];
const userInterventions = [];
const artifacts = new Map();
let taskGoal = 'Unknown Codex task';

for (const { record, line } of rows) {
  const summary = summarize(record, redactionCounts);
  const actor = actorFor(record);
  const kind = kindFor(record, summary);
  if (taskGoal === 'Unknown Codex task' && actor === 'user' && summary) taskGoal = summary.slice(0, 180);
  const event = {
    timestamp: getTimestamp(record),
    actor,
    kind,
    summary,
    rawPointer: { file: args.input, line }
  };
  timeline.push(event);
  if (isFailure(summary)) failures.push({ timestamp: event.timestamp, summary, rawPointer: event.rawPointer });
  if (isUserIntervention(record, summary)) userInterventions.push({ timestamp: event.timestamp, summary, rawPointer: event.rawPointer });
  for (const artifact of extractArtifacts(summary)) artifacts.set(artifact.path, artifact);
}

const signals = [];
if (failures.length) signals.push('tool_or_test_failure');
if (userInterventions.length) signals.push('user_intervention');
if ([...artifacts.keys()].some((path) => /missing/i.test(path))) signals.push('missing_artifact');

const packet = {
  traceId: `codex:${sessionId || 'unknown-session'}`,
  source: 'codex',
  scope: { kind: 'session', id: sessionId || 'unknown-session' },
  task: { goal: taskGoal },
  outcome: { status: failures.length ? 'failed' : 'unknown', signals },
  timeline,
  failures,
  userInterventions,
  artifacts: [...artifacts.values()],
  redactions: [...redactionCounts.entries()].map(([kind, count]) => ({ kind, count })),
  rawPointers: rows.map(({ line }) => ({ file: args.input, line }))
};

await writeFile(args.output, `${JSON.stringify([packet], null, 2)}\n`);
