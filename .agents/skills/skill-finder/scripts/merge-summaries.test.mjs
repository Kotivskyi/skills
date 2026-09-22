import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES, makeEpisode, runScript, tmpDir, writeRun } from './lib/testing.mjs';

const SUMMARIES = path.join(FIXTURES, 'summaries');

function evidence(dir) {
  return readFileSync(path.join(dir, 'evidence.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('merges valid batches, skips invalid ones, and fills outcomes', () => {
  const dir = tmpDir();
  writeRun(dir, {
    episodes: [1, 2, 3].map((n) => makeEpisode({ n })),
    runJson: { runId: 'r1', summaryBackend: null }
  });
  copyFileSync(path.join(SUMMARIES, 'valid-batch.txt'), path.join(dir, 'summaries', 'batch-01.json'));
  copyFileSync(path.join(SUMMARIES, 'invalid-batch.json'), path.join(dir, 'summaries', 'batch-02.json'));
  const result = runScript('merge-summaries.mjs', ['--run', dir, '--backend', 'pi']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.summary, {
    merged: 2,
    invalidBatches: ['batch-02.json'],
    outcomesFilled: 2,
    batches: 2,
    backend: 'pi'
  });
  const [ep1, ep2, ep3] = evidence(dir);
  assert.equal(ep1.summary.goal, 'Deploy the sim runner to staging');
  assert.equal('episodeId' in ep1.summary, false);
  assert.equal(ep1.outcome, 'completed');
  assert.equal(ep2.outcome, 'partial');
  assert.equal(ep3.summary, null);
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
  assert.equal(run.summaryBackend, 'pi');
  assert.deepEqual(run.summaries, { merged: 2, invalidBatches: ['batch-02.json'] });
});

test('--backend none with no batches only records the backend', () => {
  const dir = tmpDir();
  writeRun(dir, { episodes: [makeEpisode({ n: 1 })] });
  const result = runScript('merge-summaries.mjs', ['--run', dir, '--backend', 'none']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.merged, 0);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')).summaryBackend, 'none');
});

test('an unknown backend exits 1', () => {
  const dir = tmpDir();
  writeRun(dir, { episodes: [makeEpisode({ n: 1 })] });
  assert.equal(runScript('merge-summaries.mjs', ['--run', dir, '--backend', 'gpt']).status, 1);
});
