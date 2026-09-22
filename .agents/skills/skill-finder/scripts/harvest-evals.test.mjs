import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeEpisode, runScript, tmpDir, writeRun } from './lib/testing.mjs';
import { overlap, tokenize } from './lib/tokens.mjs';
import { acceptPrompt, quotas } from './harvest-evals.mjs';

const ENVS = ['staging', 'preview', 'canary', 'sandbox', 'demo', 'qa', 'perf', 'edge', 'blue', 'green', 'nightly', 'pilot'];
const FEATURES = ['heartbeat batching', 'herd rotation', 'fence alerts', 'tag pairing', 'gps smoothing', 'battery reports', 'pasture maps', 'firmware rollout', 'geofence sync', 'collar reboot', 'water points', 'weather feed'];
const CHECKS = ['grafana panels', 'error budget', 'queue depth', 'latency graph', 'crash reports', 'log volume', 'pod restarts', 'memory curve', 'alert noise', 'cpu headroom', 'trace sampling', 'uptime probe'];
const A_WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
const B_WORDS = ['herds', 'pastures', 'collars', 'tags', 'gateways', 'farms', 'plans', 'zones', 'devices', 'fences'];
const C_WORDS = ['export', 'import', 'backfill', 'rollup', 'cleanup', 'audit', 'sync', 'merge', 'replay', 'archive'];

const intent = (text, id, line) => ({ text, pointer: { file: `/sessions/${id}.jsonl`, line } });
const read = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

function ownEpisode(i) {
  const id = `own-${String(i).padStart(2, '0')}`;
  const intents = [
    intent(`Deploy the sim runner to ${ENVS[i]} with ${FEATURES[i]} enabled and verify the ${CHECKS[i]} afterwards.`, id, 2),
    intent(`Push the simulator build to ${ENVS[i]} again, then watch the ${CHECKS[(i + 7) % 12]} for ${FEATURES[(i + 5) % 12]} regressions.`, id, 9),
    intent(`Please roll the sim runner forward on ${ENVS[i]} and post links to the ${CHECKS[i]} for ${FEATURES[i]}.`, id, 15),
    intent('yes do it', id, 20)
  ];
  if (i === 0) intents.push(intent('Send the deploy summary for the sim runner to ops@example.com when you finish.', id, 25));
  return makeEpisode({
    id: `claude-sessions:${id}`,
    startedAt: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
    title: 'Deploy sim runner to staging',
    intents
  });
}

const TEMPLATES = [
  (j) => `Why does the CI runner on ${A_WORDS[j]} time out during ${B_WORDS[j]} ${C_WORDS[j]} checks?`,
  (j) => `Draft a staging runbook covering ${A_WORDS[j]} alerts and ${B_WORDS[j]} ${C_WORDS[j]} failures.`,
  (j) => `How does the ${A_WORDS[j]} simulator seed ${B_WORDS[j]} ${C_WORDS[j]} fixtures for tests?`
];

function otherEpisodes() {
  const episodes = [];
  TEMPLATES.forEach((template, t) => {
    for (let j = 0; j < 10; j += 1) {
      const id = `t${t + 1}-${j}`;
      episodes.push(makeEpisode({ id: `claude-sessions:${id}`, startedAt: `2026-08-${10 + j}T10:00:00.000Z`, intents: [intent(template(j), id, 3)] }));
    }
  });
  episodes.push(makeEpisode({ id: 'claude-sessions:high', intents: [intent('Deploy the sim runner to staging for the demo farm tonight, please.', 'high', 2)] }));
  episodes.push(makeEpisode({ id: 'claude-sessions:unrelated', intents: [intent('Summarize the quarterly budget spreadsheet for the finance team please.', 'unrelated', 2)] }));
  return episodes;
}

function world({ own = 12 } = {}) {
  const runDir = tmpDir();
  const owns = Array.from({ length: own }, (_, i) => ownEpisode(i));
  const others = otherEpisodes();
  writeRun(runDir, {
    episodes: [...owns, ...others],
    suggestions: {
      runId: 'r1',
      generatedAt: '2026-09-22T00:00:00.000Z',
      suggestions: [{
        id: 'sf-1',
        kind: 'new-skill',
        title: 'Deploy the sim runner to staging',
        candidateKeys: ['deploy sim runner to staging'],
        proposal: {
          name: 'deploy-sim-runner',
          description: 'Deploy the sim runner and verify it.',
          triggerPhrases: ['deploy the sim runner', 'push the simulator to staging'],
          outline: [],
          change: null
        },
        provenance: { episodeIds: owns.map((episode) => episode.id) }
      }]
    },
    files: {
      'aggregate.json': JSON.stringify({
        candidates: [
          { key: 'deploy sim runner to staging', episodeIds: owns.map((episode) => episode.id) },
          { key: 'ci runner timeout', episodeIds: others.filter((episode) => episode.id.includes(':t1-')).map((episode) => episode.id) }
        ]
      })
    }
  });
  return runDir;
}

test('reaches the 50-case target from real data with the right ratios', () => {
  const runDir = world();
  const result = runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.summary.counts, { positives: 20, negatives: 20, behavior: 10, total: 50 });
  assert.equal(result.summary.real.total, 50);
  assert.equal(result.summary.synthetic.total, 0);
  assert.equal(result.summary.shortfall.total, 0);
  const out = path.join(runDir, 'evals-sf-1');
  const triggers = read(out, 'trigger-eval.json');
  assert.equal(triggers.length, 40);
  assert.ok(triggers.every((entry) => Object.keys(entry).join(',') === 'query,should_trigger'));
  assert.ok(triggers.slice(0, 20).every((entry) => entry.should_trigger === true));
  const provenance = read(out, 'trigger-eval.provenance.json');
  assert.equal(provenance.length, 40);
  assert.ok(provenance.every((entry) => entry.origin === 'real' && entry.episodeId && entry.pointer));
  const evals = read(out, 'evals.json');
  assert.equal(evals.skill_name, 'deploy-sim-runner');
  assert.deepEqual(evals.evals.map((entry) => entry.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(evals.evals.every((entry) => entry.expected_output === '' && entry.expectations.length === 0 && entry.files.length === 0));
  assert.ok(evals.evals.every((entry) => entry.provenance.origin === 'real'));
  assert.ok(existsSync(path.join(out, 'harvest.json')));
});

test('filters short text, emails, and prompts outside the near-miss band', () => {
  const runDir = world();
  runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-1']);
  const out = path.join(runDir, 'evals-sf-1');
  const queries = read(out, 'trigger-eval.json').map((entry) => entry.query);
  for (const excluded of [
    'yes do it',
    'Deploy the sim runner to staging for the demo farm tonight, please.',
    'Summarize the quarterly budget spreadsheet for the finance team please.'
  ]) {
    assert.equal(queries.includes(excluded), false, excluded);
  }
  assert.equal(queries.some((query) => query.includes('@')), false);
  const keywords = read(out, 'harvest.json').keywords;
  for (const entry of read(out, 'trigger-eval.json').filter((item) => !item.should_trigger)) {
    const score = overlap(tokenize(entry.query), keywords);
    assert.ok(score >= 0.15 && score < 0.5, `${entry.query}: ${score}`);
  }
});

test('near-misses prefer episodes from another cluster', () => {
  const runDir = world();
  runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-1']);
  const negatives = read(path.join(runDir, 'evals-sf-1'), 'trigger-eval.provenance.json').filter((entry) => !entry.should_trigger);
  assert.ok(negatives.slice(0, 10).every((entry) => entry.episodeId.startsWith('claude-sessions:t1-')));
});

test('thin data reports a shortfall and synthetic cases are marked', () => {
  const runDir = world({ own: 3 });
  const first = runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-1']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.summary.real.positives, 9);
  assert.deepEqual(first.summary.shortfall, { positives: 11, negatives: 0, behavior: 7, total: 18 });

  const synthetic = {
    triggers: [
      ...ENVS.map((env, k) => ({
        query: `Could you ship the sim runner to ${env} with ${FEATURES[(k + 3) % 12]} and confirm the ${CHECKS[(k + 8) % 12]}?`,
        should_trigger: true
      })),
      { query: 'too short', should_trigger: true }
    ],
    behavior: [5, 6].map((k) => ({
      prompt: `Roll out the sim runner build ${k} to the ${ENVS[k]} cluster and report the ${CHECKS[k]} to the team.`,
      expected_output: 'The sim runner is deployed and the check is reported.',
      expectations: ['The answer names the environment.']
    }))
  };
  const file = path.join(runDir, 'synthetic.json');
  writeFileSync(file, JSON.stringify(synthetic));
  const second = runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-1', '--add-synthetic', file]);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(second.summary.synthetic, { positives: 12, negatives: 0, behavior: 2, total: 14 });
  assert.equal(second.summary.shortfall.total, 18);
  assert.equal(second.summary.counts.positives, 21);
  const out = path.join(runDir, 'evals-sf-1');
  const syntheticTriggers = read(out, 'trigger-eval.provenance.json').filter((entry) => entry.origin === 'synthetic');
  assert.equal(syntheticTriggers.length, 12);
  assert.ok(syntheticTriggers.every((entry) => entry.episodeId === null && entry.pointer === null));
  assert.equal(read(out, 'evals.json').evals.filter((entry) => entry.provenance.origin === 'synthetic').length, 2);
});

test('--merge-into dedups, keeps provenance aligned, and continues ids', () => {
  const runDir = world();
  runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-1']);
  const harvested = read(path.join(runDir, 'evals-sf-1'), 'trigger-eval.json');
  const target = path.join(tmpDir(), 'evals');
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'trigger-eval.json'), JSON.stringify([{ query: harvested[0].query.toUpperCase(), should_trigger: true }]));
  writeFileSync(path.join(target, 'evals.json'), JSON.stringify({
    skill_name: 'deploy-sim-runner',
    evals: [1, 2, 7].map((id) => ({ id, name: `old-${id}`, prompt: `Old prompt number ${id} about something else entirely.`, expected_output: 'x', files: [], expectations: ['y'] }))
  }));
  const result = runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-1', '--merge-into', target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.addedTriggers, 39);
  assert.equal(result.summary.addedEvals, 10);
  const merged = read(target, 'evals.json');
  assert.deepEqual(merged.evals.map((entry) => entry.id), [1, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.equal(merged.evals[3].name, 'deploy-sim-runner-case-8');
  assert.equal(read(target, 'trigger-eval.json').length, 40);
  const provenance = read(target, 'trigger-eval.provenance.json');
  assert.equal(provenance.length, 40);
  assert.equal(provenance[0].origin, 'existing');
});

test('--merge-into refuses a plugin cache folder', () => {
  const result = runScript('harvest-evals.mjs', ['--run', tmpDir(), '--id', 'sf-1', '--merge-into', '/tmp/x/.claude/plugins/cache/acme/skills/foo/evals']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plugin cache/);
});

test('quotas keep 20/20/10 at the default target and scale above it', () => {
  assert.deepEqual(quotas(50), { positives: 20, negatives: 20, behavior: 10 });
  assert.deepEqual(quotas(100), { positives: 40, negatives: 40, behavior: 20 });
  assert.deepEqual(quotas(30), { positives: 20, negatives: 20, behavior: 10 });
});

test('acceptPrompt applies the filters', () => {
  assert.equal(acceptPrompt('short'), false);
  assert.equal(acceptPrompt('x'.repeat(601)), false);
  assert.equal(acceptPrompt('<command-name>/plan</command-name> make a plan for the release please'), false);
  assert.equal(acceptPrompt('Please mail the deploy report to ops@example.com tomorrow morning.'), false);
  assert.equal(acceptPrompt('Deploy the sim runner to staging and verify the dashboards.'), true);
});

test('an unknown suggestion id exits 1', () => {
  const runDir = world({ own: 3 });
  assert.equal(runScript('harvest-evals.mjs', ['--run', runDir, '--id', 'sf-404']).status, 1);
});
