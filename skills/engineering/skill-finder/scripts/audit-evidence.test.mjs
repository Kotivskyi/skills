import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeEpisode, runScript, tmpDir, writeRun } from './lib/testing.mjs';

function cleanEpisode(n) {
  return makeEpisode({
    n,
    title: `Deploy sim runner ${n}`,
    intents: [{ text: 'deploy the sim runner', pointer: { file: '/x.jsonl', line: 2 } }],
    digest: `digests/claude-sessions__ep-${n}.md`
  });
}

function runWith(episodes) {
  const dir = tmpDir();
  const files = {};
  for (const episode of episodes) if (episode.digest) files[episode.digest] = '# digest\n';
  writeRun(dir, { episodes, files });
  return dir;
}

function audit(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'evidence-audit.json'), 'utf8'));
}

test('clean evidence has no errors and no warnings', () => {
  const dir = runWith([cleanEpisode(1), cleanEpisode(2)]);
  const result = runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl'), '--strict']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.summary, { episodes: 2, errors: 0, warnings: 0, blocking: false });
});

test('a duplicate id blocks and --strict exits 1', () => {
  const dir = runWith([cleanEpisode(1), cleanEpisode(1)]);
  const result = runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl'), '--strict']);
  assert.equal(result.status, 1);
  assert.equal(result.summary.blocking, true);
  assert.equal(audit(dir).errors[0].code, 'duplicate_id');
});

test('a blocking audit without --strict exits 0 and still reports blocking', () => {
  const dir = runWith([cleanEpisode(1), cleanEpisode(1)]);
  const result = runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl')]);
  assert.equal(result.status, 0);
  assert.equal(result.summary.blocking, true);
});

test('a malformed record blocks', () => {
  const { size, ...noSize } = cleanEpisode(2);
  const dir = runWith([cleanEpisode(1), noSize]);
  writeFileSync(path.join(dir, 'evidence.jsonl'), `${readFileSync(path.join(dir, 'evidence.jsonl'), 'utf8')}{not json\n`);
  const result = runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl'), '--strict']);
  assert.equal(result.status, 1);
  const codes = audit(dir).errors.map((error) => error.code);
  assert.deepEqual(codes, ['malformed_record', 'malformed_record']);
  assert.match(audit(dir).errors[0].detail, /missing size/);
});

test('an id without its source prefix is malformed', () => {
  const dir = runWith([{ ...cleanEpisode(1), id: 'ep-1' }]);
  const result = runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl')]);
  assert.match(audit(dir).errors[0].detail, /id does not start with source/);
  assert.equal(result.summary.blocking, true);
});

test('an unknown source blocks unless allowed', () => {
  const episode = { ...cleanEpisode(1), id: 'git-log:abc', source: 'git-log' };
  const dir = runWith([episode]);
  assert.equal(runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl'), '--strict']).status, 1);
  assert.equal(audit(dir).errors[0].code, 'unknown_source');
  const allowed = runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl'), '--strict', '--allow-source', 'git-log']);
  assert.equal(allowed.status, 0);
});

test('warnings do not block', () => {
  const episodes = [
    { ...cleanEpisode(1), intents: [] },
    { ...cleanEpisode(2), title: '03e7c691-22f4-42fd-9919-480a352267a3' },
    { ...cleanEpisode(3), days: [] },
    { ...cleanEpisode(4), redactions: [{ kind: 'api_key', count: 21 }] }
  ];
  const dir = runWith(episodes);
  const missingDigest = { ...cleanEpisode(5), digest: 'digests/none.md' };
  writeFileSync(path.join(dir, 'evidence.jsonl'), `${readFileSync(path.join(dir, 'evidence.jsonl'), 'utf8')}${JSON.stringify(missingDigest)}\n`);
  const result = runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl'), '--strict']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.blocking, false);
  assert.deepEqual(audit(dir).warningCounts, {
    empty_intents: 1,
    low_information_title: 1,
    missing_days: 1,
    high_redaction: 1,
    missing_digest: 1
  });
});

test('summary_missing appears only with --expect-summaries', () => {
  const dir = runWith([cleanEpisode(1)]);
  runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl')]);
  assert.equal(audit(dir).warningCounts.summary_missing, undefined);
  runScript('audit-evidence.mjs', [path.join(dir, 'evidence.jsonl'), '--expect-summaries']);
  assert.equal(audit(dir).warningCounts.summary_missing, 1);
});

test('a missing evidence file exits 2', () => {
  assert.equal(runScript('audit-evidence.mjs', ['/no/such/evidence.jsonl']).status, 2);
});

test('the usage message lists every flag', () => {
  const result = runScript('audit-evidence.mjs', []);
  assert.equal(result.status, 1);
  for (const flag of ['--strict', '--allow-source', '--expect-summaries', '--out']) assert.match(result.stderr, new RegExp(flag), flag);
});
