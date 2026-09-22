import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runScript, tmpDir } from './lib/testing.mjs';
import { runStamp, slugify } from './init-run.mjs';

test('creates the run folder and run.json', () => {
  const cwd = tmpDir();
  const result = runScript('init-run.mjs', [
    '--cwd', cwd, '--slug', 'Pastorix Backend', '--now', '2026-09-22T18:10:00.000Z',
    '--source', 'claude-sessions --project /work/pastorix', '--since', '2026-06-01'
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.runId, '20260922-181000-pastorix-backend');
  assert.equal(result.summary.run, path.join(cwd, '.skill-finder', 'runs', '20260922-181000-pastorix-backend'));
  assert.equal(result.summary.gitignoreWarning, true);
  assert.ok(existsSync(path.join(result.summary.run, 'digests')));
  assert.ok(existsSync(path.join(result.summary.run, 'summaries')));
  const run = JSON.parse(readFileSync(path.join(result.summary.run, 'run.json'), 'utf8'));
  assert.equal(run.cwd, cwd);
  assert.deepEqual(run.sources, ['claude-sessions --project /work/pastorix']);
  assert.deepEqual(run.window, { since: '2026-06-01', until: null, maxEpisodes: null });
  assert.deepEqual(run.thresholds, { minEpisodes: 3, minDays: 2 });
  assert.equal(run.summaryBackend, null);
  assert.equal(run.versions.skillFinder, 1);
});

test('no warning when .gitignore covers .skill-finder', () => {
  const cwd = tmpDir();
  writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n.skill-finder/\n');
  const result = runScript('init-run.mjs', ['--cwd', cwd, '--now', '2026-09-22T18:10:00.000Z']);
  assert.equal(result.summary.gitignoreWarning, false);
});

test('--out overrides the folder and skips the gitignore warning', () => {
  const cwd = tmpDir();
  const out = path.join(tmpDir(), 'my-run');
  const result = runScript('init-run.mjs', ['--cwd', cwd, '--out', out, '--now', '2026-09-22T18:10:00.000Z']);
  assert.equal(result.summary.run, out);
  assert.equal(result.summary.gitignoreWarning, false);
});

test('refuses to reuse a run folder', () => {
  const cwd = tmpDir();
  const args = ['--cwd', cwd, '--now', '2026-09-22T18:10:00.000Z'];
  assert.equal(runScript('init-run.mjs', args).status, 0);
  assert.equal(runScript('init-run.mjs', args).status, 1);
});

test('runStamp and slugify', () => {
  assert.equal(runStamp(new Date('2026-01-02T03:04:05.000Z')), '20260102-030405');
  assert.equal(slugify('  My Repo!! v2 '), 'my-repo-v2');
  assert.equal(slugify('***'), 'run');
});
