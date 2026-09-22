import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runScript, tmpDir, writeRun } from './lib/testing.mjs';
import { buildCatalogFixture, writeSkill } from './fixtures/catalog/build.mjs';
import { buildCatalog } from './index-catalog.mjs';
import { quotePrefix } from './verify-suggestion.mjs';

const QUOTE = 'Deploy the sim runner to staging and check the grafana dashboards.';

function setup({ line = 2, file } = {}) {
  const root = tmpDir();
  const { cwd, home } = buildCatalogFixture(root);
  const session = path.join(root, 'session.jsonl');
  writeFileSync(session, [
    JSON.stringify({ type: 'queue-operation', content: 'Deploy the sim runner' }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: QUOTE }, timestamp: '2026-09-01T10:00:00.000Z' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } })
  ].join('\n'));
  const runDir = path.join(root, 'run');
  writeRun(runDir, {
    catalog: buildCatalog({ cwd, home }),
    suggestions: {
      runId: 'r1',
      generatedAt: '2026-09-22T00:00:00.000Z',
      suggestions: [{
        id: 'sf-1',
        kind: 'new-skill',
        title: 'Deploy the sim runner',
        evidence: [{ episodeId: 'claude-sessions:s1', quote: QUOTE, pointer: { file: file ?? session, line } }],
        catalogChecked: [],
        proposal: {
          name: 'sim-runner-deployer',
          description: 'Deploy the sim runner to staging, run the smoke test, and post the grafana dashboard links.',
          triggerPhrases: ['deploy the sim runner'],
          outline: [],
          change: null
        },
        provenance: { episodeIds: ['claude-sessions:s1'] }
      }]
    }
  });
  return { root, cwd, home, runDir };
}

function verifyFile(runDir) {
  return JSON.parse(readFileSync(path.join(runDir, 'verify-sf-1.json'), 'utf8'));
}

test('ok when pointers resolve and the catalog is unchanged', () => {
  const { runDir } = setup();
  const result = runScript('verify-suggestion.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.summary, { id: 'sf-1', status: 'ok', failed: [] });
  const verify = verifyFile(runDir);
  assert.equal(verify.checks.pointersResolve.checked, 1);
  assert.equal(verify.checks.catalogUnchanged.changed, false);
  assert.deepEqual(verify.checks.catalogUnchanged.diff, { added: [], removed: [], changed: [] });
});

test('a moved pointer blocks', () => {
  const { runDir } = setup({ line: 1 });
  const result = runScript('verify-suggestion.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(result.status, 1);
  assert.deepEqual(result.summary.failed, ['pointersResolve']);
  assert.equal(verifyFile(runDir).checks.pointersResolve.failures[0].reason, 'quote not found at pointer');
});

test('a missing file blocks', () => {
  const { runDir } = setup({ file: '/no/such/session.jsonl' });
  const result = runScript('verify-suggestion.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(result.status, 1);
  assert.equal(verifyFile(runDir).checks.pointersResolve.failures[0].reason, 'file or line not found');
});

test('a catalog change is listed but does not block', () => {
  const { runDir, cwd } = setup();
  writeSkill(path.join(cwd, '.agents', 'skills', 'sql-formatter'), { name: 'sql-formatter', description: 'Format SQL files.' });
  const result = runScript('verify-suggestion.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(result.status, 0, result.stderr);
  const verify = verifyFile(runDir);
  assert.equal(verify.checks.catalogUnchanged.changed, true);
  assert.deepEqual(verify.checks.catalogUnchanged.diff.added, ['sql-formatter']);
});

test('a newly added skill that covers the proposal blocks', () => {
  const { runDir, cwd } = setup();
  writeSkill(path.join(cwd, '.agents', 'skills', 'sim-deployer'), {
    name: 'sim-deployer',
    description: 'Deploy the sim runner to staging, run the smoke test, and post grafana dashboard links. Use when the user asks to deploy the sim runner.'
  });
  const result = runScript('verify-suggestion.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(result.status, 1);
  assert.deepEqual(result.summary.failed, ['notNewlyCovered']);
  assert.equal(verifyFile(runDir).checks.notNewlyCovered.coveredBy[0].qualifiedName, 'sim-deployer');
});

test('an unknown id exits 1 and a missing run exits 2', () => {
  const { runDir } = setup();
  assert.equal(runScript('verify-suggestion.mjs', ['--run', runDir, '--id', 'sf-404']).status, 1);
  assert.equal(existsSync(path.join(runDir, 'verify-sf-404.json')), false);
  assert.equal(runScript('verify-suggestion.mjs', ['--run', tmpDir(), '--id', 'sf-1']).status, 2);
});

test('quotePrefix stops at a redaction marker', () => {
  assert.equal(quotePrefix('  Use   Bearer [REDACTED] to call it'), 'Use Bearer');
  assert.equal(quotePrefix('x'.repeat(50)), 'x'.repeat(40));
});

test('an OpenSpec bullet quote matches its raw proposal line', () => {
  const { root, runDir } = setup();
  const proposal = path.join(root, 'proposal.md');
  writeFileSync(proposal, [
    '# Add sim runner deploy',
    '',
    '## What Changes',
    '',
    '- **Deploy script**: add the deploy script for the sim runner.',
    '- Add a smoke test.'
  ].join('\n'));
  const file = path.join(runDir, 'suggestions.json');
  const suggestions = JSON.parse(readFileSync(file, 'utf8'));
  suggestions.suggestions[0].evidence = [{
    episodeId: 'openspec-archive:2026-09-01-add-sim-runner-deploy',
    quote: 'Deploy script: add the deploy script for the sim runner.',
    pointer: { file: proposal, line: 5 }
  }];
  writeFileSync(file, JSON.stringify(suggestions, null, 2));
  const result = runScript('verify-suggestion.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.status, 'ok');
});
