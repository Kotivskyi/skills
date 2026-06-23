import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const codexFixture = join(here, 'fixtures/codex/session.jsonl');
const claudeFixture = join(here, 'fixtures/claude/session.jsonl');
const codexScript = join(here, 'normalize_codex_session.mjs');
const claudeScript = join(here, 'normalize_claude_session.mjs');
const checker = join(here, 'check_trace_packets.mjs');

async function runNormalizer(script, input, output, extra = []) {
  const result = spawnSync(process.execPath, [script, '--input', input, '--output', output, ...extra], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const check = spawnSync(process.execPath, [checker, output], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  return JSON.parse(await readFile(output, 'utf8'));
}

test('codex normalizer emits valid redacted trace packets with failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-normalizer-'));
  const output = join(dir, 'trace-packets.json');
  const packets = await runNormalizer(codexScript, codexFixture, output, ['--session-id', 'codex-fixture']);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].source, 'codex');
  assert.equal(packets[0].scope.id, 'codex-fixture');
  assert.ok(packets[0].failures.length > 0);
  assert.ok(packets[0].userInterventions.length > 0);
  const serialized = JSON.stringify(packets);
  assert.equal(serialized.includes('sk-test-fixture'), false);
  assert.ok(packets[0].redactions.length > 0);
});

test('claude normalizer emits valid redacted trace packets with failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-normalizer-'));
  const output = join(dir, 'trace-packets.json');
  const packets = await runNormalizer(claudeScript, claudeFixture, output, ['--session-id', 'claude-fixture']);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].source, 'claude-code');
  assert.equal(packets[0].scope.id, 'claude-fixture');
  assert.ok(packets[0].failures.length > 0);
  assert.ok(packets[0].timeline.some((event) => event.kind === 'sidechain'));
  const serialized = JSON.stringify(packets);
  assert.equal(serialized.includes('private.internal'), false);
  assert.ok(packets[0].redactions.length > 0);
});
