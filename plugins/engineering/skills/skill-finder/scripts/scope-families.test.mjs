import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeEpisode, runScript, tmpDir, writeRun } from './lib/testing.mjs';
import { familyProblems } from './scope-families.mjs';

const summary = (goal, procedures = [], candidates = []) => ({
  goal,
  outcome: 'completed',
  procedures: procedures.map((name) => ({ name, steps: ['one', 'two'], taughtByUser: false })),
  corrections: [],
  repeatedManualSteps: [],
  skillCandidates: candidates.map((name) => ({ name, why: 'repeats' })),
  skillsThatShouldHaveFired: [],
  confidence: 'high'
});

function fiveEpisodeRun() {
  const dir = tmpDir();
  writeRun(dir, {
    episodes: [
      makeEpisode({ n: 1, summary: summary('Add the fport 6 power decoder', ['add fport decoder', 'open decoder pr'], ['fport-decoder-parity']) }),
      makeEpisode({ n: 2, summary: summary('Add the fport 29 mode set decoder', ['add fport decoder']) }),
      makeEpisode({ n: 3, summary: summary('Verify the stall alert on staging', ['verify staging alert']) }),
      makeEpisode({ n: 4, title: 'Promote the heartbeat fix to staging' }),
      makeEpisode({ n: 5, title: 'Unknown' })
    ],
    runJson: { runId: 'test' }
  });
  mkdirSync(path.join(dir, 'families'), { recursive: true });
  return dir;
}

const family = (name, ids, description = 'Add a LoRaWAN fport decoder and its parity coverage.') => ({ name, description, episodeIds: ids });

test('--plan writes one line per episode with a goal, in batches, plus the question', () => {
  const dir = fiveEpisodeRun();
  const result = runScript('scope-families.mjs', ['--run', dir, '--plan', '--size', '3']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.episodes, 5);
  assert.equal(result.summary.lines, 4);
  assert.equal(result.summary.calls, 2);
  const plan = JSON.parse(readFileSync(path.join(dir, 'families', 'plan.json'), 'utf8'));
  assert.deepEqual(plan.batches.map((batch) => batch.episodeIds.length), [3, 1]);
  assert.equal(plan.batches[0].input, path.join(dir, 'families', 'episodes-01.md'));
  assert.equal(plan.batches[0].file, path.join(dir, 'families', 'answer-01.json'));
  const lines = readFileSync(plan.batches[0].input, 'utf8');
  assert.match(lines, /^- claude-sessions:ep-1 \| goal: Add the fport 6 power decoder \| procedures: add fport decoder; open decoder pr \| candidates: fport decoder parity$/m);
  assert.match(lines, /^- claude-sessions:ep-2 \| goal: Add the fport 29 mode set decoder \| procedures: add fport decoder$/m);
  const second = readFileSync(plan.batches[1].input, 'utf8');
  assert.match(second, /^- claude-sessions:ep-4 \| goal: Promote the heartbeat fix to staging$/m);
  assert.equal(second.includes('ep-5'), false);
  const question = readFileSync(path.join(dir, 'families', 'question.txt'), 'utf8');
  assert.match(question, /^You read one line for each episode of coding-agent work\./);
});

test('valid answers merge by name into families.json and run.json records the backend', () => {
  const dir = fiveEpisodeRun();
  const first = path.join(dir, 'families', 'answer-01.json');
  const second = path.join(dir, 'families', 'answer-02.json');
  writeFileSync(first, `Here are the families:\n${JSON.stringify([
    family('add-fport-decoder', ['claude-sessions:ep-1', 'claude-sessions:ep-2']),
    family('verify-staging-alert', ['claude-sessions:ep-3'], 'Verify an alert on staging after a deploy.')
  ])}\n`);
  writeFileSync(second, JSON.stringify({ families: [family('add-fport-decoder', ['claude-sessions:ep-4', 'claude-sessions:ep-2', 'claude-sessions:ep-4x'], 'Other words.')] }));
  const result = runScript('scope-families.mjs', ['--run', dir, '--backend', 'pi', '--answer', first, '--answer', second]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    { valid: result.summary.valid, families: result.summary.families, assigned: result.summary.assigned, droppedIds: result.summary.droppedIds },
    { valid: true, families: 2, assigned: 4, droppedIds: 1 }
  );
  const written = JSON.parse(readFileSync(path.join(dir, 'families.json'), 'utf8'));
  assert.equal(written.backend, 'pi');
  assert.deepEqual(written.droppedIds, ['claude-sessions:ep-4x']);
  assert.deepEqual(written.families, [
    { name: 'add-fport-decoder', description: 'Add a LoRaWAN fport decoder and its parity coverage.', episodeIds: ['claude-sessions:ep-1', 'claude-sessions:ep-2', 'claude-sessions:ep-4'] },
    { name: 'verify-staging-alert', description: 'Verify an alert on staging after a deploy.', episodeIds: ['claude-sessions:ep-3'] }
  ]);
  assert.equal(written.episodes, 5);
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
  assert.deepEqual(run.families, { backend: 'pi', families: 2, assigned: 4, droppedIds: 1 });
});

test('an invalid answer exits 1 with each problem and writes no families.json', () => {
  const dir = fiveEpisodeRun();
  const file = path.join(dir, 'families', 'answer-01.json');
  writeFileSync(file, JSON.stringify([
    family('Add Decoders', ['claude-sessions:ep-1', 'claude-sessions:ep-1', 'claude-sessions:ep-99']),
    family('verify-staging-alert', [], ''),
    family('verify-staging-alert', ['claude-sessions:ep-3']),
    family('only-unknown-ids', ['claude-sessions:ep-98'])
  ]));
  const result = runScript('scope-families.mjs', ['--run', dir, '--answer', file]);
  assert.equal(result.status, 1);
  assert.equal(result.summary.valid, false);
  const problems = result.summary.errors.flatMap((error) => error.problems).join('\n');
  assert.match(problems, /name must be kebab-case/);
  assert.equal(problems.includes('ep-99'), false);
  assert.equal(result.summary.warnings, 2);
  assert.match(problems, /no known episodeId/);
  assert.match(problems, /duplicate episodeId claude-sessions:ep-1/);
  assert.match(problems, /episodeIds must be a non-empty string array/);
  assert.match(problems, /description must be a non-empty string/);
  assert.match(problems, /duplicate family verify-staging-alert/);
  assert.equal(existsSync(path.join(dir, 'families.json')), false);
});

test('text without a JSON array fails, and a missing answer file exits 2', () => {
  const dir = fiveEpisodeRun();
  const file = path.join(dir, 'families', 'answer-01.json');
  writeFileSync(file, 'I could not group the lines.');
  const prose = runScript('scope-families.mjs', ['--run', dir, '--answer', file]);
  assert.equal(prose.status, 1);
  assert.match(JSON.stringify(prose.summary.errors), /no JSON array found/);
  assert.equal(runScript('scope-families.mjs', ['--run', dir, '--answer', path.join(dir, 'nope.json')]).status, 2);
});

test('--backend none records the skip and writes no families.json', () => {
  const dir = fiveEpisodeRun();
  const result = runScript('scope-families.mjs', ['--run', dir, '--backend', 'none']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(dir, 'families.json')), false);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')).families, { backend: 'none', families: 0, assigned: 0 });
});

test('usage errors exit 1', () => {
  const dir = fiveEpisodeRun();
  assert.equal(runScript('scope-families.mjs', ['--plan']).status, 1);
  assert.equal(runScript('scope-families.mjs', ['--run', dir]).status, 1);
  assert.equal(runScript('scope-families.mjs', ['--run', dir, '--plan', '--size', '0']).status, 1);
  assert.equal(runScript('scope-families.mjs', ['--run', dir, '--backend', 'other']).status, 1);
});

test('familyProblems checks the description length', () => {
  const ids = new Set(['a']);
  assert.deepEqual(familyProblems({ name: 'do-work', description: 'Short.', episodeIds: ['a'] }, ids), []);
  const long = { name: 'do-work', description: Array(41).fill('word').join(' '), episodeIds: ['a'] };
  assert.deepEqual(familyProblems(long, ids), ['description must be 40 words or less']);
  assert.deepEqual(familyProblems('nope', ids), ['family is not an object']);
});
