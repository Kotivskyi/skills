import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

test('codex normalizer recovers task goal and ignores planned or green failure language', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-normalizer-targeted-'));
  const input = join(dir, 'session.jsonl');
  const output = join(dir, 'trace-packets.json');
  const rows = [
    {
      type: 'session_meta',
      timestamp: '2026-06-23T10:00:00.000Z',
      payload: { id: 'codex-targeted', cwd: '/repo' }
    },
    {
      type: 'response_item',
      timestamp: '2026-06-23T10:01:00.000Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md instructions for /repo\n\n<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>' }]
      }
    },
    {
      type: 'response_item',
      timestamp: '2026-06-23T10:01:30.000Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '<codex_internal_context source="goal">Continue working toward the active thread goal. <objective>Please repair dashboard route generation for tenant pages.</objective></codex_internal_context>'
          }
        ]
      }
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-23T10:02:00.000Z',
      payload: {
        type: 'agent_message',
        message: 'The red test is in place. It should fail until the implementation exists.'
      }
    },
    {
      type: 'response_item',
      timestamp: '2026-06-23T10:03:00.000Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call_green',
        output: 'Process exited with code 0\nOutput:\nPASS green-missing-name.spec.ts'
      }
    },
    {
      type: 'response_item',
      timestamp: '2026-06-23T10:04:00.000Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call_red',
        output: 'Process exited with code 1\nOutput:\nreal-error: route generation crashed'
      }
    }
  ];
  await writeFile(input, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const packets = await runNormalizer(codexScript, input, output, ['--session-id', 'codex-targeted']);
  assert.equal(packets.length, 1);
  assert.match(packets[0].task.goal, /repair dashboard route generation/);
  assert.equal(packets[0].task.goal.includes('codex_internal_context'), false);
  assert.equal(packets[0].task.goal.includes('response_item'), false);
  assert.equal(packets[0].outcome.status, 'failed');
  assert.equal(packets[0].failures.length, 1);
  assert.match(packets[0].failures[0].summary, /real-error/);
  assert.equal(JSON.stringify(packets[0].failures).includes('green-missing-name'), false);
  assert.equal(JSON.stringify(packets[0].failures).includes('should fail'), false);
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
