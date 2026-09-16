#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const allowedSources = new Set(['codex', 'claude-code', 'paperclip', 'external']);
const allowedStatuses = new Set(['succeeded', 'failed', 'blocked', 'partial', 'unknown']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
}

function validatePacket(packet, index) {
  const base = `packet[${index}]`;
  requireObject(packet, base);
  requireString(packet.traceId, `${base}.traceId`);
  requireString(packet.source, `${base}.source`);
  if (!allowedSources.has(packet.source)) fail(`${base}.source must be one of ${[...allowedSources].join(', ')}`);

  requireObject(packet.scope, `${base}.scope`);
  requireString(packet.scope.kind, `${base}.scope.kind`);
  requireString(packet.scope.id, `${base}.scope.id`);

  requireObject(packet.task, `${base}.task`);
  requireString(packet.task.goal, `${base}.task.goal`);

  requireObject(packet.outcome, `${base}.outcome`);
  requireString(packet.outcome.status, `${base}.outcome.status`);
  if (!allowedStatuses.has(packet.outcome.status)) {
    fail(`${base}.outcome.status must be one of ${[...allowedStatuses].join(', ')}`);
  }
  requireArray(packet.outcome.signals, `${base}.outcome.signals`);

  for (const field of ['timeline', 'failures', 'userInterventions', 'artifacts', 'redactions', 'rawPointers']) {
    requireArray(packet[field], `${base}.${field}`);
  }
}

const file = process.argv[2];
if (!file) fail('usage: check_trace_packets.mjs <trace-packets.json>');

let parsed;
try {
  parsed = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  fail(`cannot read or parse ${file}: ${error.message}`);
}

if (!Array.isArray(parsed)) fail('trace packet file must be a JSON array');
parsed.forEach(validatePacket);
console.log(`valid trace packets: ${parsed.length}`);
