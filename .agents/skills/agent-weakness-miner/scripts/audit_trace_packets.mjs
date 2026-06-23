#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const allowedSources = new Set(['codex', 'claude-code', 'paperclip', 'external']);
const allowedStatuses = new Set(['succeeded', 'failed', 'blocked', 'partial', 'unknown']);

function usage(message) {
  if (message) console.error(message);
  console.error('usage: audit_trace_packets.mjs <trace-packets.json> [--strict]');
  process.exit(1);
}

function schemaError(message) {
  console.error(message);
  process.exit(1);
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    schemaError(`${path} must be an object`);
  }
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    schemaError(`${path} must be a non-empty string`);
  }
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    schemaError(`${path} must be an array`);
  }
}

function validatePacket(packet, index) {
  const base = `packet[${index}]`;
  requireObject(packet, base);
  requireString(packet.traceId, `${base}.traceId`);
  requireString(packet.source, `${base}.source`);
  if (!allowedSources.has(packet.source)) {
    schemaError(`${base}.source must be one of ${[...allowedSources].join(', ')}`);
  }

  requireObject(packet.scope, `${base}.scope`);
  requireString(packet.scope.kind, `${base}.scope.kind`);
  requireString(packet.scope.id, `${base}.scope.id`);

  requireObject(packet.task, `${base}.task`);
  requireString(packet.task.goal, `${base}.task.goal`);

  requireObject(packet.outcome, `${base}.outcome`);
  requireString(packet.outcome.status, `${base}.outcome.status`);
  if (!allowedStatuses.has(packet.outcome.status)) {
    schemaError(`${base}.outcome.status must be one of ${[...allowedStatuses].join(', ')}`);
  }
  requireArray(packet.outcome.signals, `${base}.outcome.signals`);

  for (const field of ['timeline', 'failures', 'userInterventions', 'artifacts', 'redactions', 'rawPointers']) {
    requireArray(packet[field], `${base}.${field}`);
  }
}

function makeIssue(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra };
}

function unique(values) {
  return [...new Set(values)];
}

function firstTen(values) {
  return values.slice(0, 10);
}

function hasLowInformationGoal(goal) {
  const trimmed = goal.trim();
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(trimmed) ||
    /\buser user\b/i.test(trimmed) ||
    /<(?:command-message|local-command-[^>]+)>/i.test(trimmed)
  );
}

const timestampRelevantKinds = new Set([
  'attachment',
  'assistant_message',
  'sidechain',
  'tool',
  'tool_result',
  'user_message'
]);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const file = args.find((arg) => !arg.startsWith('--'));
if (!file) usage();

let packets;
try {
  packets = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  schemaError(`cannot read or parse ${file}: ${error.message}`);
}

if (!Array.isArray(packets)) schemaError('trace packet file must be a JSON array');
packets.forEach(validatePacket);

const issues = [];
const traceIdCounts = new Map();
for (const packet of packets) {
  traceIdCounts.set(packet.traceId, (traceIdCounts.get(packet.traceId) || 0) + 1);
}

const duplicateTraceIds = [...traceIdCounts.entries()]
  .filter(([, count]) => count > 1)
  .map(([traceId]) => traceId);
if (duplicateTraceIds.length) {
  issues.push(
    makeIssue(
      'duplicate_trace_id',
      'error',
      'Duplicate trace ids collapse independent evidence and must be fixed before mining.',
      {
        traceIds: firstTen(duplicateTraceIds),
        count: duplicateTraceIds.length
      }
    )
  );
}

const unknownGoalTraceIds = packets
  .filter((packet) => /^Unknown\b/i.test(packet.task.goal.trim()))
  .map((packet) => packet.traceId);
if (unknownGoalTraceIds.length) {
  issues.push(
    makeIssue(
      'unknown_task_goal',
      'warning',
      'Unknown task goals weaken grouping and confidence; recover source intent before strong claims.',
      {
        traceIds: firstTen(unique(unknownGoalTraceIds)),
        count: unknownGoalTraceIds.length
      }
    )
  );
}

const lowInformationGoalTraceIds = packets
  .filter((packet) => !/^Unknown\b/i.test(packet.task.goal.trim()) && hasLowInformationGoal(packet.task.goal))
  .map((packet) => packet.traceId);
if (lowInformationGoalTraceIds.length) {
  issues.push(
    makeIssue(
      'low_information_task_goal',
      'warning',
      'Task goals appear to include Claude metadata, command tags, or UUID prefixes; grouping by task intent may be unreliable.',
      {
        traceIds: firstTen(unique(lowInformationGoalTraceIds)),
        count: lowInformationGoalTraceIds.length
      }
    )
  );
}

const missingTimestampTraceIds = [];
let missingTimestampCount = 0;
let timelineEventCount = 0;
for (const packet of packets) {
  let packetMissing = false;
  for (const event of packet.timeline) {
    if (!event || !timestampRelevantKinds.has(event.kind)) continue;
    timelineEventCount += 1;
    if (!event.timestamp) {
      missingTimestampCount += 1;
      packetMissing = true;
    }
  }
  if (packetMissing) missingTimestampTraceIds.push(packet.traceId);
}
if (missingTimestampCount) {
  issues.push(
    makeIssue(
      'missing_timestamps',
      'warning',
      'Missing timestamps make ordering and duration claims unreliable for affected packets.',
      {
        traceIds: firstTen(unique(missingTimestampTraceIds)),
        count: missingTimestampCount,
        eventCount: timelineEventCount
      }
    )
  );
}

const highFailureDensity = packets
  .filter((packet) => packet.timeline.length >= 5 && packet.failures.length / packet.timeline.length > 0.15)
  .map((packet) => packet.traceId);
if (highFailureDensity.length) {
  issues.push(
    makeIssue(
      'high_failure_density',
      'warning',
      'Failure extraction is unusually dense; inspect summaries for prompt/example text before treating failures as observed behavior.',
      {
        traceIds: firstTen(unique(highFailureDensity)),
        count: highFailureDensity.length
      }
    )
  );
}

const blocking = issues.some((issue) => issue.severity === 'error');
const audit = {
  packetCount: packets.length,
  blocking,
  issues,
  recommendations: issues.map((issue) => {
    if (issue.code === 'duplicate_trace_id') return 'Re-normalize or de-duplicate packets before weakness mining.';
    if (issue.code === 'unknown_task_goal') return 'Report this limitation in weakness-review.md and lower confidence for affected groups.';
    if (issue.code === 'low_information_task_goal') return 'Recover or summarize the real user task before grouping by intent.';
    if (issue.code === 'missing_timestamps') return 'Avoid sequence, latency, and duration claims for affected packets.';
    if (issue.code === 'high_failure_density') return 'Sample failure summaries before grouping by failure count.';
    return 'Review packet quality before mining.';
  })
};

console.log(`${JSON.stringify(audit, null, 2)}\n`);
if (strict && blocking) process.exit(2);
