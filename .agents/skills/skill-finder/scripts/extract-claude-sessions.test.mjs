import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES, runScript, tmpDir } from './lib/testing.mjs';
import { cleanUserText, isCorrection, isRepeatedInstruction } from './extract-claude-sessions.mjs';

const STORE = path.join(FIXTURES, 'claude-sessions', 'store');
const A = 'claude-sessions:11111111-1111-4111-8111-111111111111';

function evidence(runDir) {
  return readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('extracts one redacted episode per session with sidechain counts', () => {
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--store', STORE, '--out', runDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.source, 'claude-sessions');
  assert.equal(result.summary.episodes, 2);
  assert.equal(result.summary.skipped, 0);
  assert.ok(result.summary.bytes > 0);

  const records = evidence(runDir);
  const a = records.find((record) => record.id === A);
  assert.ok(a, 'session A is present');
  assert.ok(records.every((record) => record.id.startsWith('claude-sessions:')));
  assert.equal(a.project, '/work/pastorix');
  assert.equal(a.title, 'Deploy sim runner to staging');
  assert.deepEqual(a.days, ['2026-09-01', '2026-09-02']);
  assert.equal(a.startedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(a.endedAt, '2026-09-02T08:05:00.000Z');
  assert.deepEqual(a.intents.map((intent) => intent.pointer.line), [2, 6, 11, 12]);
  assert.match(a.intents[0].text, /\[REDACTED_ENV_SECRET\]/);
  assert.equal(a.intents[1].text, 'staging rollout for the sim runner');
  assert.deepEqual(a.commandsUsed, [{ name: '/plan', count: 1 }]);
  assert.deepEqual(a.skillsInvoked, [
    { name: 'superpowers:brainstorming', count: 1, sidechain: false },
    { name: 'tdd', count: 1, sidechain: true }
  ]);
  assert.deepEqual(a.toolsUsed, { Bash: 2, Edit: 1, Read: 1, Skill: 2 });
  assert.deepEqual(a.commandPatterns, [
    { pattern: 'pnpm lint', count: 1 },
    { pattern: 'pnpm test', count: 1 }
  ]);
  assert.equal(a.userCorrections.length, 1);
  assert.equal(a.userCorrections[0].pointer.line, 11);
  assert.equal(a.repeatedInstructions.length, 1);
  assert.deepEqual(a.artifacts, ['scripts/deploy.sh']);
  assert.equal(a.outcome, 'unknown');
  assert.equal(a.size.userMessages, 4);
  assert.equal(a.size.assistantMessages, 4);
  assert.equal(a.size.toolCalls, 6);
  assert.equal(a.size.sidechainToolCalls, 3);
  assert.equal(a.summary, null);
  assert.deepEqual(a.redactions, [{ kind: 'env_secret', count: 1 }]);
  assert.equal(a.digest, 'digests/claude-sessions__11111111-1111-4111-8111-111111111111.md');

  const serialized = readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8');
  const digest = readFileSync(path.join(runDir, a.digest), 'utf8');
  for (const text of [serialized, digest]) {
    assert.equal(text.includes('sk-live-fixture-123'), false);
    assert.equal(text.includes('sk-leaked-in-tool-output'), false);
    assert.equal(text.includes('Base directory for this skill'), false);
  }
  assert.match(digest, /\[skill\] superpowers:brainstorming/);
  assert.match(digest, /\[tool\] Bash: pnpm test --filter sim/);
  assert.match(digest, /assistant: Deployed to staging\./);

  const b = records.find((record) => record.id !== A);
  assert.equal(b.title, 'Fix the flaky herds migration test in CI please, it fails every second run.');
});

test('--since skips older sessions', () => {
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--store', STORE, '--out', runDir, '--since', '2026-08-25']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.episodes, 1);
  assert.equal(result.summary.skipped, 1);
});

test('a second run does not duplicate episodes', () => {
  const runDir = tmpDir();
  runScript('extract-claude-sessions.mjs', ['--store', STORE, '--out', runDir]);
  const again = runScript('extract-claude-sessions.mjs', ['--store', STORE, '--out', runDir]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.summary.episodes, 0);
  assert.equal(again.summary.skipped, 2);
  assert.equal(evidence(runDir).length, 2);
});

test('--max-episodes keeps the newest sessions', () => {
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--store', STORE, '--out', runDir, '--max-episodes', '1']);
  assert.equal(result.summary.episodes, 1);
  assert.equal(result.summary.skipped, 1);
  assert.equal(evidence(runDir)[0].id, A);
});

test('--project encodes the path under --home', () => {
  const home = tmpDir();
  const store = path.join(home, '.claude', 'projects', '-work-my-app');
  mkdirSync(store, { recursive: true });
  cpSync(path.join(STORE, '22222222-2222-4222-8222-222222222222.jsonl'), path.join(store, '22222222-2222-4222-8222-222222222222.jsonl'));
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--home', home, '--project', '/work/my.app', '--out', runDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.episodes, 1);
});

test('the digest is capped at 24 KB', () => {
  const store = tmpDir();
  const rows = [];
  for (let i = 0; i < 80; i += 1) {
    rows.push(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: `Prompt ${i}: ${'describe the herd rotation plan in detail '.repeat(12)}` },
      uuid: `u${i}`,
      timestamp: `2026-09-03T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
      sessionId: '33333333-3333-4333-8333-333333333333'
    }));
  }
  writeFileSync(path.join(store, '33333333-3333-4333-8333-333333333333.jsonl'), `${rows.join('\n')}\n`);
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--store', store, '--out', runDir]);
  assert.equal(result.status, 0, result.stderr);
  const digest = readFileSync(path.join(runDir, evidence(runDir)[0].digest));
  assert.ok(digest.length <= 24 * 1024, `digest has ${digest.length} bytes`);
  assert.match(digest.toString('utf8'), /\[\.\.\. digest cut/);
});

test('a missing store exits 2', () => {
  const result = runScript('extract-claude-sessions.mjs', ['--store', '/no/such/store', '--out', tmpDir()]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /store not found/);
});

test('a missing --out exits 1', () => {
  const result = runScript('extract-claude-sessions.mjs', ['--store', STORE]);
  assert.equal(result.status, 1);
});

test('cleanUserText strips wrappers and reads command args', () => {
  assert.deepEqual(cleanUserText('<local-command-caveat>x</local-command-caveat>'), { skip: true, command: null, text: '' });
  assert.deepEqual(
    cleanUserText('<command-name>/ship</command-name><command-args>the api</command-args>'),
    { skip: false, command: '/ship', text: 'the api' }
  );
  assert.equal(cleanUserText('<system-reminder>ignore</system-reminder> real text').text, 'real text');
  assert.equal(cleanUserText('[Request interrupted by user]').text, '');
});

test('correction and repeated-instruction heuristics', () => {
  assert.equal(isCorrection('no, use pnpm'), true);
  assert.equal(isCorrection('use the other file instead'), true);
  assert.equal(isCorrection('looks good, ship it'), false);
  assert.equal(isRepeatedInstruction('always run the tests'), false);
  assert.equal(isRepeatedInstruction(`Remember to always run the contracts check before you deploy anything to staging, every time.`), true);
});

// Writes one session file into a new temporary store. Each row gets the common record fields.
function writeSession(sessionId, rows) {
  const store = tmpDir();
  const lines = rows.map((row, index) => JSON.stringify({
    parentUuid: index ? `r${index - 1}` : null,
    isSidechain: false,
    uuid: `r${index}`,
    timestamp: `2026-09-05T10:${String(index).padStart(2, '0')}:00.000Z`,
    cwd: '/work/app',
    sessionId,
    ...row
  }));
  writeFileSync(path.join(store, `${sessionId}.jsonl`), `${lines.join('\n')}\n`);
  return store;
}

test('a compact-summary user record is not a human intent', () => {
  const summary = 'No, that is wrong. This session is being continued from a previous conversation. Always run the contracts check before you deploy anything, and never skip it.';
  const store = writeSession('44444444-4444-4444-8444-444444444444', [
    { type: 'user', message: { role: 'user', content: 'Add a health check to the sim runner.' }, origin: { kind: 'human' } },
    { type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] } },
    { type: 'user', message: { role: 'user', content: summary }, isCompactSummary: true, isVisibleInTranscriptOnly: true }
  ]);
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--store', store, '--out', runDir]);
  assert.equal(result.status, 0, result.stderr);
  const [record] = evidence(runDir);
  assert.equal(record.intents.length, 1);
  assert.deepEqual(record.userCorrections, []);
  assert.deepEqual(record.repeatedInstructions, []);
  const serialized = readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8');
  const digest = readFileSync(path.join(runDir, record.digest), 'utf8');
  for (const text of [serialized, digest]) {
    assert.equal(text.includes('being continued from a previous conversation'), false);
  }
});

test('a digest user turn is at most 600 characters', () => {
  const prompt = 'plan the herd rotation for the north pasture group '.repeat(46).slice(0, 2300);
  assert.equal(prompt.length, 2300);
  const store = writeSession('55555555-5555-4555-8555-555555555555', [
    { type: 'user', message: { role: 'user', content: prompt }, origin: { kind: 'human' } }
  ]);
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--store', store, '--out', runDir]);
  assert.equal(result.status, 0, result.stderr);
  const digest = readFileSync(path.join(runDir, evidence(runDir)[0].digest), 'utf8');
  const userLines = digest.split('\n').filter((line) => line.startsWith('user: '));
  assert.equal(userLines.length, 1);
  assert.ok(userLines[0].length <= 606, `user line has ${userLines[0].length} characters`);
});

test('a Bash digest line is redacted before it is cut to 80 characters', () => {
  const token = 'ghp_Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2';
  const prefix = 'curl -s -H "Accept: application/json" https://api.example.com/herds -u ';
  assert.ok(prefix.length < 79 && prefix.length + token.length > 80, 'the token crosses column 80');
  const store = writeSession('66666666-6666-4666-8666-666666666666', [
    { type: 'user', message: { role: 'user', content: 'List the herds from the api.' }, origin: { kind: 'human' } },
    {
      type: 'assistant',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `${prefix}${token} -o herds.json\necho done` } }] }
    }
  ]);
  const runDir = tmpDir();
  const result = runScript('extract-claude-sessions.mjs', ['--store', store, '--out', runDir]);
  assert.equal(result.status, 0, result.stderr);
  const [record] = evidence(runDir);
  const digest = readFileSync(path.join(runDir, record.digest), 'utf8');
  for (let i = 0; i + 8 <= token.length; i += 1) {
    assert.equal(digest.includes(token.slice(i, i + 8)), false, `digest holds ${token.slice(i, i + 8)}`);
  }
  assert.ok(record.redactions.some((entry) => entry.kind === 'long_token' && entry.count >= 1), JSON.stringify(record.redactions));
});
