import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES, catalogEntry, makeCatalog, makeEpisode, runScript, tmpDir, writeRun } from './lib/testing.mjs';
import { extractJsonArray } from './check-summaries.mjs';

const SUMMARIES = path.join(FIXTURES, 'summaries');

function threeEpisodeRun() {
  const dir = tmpDir();
  writeRun(dir, { episodes: [1, 2, 3].map((n) => makeEpisode({ n })) });
  return dir;
}

test('a valid batch with a prose preface passes', () => {
  const dir = threeEpisodeRun();
  const result = runScript('check-summaries.mjs', ['--run', dir, '--batch', path.join(SUMMARIES, 'valid-batch.txt')]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.valid, true);
  assert.equal(result.summary.summaries, 2);
});

test('an invalid batch fails with each problem', () => {
  const dir = threeEpisodeRun();
  const result = runScript('check-summaries.mjs', ['--run', dir, '--batch', path.join(SUMMARIES, 'invalid-batch.json')]);
  assert.equal(result.status, 1);
  assert.equal(result.summary.valid, false);
  const problems = result.summary.errors.flatMap((error) => error.problems).join('\n');
  assert.match(problems, /outcome must be one of/);
  assert.match(problems, /unknown episodeId claude-sessions:ep-99/);
  assert.match(problems, /duplicate episodeId/);
});

test('text without a JSON array fails', () => {
  const dir = threeEpisodeRun();
  const file = path.join(dir, 'summaries', 'batch-01.json');
  writeFileSync(file, 'I could not read the digests.');
  const result = runScript('check-summaries.mjs', ['--run', dir, '--batch', file]);
  assert.equal(result.status, 1);
  assert.match(JSON.stringify(result.summary.errors), /no JSON array found/);
});

test('a missing batch file exits 2', () => {
  const dir = threeEpisodeRun();
  assert.equal(runScript('check-summaries.mjs', ['--run', dir, '--batch', path.join(dir, 'nope.json')]).status, 2);
});

test('--plan batches digests in groups of 10 and writes the question', () => {
  const dir = tmpDir();
  const episodes = [];
  const files = {};
  for (let n = 1; n <= 23; n += 1) {
    const digest = `digests/claude-sessions__ep-${n}.md`;
    episodes.push(makeEpisode({ n, digest }));
    files[digest] = `# Episode ${n}\n`;
  }
  episodes.push(makeEpisode({ n: 24, digest: null }));
  writeRun(dir, { episodes, files, catalog: makeCatalog([catalogEntry({ name: 'tdd', description: 'Test-driven development. Use when the user wants tests first.' })]) });
  const result = runScript('check-summaries.mjs', ['--run', dir, '--plan']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.digests, 23);
  assert.equal(result.summary.calls, 3);
  const plan = JSON.parse(readFileSync(path.join(dir, 'summaries', 'plan.json'), 'utf8'));
  assert.deepEqual(plan.batches.map((batch) => batch.episodeIds.length), [10, 10, 3]);
  assert.equal(plan.batches[0].name, 'batch-01');
  assert.equal(plan.batches[0].file, path.join(dir, 'summaries', 'batch-01.json'));
  const question = readFileSync(path.join(dir, 'summaries', 'question.txt'), 'utf8');
  assert.match(question, /^You read digests of coding-agent work\./);
  assert.match(question, /Installed skills:\n- tdd: Test-driven development\./);
});

test('extractJsonArray accepts a wrapped object and rejects prose', () => {
  assert.deepEqual(extractJsonArray('{"summaries":[{"a":1}]}'), [{ a: 1 }]);
  assert.equal(extractJsonArray('no json here'), null);
});

test('valid batches can be copied in as batch files', () => {
  const dir = threeEpisodeRun();
  copyFileSync(path.join(SUMMARIES, 'valid-batch.txt'), path.join(dir, 'summaries', 'batch-01.json'));
  const result = runScript('check-summaries.mjs', ['--run', dir, '--batch', path.join(dir, 'summaries', 'batch-01.json')]);
  assert.equal(result.status, 0);
});

test('--size must be an integer of 1 or more', () => {
  const dir = tmpDir();
  const files = { 'digests/claude-sessions__ep-1.md': '# Episode 1\n', 'digests/claude-sessions__ep-2.md': '# Episode 2\n' };
  writeRun(dir, { episodes: [1, 2].map((n) => makeEpisode({ n, digest: `digests/claude-sessions__ep-${n}.md` })), files });
  for (const size of ['0', '-1', '1.5']) {
    const result = runScript('check-summaries.mjs', ['--run', dir, '--plan', '--size', size], { timeout: 5000 });
    assert.equal(result.status, 1, `--size ${size}: status ${result.status}, signal ${result.signal ?? 'none'}`);
    assert.match(result.stderr, /--size/);
  }
});
