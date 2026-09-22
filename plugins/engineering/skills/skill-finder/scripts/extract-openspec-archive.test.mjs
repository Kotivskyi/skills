import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES, runScript, tmpDir } from './lib/testing.mjs';
import { findSection, firstBullets, firstParagraph, taskOutcome } from './extract-openspec-archive.mjs';

const ROOT = path.join(FIXTURES, 'openspec-archive');
const ARCHIVE = path.join(ROOT, 'openspec', 'changes', 'archive');

function evidence(runDir) {
  return readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('extracts one episode per archived change', () => {
  const runDir = tmpDir();
  const result = runScript('extract-openspec-archive.mjs', ['--path', ARCHIVE, '--out', runDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    { source: result.summary.source, episodes: result.summary.episodes, skipped: result.summary.skipped },
    { source: 'openspec-archive', episodes: 3, skipped: 1 }
  );
  const records = evidence(runDir);
  assert.deepEqual(records.map((record) => record.id), [
    'openspec-archive:2026-09-01-add-sim-runner-deploy',
    'openspec-archive:2026-09-05-fix-grafana-alerts',
    'openspec-archive:2026-09-10-drop-legacy-api'
  ]);
  const [deploy, grafana, legacy] = records;

  assert.equal(deploy.project, ROOT);
  assert.deepEqual(deploy.days, ['2026-08-29', '2026-09-01']);
  assert.equal(deploy.startedAt, '2026-08-29T00:00:00.000Z');
  assert.equal(deploy.endedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(deploy.title, 'add sim runner deploy');
  assert.equal(deploy.intents.length, 4);
  assert.equal(deploy.intents[0].text, 'The sim runner is deployed by hand. Each deploy takes an hour and the steps live in chat history only.');
  assert.equal(deploy.intents[0].pointer.line, 3);
  assert.equal(deploy.intents[1].text, 'Add a deploy script for the sim runner.');
  assert.equal(deploy.outcome, 'completed');
  assert.equal(deploy.size.toolCalls, 3);
  assert.equal(deploy.size.assistantMessages, 0);
  assert.deepEqual(deploy.artifacts, ['deploy-checks', 'sim-runner']);
  assert.deepEqual(deploy.commandPatterns.map((entry) => entry.pattern).sort(), ['./scripts/deploy-sim.sh staging', 'kubectl rollout', 'pnpm test']);

  assert.equal(grafana.title, 'Fix Grafana alerts');
  assert.equal(grafana.outcome, 'partial');
  assert.equal(grafana.intents.length, 3);
  assert.deepEqual(grafana.redactions, [{ kind: 'authorization', count: 1 }]);

  assert.deepEqual(legacy.days, ['2026-09-10']);
  assert.equal(legacy.outcome, 'abandoned');
  assert.equal(legacy.intents.length, 1);
  assert.deepEqual(legacy.artifacts, []);

  const serialized = readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8');
  const digest = readFileSync(path.join(runDir, grafana.digest), 'utf8');
  assert.equal(serialized.includes('abc.def-123456'), false);
  assert.equal(digest.includes('abc.def-123456'), false);
  assert.match(digest, /## Proposal/);
  assert.match(digest, /## Tasks/);
});

test('--since filters on the archive date', () => {
  const runDir = tmpDir();
  const result = runScript('extract-openspec-archive.mjs', ['--path', ARCHIVE, '--out', runDir, '--since', '2026-09-04']);
  assert.equal(result.summary.episodes, 2);
  assert.equal(result.summary.skipped, 2);
});

test('a second run does not duplicate episodes', () => {
  const runDir = tmpDir();
  runScript('extract-openspec-archive.mjs', ['--path', ARCHIVE, '--out', runDir]);
  const again = runScript('extract-openspec-archive.mjs', ['--path', ARCHIVE, '--out', runDir]);
  assert.equal(again.summary.episodes, 0);
  assert.equal(evidence(runDir).length, 3);
});

test('a missing archive exits 2', () => {
  const result = runScript('extract-openspec-archive.mjs', ['--path', '/no/such/archive', '--out', tmpDir()]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /archive not found/);
});

test('section helpers read varied proposal layouts', () => {
  const markdown = '# Title\n\n## Motivation\n\nFirst line\nsecond line.\n\nLater.\n\n### What Changes\n\n- **One** thing\n* Two\n- Three\n- Four\n\n## Impact\n';
  const why = firstParagraph(findSection(markdown, /^(why|motivation|problem)\b/i));
  assert.deepEqual(why, { text: 'First line second line.', line: 5 });
  const bullets = firstBullets(findSection(markdown, /^(what changes|changes|scope)\b/i), 3);
  assert.deepEqual(bullets.map((bullet) => bullet.text), ['One thing', 'Two', 'Three']);
  assert.equal(findSection(markdown, /^nothing$/i), null);
});

test('taskOutcome maps checkbox ratios', () => {
  assert.equal(taskOutcome('- [x] a\n- [X] b').outcome, 'completed');
  assert.equal(taskOutcome('- [x] a\n- [ ] b').outcome, 'partial');
  assert.equal(taskOutcome('- [ ] a').outcome, 'abandoned');
  assert.equal(taskOutcome('no boxes').outcome, 'unknown');
  assert.equal(taskOutcome(null).outcome, 'unknown');
});
