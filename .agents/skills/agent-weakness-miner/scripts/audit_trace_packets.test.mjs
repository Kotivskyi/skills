import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(skillDir, 'scripts/audit_trace_packets.mjs');
const fixture = resolve(skillDir, 'evals/fixtures/normalization-quality.json');
const claudeFixture = resolve(skillDir, 'evals/fixtures/claude-normalization-quality.json');

test('reports duplicate trace ids and unknown task goals before mining', () => {
  const result = spawnSync(process.execPath, [script, fixture, '--strict'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  const audit = JSON.parse(result.stdout);

  assert.equal(audit.packetCount, 3);
  assert.equal(audit.blocking, true);
  assert.deepEqual(
    audit.issues.map((issue) => issue.code),
    ['duplicate_trace_id', 'unknown_task_goal', 'missing_timestamps']
  );
  assert.equal(audit.issues[0].severity, 'error');
  assert.deepEqual(audit.issues[0].traceIds, ['codex:duplicate-session']);
  assert.equal(audit.issues[1].count, 2);
});

test('reports low-information Claude goals and ignores metadata-only missing timestamps', () => {
  const result = spawnSync(process.execPath, [script, claudeFixture], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  const audit = JSON.parse(result.stdout);

  assert.equal(audit.packetCount, 2);
  assert.equal(audit.blocking, false);
  assert.deepEqual(
    audit.issues.map((issue) => issue.code),
    ['low_information_task_goal', 'missing_timestamps']
  );
  assert.deepEqual(audit.issues[0].traceIds, ['claude-code:command-goal']);
  assert.equal(audit.issues[0].count, 1);
  assert.equal(audit.issues[1].count, 1);
  assert.equal(audit.issues[1].eventCount, 2);
});
