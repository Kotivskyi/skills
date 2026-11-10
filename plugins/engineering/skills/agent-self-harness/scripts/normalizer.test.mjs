import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as zlib from 'node:zlib';

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

test('codex normalizer reads a zstd-compressed session file', { skip: typeof zlib.zstdCompressSync !== 'function' && 'this Node has no zstd' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-normalizer-zst-'));
  const input = join(dir, 'session.jsonl.zst');
  await writeFile(input, zlib.zstdCompressSync(await readFile(codexFixture)));
  const plain = await runNormalizer(codexScript, codexFixture, join(dir, 'plain.json'), ['--session-id', 'codex-fixture']);
  const packed = await runNormalizer(codexScript, input, join(dir, 'packed.json'), ['--session-id', 'codex-fixture']);
  const withoutFiles = (packets) => JSON.stringify(packets, (key, value) => (key === 'file' ? undefined : value));
  assert.equal(withoutFiles(packed), withoutFiles(plain));
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
  assert.equal(packets[0].userInterventions.length, 0);
  assert.equal(packets[0].outcome.signals.includes('user_intervention'), false);
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

async function writeRows(dir, name, rows) {
  const path = join(dir, name);
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return path;
}

test('claude normalizer takes the session id of the session that wrote the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-normalizer-session-id-'));
  const message = (sessionId, uuid, text) => ({
    type: 'user', sessionId, uuid, timestamp: '2026-11-09T10:00:00.000Z', message: { role: 'user', content: text }
  });
  // The first record has no id. A fork also copies the records of the earlier session first.
  const input = await writeRows(dir, 'session.jsonl', [
    { type: 'fork-context-ref', timestamp: '2026-11-09T09:59:00.000Z' },
    message('earlier-session', 'u1', 'Copied history from the earlier session.'),
    message('this-session', 'u2', 'New work in this session.')
  ]);
  const packets = await runNormalizer(claudeScript, input, join(dir, 'out.json'));
  assert.equal(packets[0].scope.id, 'this-session');
  assert.equal(packets[0].traceId, 'claude-code:this-session');

  // A time window that keeps only the copied records does not change the session of the file.
  const early = await writeRows(dir, 'session-window.jsonl', [
    { ...message('earlier-session', 'u1', 'Copied history.'), timestamp: '2026-11-09T09:00:00.000Z' },
    { ...message('this-session', 'u2', 'New work.'), timestamp: '2026-11-09T11:00:00.000Z' }
  ]);
  const windowed = await runNormalizer(claudeScript, early, join(dir, 'window.json'), ['--until', '2026-11-09T10:00:00.000Z']);
  assert.equal(windowed[0].scope.id, 'this-session');
  assert.equal(windowed[0].timeline.length, 1);
});

test('claude normalizer gives a subagent file its own trace id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-normalizer-subagent-'));
  const input = await writeRows(dir, 'agent-a1b2.jsonl', [
    { type: 'fork-context-ref', timestamp: '2026-11-09T09:59:00.000Z' },
    {
      type: 'user', sessionId: 'parent-session', agentId: 'a1b2', isSidechain: true, uuid: 'u1',
      timestamp: '2026-11-09T10:00:00.000Z', message: { role: 'user', content: 'Find the flaky test.' }
    }
  ]);
  const packets = await runNormalizer(claudeScript, input, join(dir, 'out.json'));
  assert.equal(packets[0].traceId, 'claude-code:parent-session:agent-a1b2');
  assert.deepEqual(packets[0].scope, { kind: 'subagent', id: 'a1b2' });

  // A workflow journal has agentId records too, but no sidechain records. It is not a subagent.
  const journal = await writeRows(dir, 'journal.jsonl', [
    { type: 'started', sessionId: 'main-session', agentId: 'c3d4', timestamp: '2026-11-09T10:00:00.000Z' }
  ]);
  const [journalPacket] = await runNormalizer(claudeScript, journal, join(dir, 'journal-out.json'));
  assert.deepEqual(journalPacket.scope, { kind: 'session', id: 'main-session' });
});

test('codex normalizer takes the thread id and keeps items whose payload has an id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-normalizer-thread-id-'));
  // A forked subagent thread: payload.id is the thread, payload.session_id is the root session.
  // The fork copies the session_meta of the root after its own session_meta.
  // Here the copied root session_meta is the last record with an id, so "the last id wins" gives the wrong thread.
  const input = await writeRows(dir, 'rollout.jsonl', [
    {
      type: 'session_meta', timestamp: '2026-11-09T10:00:00.000Z',
      payload: { id: 'child-thread', session_id: 'root-session', parent_thread_id: 'root-session', cwd: '/repo' }
    },
    {
      type: 'token_usage_record', timestamp: '2026-11-09T10:00:00.500Z',
      payload: { thread_id: 'child-thread', session_id: 'root-session' }
    },
    { type: 'session_meta', timestamp: '2026-11-09T10:00:01.000Z', payload: { id: 'root-session', session_id: 'root-session', cwd: '/repo' } },
    {
      type: 'response_item', timestamp: '2026-11-09T10:01:00.000Z',
      payload: { type: 'message', id: 'msg_1', role: 'user', content: [{ type: 'input_text', text: 'Check the build.' }] }
    },
    {
      type: 'response_item', timestamp: '2026-11-09T10:02:00.000Z',
      payload: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'shell', arguments: '{"cmd":"make"}' }
    }
  ]);
  const all = await runNormalizer(codexScript, input, join(dir, 'all.json'));
  assert.equal(all[0].scope.id, 'child-thread');
  assert.equal(all[0].traceId, 'codex:child-thread');
  // The filter drops only the copied root session_meta.
  const filtered = await runNormalizer(codexScript, input, join(dir, 'filtered.json'), ['--session-id', 'child-thread']);
  assert.equal(filtered[0].timeline.length, all[0].timeline.length - 1);
  // A time window without the session_meta rows does not change the thread of the file.
  const windowed = await runNormalizer(codexScript, input, join(dir, 'window.json'), ['--since', '2026-11-09T10:00:30.000Z']);
  assert.equal(windowed[0].scope.id, 'child-thread');

  // The older rollout format has the session id in a first line with no type.
  const legacy = await writeRows(dir, 'legacy.jsonl', [
    { id: 'legacy-session', timestamp: '2026-11-09T10:00:00.000Z', instructions: null },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Old format.' }] }
  ]);
  const [legacyPacket] = await runNormalizer(codexScript, legacy, join(dir, 'legacy-out.json'));
  assert.equal(legacyPacket.scope.id, 'legacy-session');
});

test('codex normalizer treats custom tool calls as tool records and reads array output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-normalizer-custom-tool-'));
  const input = await writeRows(dir, 'rollout.jsonl', [
    { type: 'session_meta', timestamp: '2026-11-09T10:00:00.000Z', payload: { id: 'custom-tool', cwd: '/repo' } },
    {
      // A request is not a result, even when its input has the word error.
      type: 'response_item', timestamp: '2026-11-09T10:01:00.000Z',
      payload: { type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_a', name: 'exec', input: 'rg -n "error" src/ && pnpm test --filter api' }
    },
    {
      type: 'response_item', timestamp: '2026-11-09T10:02:00.000Z',
      payload: {
        type: 'custom_tool_call_output', id: 'ctco_1', call_id: 'call_a',
        output: [{ type: 'input_text', text: 'Process exited with code 1\nOutput:\nFAIL route.spec.ts' }]
      }
    },
    {
      // Code-mode output gives the status as JSON. Exit code 0 is not a failure, even with the word error.
      type: 'response_item', timestamp: '2026-11-09T10:03:00.000Z',
      payload: {
        type: 'custom_tool_call_output', id: 'ctco_2', call_id: 'call_b',
        output: [{ type: 'input_text', text: 'Script completed\nOutput:\n{"chunk_id":"c1","exit_code":0,"output":"src/log.ts: error handler ok"}' }]
      }
    },
    {
      // The exit code can come after the 700 characters that the summary keeps.
      type: 'response_item', timestamp: '2026-11-09T10:04:00.000Z',
      payload: {
        type: 'custom_tool_call_output', id: 'ctco_3', call_id: 'call_c',
        output: [{ type: 'input_text', text: `Script completed\nOutput:\n{"chunk_id":"c2","output":"${'x'.repeat(800)}","exit_code":2}` }]
      }
    }
  ]);
  const [packet] = await runNormalizer(codexScript, input, join(dir, 'out.json'));
  const [call, failed, passed, late] = packet.timeline.slice(1);
  assert.deepEqual([call.actor, call.kind], ['tool', 'tool']);
  assert.match(call.summary, /pnpm test --filter api/);
  assert.deepEqual([failed.actor, failed.kind], ['tool', 'tool']);
  assert.ok(failed.summary.startsWith('Process exited with code 1'));
  assert.equal(failed.summary.includes('call_a'), false);
  assert.equal(failed.summary.includes('input_text'), false);
  assert.match(passed.summary, /error handler ok/);
  assert.deepEqual(packet.failures.map((failure) => failure.rawPointer.line), [failed.rawPointer.line, late.rawPointer.line]);
});
