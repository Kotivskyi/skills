import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { runScript, tmpDir } from './lib/testing.mjs';
import { buildWorld } from '../evals/fixtures/make-world.mjs';

function pipeline() {
  const world = buildWorld(path.join(tmpDir(), 'world'));
  const run = path.join(world.project, '.skill-finder', 'runs', '20260922-120000-test');
  const steps = [
    ['init-run.mjs', ['--cwd', world.project, '--out', run, '--now', '2026-09-22T12:00:00.000Z']],
    ['extract-claude-sessions.mjs', ['--out', run, '--store', world.store]],
    ['extract-openspec-archive.mjs', ['--out', run, '--path', world.archive]],
    ['audit-evidence.mjs', [path.join(run, 'evidence.jsonl'), '--strict']],
    ['index-catalog.mjs', ['--cwd', world.project, '--home', world.home, '--out', path.join(run, 'catalog.json')]],
    ['merge-summaries.mjs', ['--run', run, '--backend', 'none']],
    ['aggregate.mjs', ['--run', run, '--previous', 'auto']]
  ];
  for (const [script, args] of steps) {
    const result = runScript(script, args);
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
  return { world, run, aggregate: JSON.parse(readFileSync(path.join(run, 'aggregate.json'), 'utf8')) };
}

test('the eval world yields each suggestion kind and the previous-run statuses', () => {
  const { aggregate } = pipeline();
  const find = (predicate) => aggregate.candidates.find(predicate);
  const deploy = find((candidate) => candidate.key.includes('deploy sim runner'));
  assert.ok(deploy, JSON.stringify(aggregate.candidates.map((candidate) => candidate.key)));
  assert.equal(deploy.kindHint, 'new-skill');
  assert.deepEqual(deploy.sources, ['claude-sessions', 'openspec-archive']);
  assert.equal(find((candidate) => candidate.kindTarget === 'write-http-files')?.kindHint, 'silent-skill');
  assert.equal(find((candidate) => candidate.kindTarget === 'release-notes')?.kindHint, 'misfiring-skill');
  assert.equal(find((candidate) => candidate.kindTarget === 'acme-tools:changelog-writer')?.kindHint, 'misfiring-skill');
  assert.equal(aggregate.candidates.some((candidate) => candidate.key.includes('grafana')), false);
  assert.ok(aggregate.belowThreshold.some((entry) => entry.key.includes('grafana')));
  const status = Object.fromEntries(aggregate.previous.statuses.map((entry) => [entry.id, entry.status]));
  assert.deepEqual(status, { 'sf-20260901-01': 'resolved', 'sf-20260901-02': 'still-open', 'sf-20260901-03': 'stale' });
});

test('the prepared run blocks at verify', () => {
  const world = buildWorld(path.join(tmpDir(), 'world'));
  const result = runScript('verify-suggestion.mjs', ['--run', world.prepared, '--id', 'sf-20260922-01']);
  assert.equal(result.status, 1);
  assert.deepEqual(result.summary.failed, ['pointersResolve']);
});

test('the world gives a full harvest for the deploy work and a shortfall for the HTTP work', () => {
  const { run, aggregate } = pipeline();
  const deploy = aggregate.candidates.find((candidate) => candidate.key.includes('deploy sim runner'));
  const http = aggregate.candidates.find((candidate) => candidate.kindTarget === 'write-http-files');
  const suggestion = (id, candidate, title, proposal) => ({
    id, kind: candidate.kindHint, title, candidateKeys: [candidate.key], proposal, provenance: { episodeIds: candidate.episodeIds }
  });
  writeFileSync(path.join(run, 'suggestions.json'), JSON.stringify({
    runId: '20260922-120000-test',
    generatedAt: '2026-09-22T12:30:00.000Z',
    suggestions: [
      suggestion('sf-deploy', deploy, 'Deploy the sim runner to staging', {
        name: 'deploy-sim-runner', description: 'Deploy the sim runner to staging and verify it.',
        triggerPhrases: ['deploy the sim runner', 'push the simulator to staging'], outline: [], change: null
      }),
      suggestion('sf-http', http, 'Write HTTP request files for an API', {
        name: null, description: null, triggerPhrases: ['write http request files'], outline: [],
        change: { skill: 'write-http-files', path: 'x', origin: 'repo', descriptionBefore: 'a', descriptionAfter: 'b' }
      })
    ],
    rejected: []
  }));
  const full = runScript('harvest-evals.mjs', ['--run', run, '--id', 'sf-deploy']);
  assert.equal(full.status, 0, full.stderr);
  assert.ok(full.summary.real.total >= 50, JSON.stringify(full.summary.real));
  assert.equal(full.summary.shortfall.total, 0);
  const thin = runScript('harvest-evals.mjs', ['--run', run, '--id', 'sf-http']);
  assert.equal(thin.status, 0, thin.stderr);
  assert.ok(thin.summary.shortfall.total > 0);
});

test('make-world refuses a folder that is not a world', () => {
  const dest = tmpDir();
  mkdirSync(path.join(dest, 'keep'), { recursive: true });
  assert.throws(() => buildWorld(dest), /is not a skill-finder world/);
});
