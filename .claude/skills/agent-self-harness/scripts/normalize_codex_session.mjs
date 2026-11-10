#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import * as zlib from 'node:zlib';

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

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return item.text || item.input_text || item.output_text || '';
    })
    .filter(Boolean)
    .join(' ');
}

function getTimestamp(record) {
  return record.timestamp || record.time || record.created_at || record.payload?.timestamp || null;
}

function getSessionId(record) {
  const payload = record.payload || {};
  // In session_meta, payload.id is this thread. A subagent thread has the root session in payload.session_id.
  if (record.type === 'session_meta') {
    return payload.id || payload.session_id || record.session_id || record.sessionId || 'unknown-session';
  }
  // The older rollout format has the session id in a first line with no type and no payload.
  if (!record.type && !record.payload && record.id) return record.id;
  // In other records, payload.id is an item id, not a session id.
  // A token_usage_record has this thread in payload.thread_id and the root session in payload.session_id.
  return record.session_id || record.sessionId || payload.thread_id || payload.session_id || payload.sessionId || 'unknown-session';
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

function structuredStrings(record) {
  const payload = record.payload || {};
  const strings = [];
  if (record.type === 'session_meta') {
    if (payload.id || payload.session_id) strings.push(`session ${payload.id || payload.session_id}`);
    if (payload.cwd) strings.push(`cwd ${payload.cwd}`);
    return strings;
  }
  const messageText = contentText(payload.content || record.content);
  if (messageText) strings.push(messageText);
  for (const key of ['message', 'text', 'command', 'input', 'result', 'output', 'name']) {
    if (typeof payload[key] === 'string') strings.push(payload[key]);
  }
  // A tool output can be a list of content parts, for example [{ type: 'input_text', text }].
  if (Array.isArray(payload.output)) strings.push(contentText(payload.output));
  if (payload.arguments) {
    strings.push(typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments));
  }
  return strings.filter((item) => item.trim().length > 0);
}

function recordText(record) {
  const structured = structuredStrings(record);
  return (structured.length ? structured : collectStrings(record)).join(' ');
}

function summarize(text, record, counts) {
  const compact = text.replace(/\s+/g, ' ').trim() || JSON.stringify(record);
  return redactText(compact.slice(0, 700), counts);
}

function isToolRecord(record) {
  const payload = record.payload || {};
  return Boolean(
    // function_call, custom_tool_call, and their *_output records.
    /_call(_output)?$/.test(payload.type || '') ||
      payload.tool ||
      payload.command ||
      payload.result
  );
}

function actorFor(record) {
  if (record.role) return record.role;
  if (record.payload?.role) return record.payload.role;
  if (record.payload?.type === 'user_message') return 'user';
  if (record.payload?.type === 'agent_message') return 'assistant';
  if (isToolRecord(record)) return 'tool';
  if (record.type === 'user') return 'user';
  if (record.type === 'assistant' || record.type === 'response_item') return 'assistant';
  if (record.type === 'session_meta') return 'system';
  return record.type || 'unknown';
}

function kindFor(record, summary) {
  if (record.type === 'session_meta') return 'session_meta';
  if (isToolRecord(record) || /npm|pnpm|pytest|node --test|shell|bash/i.test(summary)) return 'tool';
  if (actorFor(record) === 'user') return 'user_message';
  if (actorFor(record) === 'assistant') return 'assistant_message';
  return record.type || 'event';
}

// Plain output says "Process exited with code N". Code-mode output has JSON "exit_code": N for each command.
function exitCodesFor(text) {
  return [...text.matchAll(/(?:\b(?:Process exited with code|exit code)|"exit_code")\s*:?\s*(-?[0-9]+)/gi)].map((match) => Number(match[1]));
}

function isPlannedRedStep(record, summary) {
  return actorFor(record) === 'assistant' && /\b(red test|red step|should fail|expected:\s*fail|fail until)\b/i.test(summary);
}

function isTaskGoalCandidate(summary) {
  if (!summary.trim()) return false;
  if (/(^|\s)# AGENTS\.md instructions\b/i.test(summary)) return false;
  if (/<environment_context>|<\/environment_context>|<filesystem>|<\/filesystem>/i.test(summary)) return false;
  return true;
}

function cleanTaskGoal(summary) {
  const objective = summary.match(/<objective>\s*([\s\S]*?)\s*(?:<\/objective>|$)/i);
  const text = objective ? objective[1] : summary;
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

// `text` is the full record text. The summary keeps only its first 700 characters.
function isFailure(record, summary, text) {
  // A *_call record is the request. Only its *_output record shows the result.
  if (/_call$/.test(record.payload?.type || '')) return false;
  const exitCodes = exitCodesFor(text);
  if (exitCodes.length) return exitCodes.some((code) => code !== 0);
  if (isPlannedRedStep(record, summary)) return false;
  if (isToolRecord(record)) {
    return /\b(fail(?:ed|ure)?|error|non-zero|missing artifact|assertion)\b/i.test(summary);
  }
  return /\b(non-zero|missing artifact|assertion failed)\b/i.test(summary);
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

// Codex compresses many session files with zstd (`*.jsonl.zst`).
async function readSessionText(path) {
  const data = await readFile(path);
  if (path.endsWith('.zst') && typeof zlib.zstdDecompressSync !== 'function') {
    usage(`this Node cannot read zstd files. Decompress first: zstd -dc ${path} > <run-folder>/<name>.jsonl`);
  }
  try {
    return (path.endsWith('.zst') ? zlib.zstdDecompressSync(data) : data).toString('utf8');
  } catch (error) {
    if (error.code === 'ERR_STRING_TOO_LONG') usage(`${path} is too large to read as one string. Split it into smaller JSONL files first.`);
    throw error;
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.output) usage();

const allRows = parseJsonl(await readSessionText(args.input));
const rows = allRows.filter(({ record }) => {
  const rowSessionId = getSessionId(record);
  if (args['session-id'] && rowSessionId !== 'unknown-session' && rowSessionId !== args['session-id']) return false;
  return inTimeWindow(record, args.since, args.until);
});

const redactionCounts = new Map();
// The first session id of the file is this thread. A fork copies the session_meta of its parent after it.
// Read it before the filters, so that a time window does not change it.
const sessionId = args['session-id'] || allRows.map(({ record }) => getSessionId(record)).find((id) => id !== 'unknown-session') || 'unknown-session';
const timeline = [];
const failures = [];
const userInterventions = [];
const artifacts = new Map();
let taskGoal = 'Unknown Codex task';

for (const { record, line } of rows) {
  const text = recordText(record);
  const summary = summarize(text, record, redactionCounts);
  const actor = actorFor(record);
  const kind = kindFor(record, summary);
  // The message that opens the task is the request itself, not a correction of the agent.
  const opensTask = taskGoal === 'Unknown Codex task' && actor === 'user' && isTaskGoalCandidate(summary);
  if (opensTask) taskGoal = cleanTaskGoal(summary);
  const event = {
    timestamp: getTimestamp(record),
    actor,
    kind,
    summary,
    rawPointer: { file: args.input, line }
  };
  timeline.push(event);
  if (isFailure(record, summary, text)) failures.push({ timestamp: event.timestamp, summary, rawPointer: event.rawPointer });
  if (!opensTask && isUserIntervention(record, summary)) userInterventions.push({ timestamp: event.timestamp, summary, rawPointer: event.rawPointer });
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
