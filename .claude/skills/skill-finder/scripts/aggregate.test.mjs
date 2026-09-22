import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { catalogEntry, makeCatalog, makeEpisode, runScript, tmpDir, writeRun } from './lib/testing.mjs';
import { aggregate, clusterEpisodes, correctionsOf, median } from './aggregate.mjs';

const day = (d) => ({
  startedAt: `2026-09-${d}T10:00:00.000Z`,
  endedAt: `2026-09-${d}T11:00:00.000Z`,
  days: [`2026-09-${d}`]
});
const ep = (n, d, fields = {}) => makeEpisode({ n, ...day(d), ...fields });
const correction = (text) => ({ text, pointer: { file: '/s.jsonl', line: 5 } });
const byEpisodes = (result, id) => result.candidates.find((candidate) => candidate.episodeIds.includes(id));
const NOISE_TITLES = ['Rotate grafana token', 'Tune the herd import', 'Resize pasture tiles', 'Audit gateway logs', 'Rename the collar table', 'Draft the api changelog', 'Clean old fixtures'];
const noise = (fields = {}) => NOISE_TITLES.map((title, i) => ep(20 + i, String(10 + i), { title, ...fields }));

test('recurrence rule: 3 episodes on 2 days pass, fewer go below threshold', () => {
  const episodes = [
    ep(1, '02', { title: 'Deploy sim runner to staging' }),
    ep(2, '03', { title: 'Deploy sim runner to staging' }),
    ep(3, '03', { title: 'Deploy the sim runner to staging again' }),
    ep(4, '04', { title: 'Write HTTP request files for the devices API' }),
    ep(5, '04', { title: 'Write HTTP request files for the devices API' }),
    ep(6, '04', { title: 'Write HTTP request files for the devices API' }),
    ep(7, '05', { title: 'Rotate the grafana token' }),
    ep(8, '06', { title: 'Rotate the grafana token' })
  ];
  const result = aggregate({ episodes, catalog: makeCatalog([]), minEpisodes: 3, minDays: 2 });
  assert.equal(result.candidates.length, 1);
  const deploy = result.candidates[0];
  assert.equal(deploy.key, 'deploy sim runner to staging');
  assert.deepEqual(deploy.episodeIds, ['claude-sessions:ep-1', 'claude-sessions:ep-2', 'claude-sessions:ep-3']);
  assert.equal(deploy.distinctDays, 2);
  assert.deepEqual(deploy.keySources, ['title']);
  const below = Object.fromEntries(result.belowThreshold.map((entry) => [entry.key, entry.reason]));
  assert.match(below['write http request files for the devices api'], /1 distinct day/);
  assert.match(below['rotate the grafana token'], /2 episode/);
  assert.equal(result.totals.episodes, 8);
});

test('cost is the median episode cost and score is episodes times cost', () => {
  const episodes = [
    ep(1, '02', { title: 'Deploy sim runner to staging', size: { toolCalls: 10, assistantMessages: 5 } }),
    ep(2, '03', { title: 'Deploy sim runner to staging', size: { toolCalls: 20, assistantMessages: 5 }, userCorrections: [correction('no, use pnpm not npm')] }),
    ep(3, '04', {
      title: 'Deploy sim runner to staging',
      size: { toolCalls: 30, assistantMessages: 5 },
      userCorrections: [correction('no, use pnpm not npm'), correction('you forgot the lockfile')]
    })
  ];
  const result = aggregate({ episodes, catalog: makeCatalog([]) });
  assert.deepEqual(byEpisodes(result, 'claude-sessions:ep-1').cost, { median: 28, score: 84, corrections: 3 });
});

test('correctionsOf takes the larger count and median rounds', () => {
  const episode = makeEpisode({ userCorrections: [correction('no')], summary: { corrections: [{}, {}] } });
  assert.equal(correctionsOf(episode), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), 0);
});

test('pre-match gives silent-skill for a matching skill that never fired, new-skill otherwise', () => {
  const catalog = makeCatalog([
    catalogEntry({ name: 'http-writer', description: 'Write HTTP request files for an API. Use when the user wants request files.', triggers: ['wants request files'] })
  ]);
  const episodes = [
    ep(1, '02', { title: 'Deploy sim runner to staging' }),
    ep(2, '03', { title: 'Deploy sim runner to staging' }),
    ep(3, '04', { title: 'Deploy sim runner to staging' }),
    ep(4, '05', { title: 'Write HTTP request files for the devices API' }),
    ep(5, '06', { title: 'Write HTTP request files for the herds API' }),
    ep(6, '07', { title: 'Write HTTP request files for the plans API' })
  ];
  const result = aggregate({ episodes, catalog });
  const deploy = byEpisodes(result, 'claude-sessions:ep-1');
  assert.equal(deploy.kindHint, 'new-skill');
  assert.deepEqual(deploy.preMatch, []);
  const http = byEpisodes(result, 'claude-sessions:ep-4');
  assert.equal(http.episodes, 3);
  assert.equal(http.kindHint, 'silent-skill');
  assert.equal(http.kindTarget, 'http-writer');
  assert.equal(http.preMatch[0].qualifiedName, 'http-writer');
  assert.ok(http.preMatch[0].overlap >= 0.3);
  assert.equal(http.preMatch[0].invokedInEpisodes, 0);
  assert.equal(http.preMatch[0].named, false);
});

test('misfiring-skill when a skill fired in corrected episodes far above its run rate', () => {
  const catalog = makeCatalog([catalogEntry({ name: 'release-notes', description: 'Write release notes from merged pull requests.' })]);
  const fired = { skillsInvoked: [{ name: 'release-notes', count: 1, sidechain: false }] };
  const fix = [correction('no, use pnpm not npm for the release build')];
  const episodes = [
    ep(1, '02', { title: 'Release notes for v1.1', ...fired, userCorrections: fix }),
    ep(2, '05', { title: 'Release notes for v1.2', ...fired, userCorrections: fix }),
    ep(3, '08', { title: 'Release notes for v1.3', commandsUsed: [{ name: '/release-notes', count: 1 }], userCorrections: fix }),
    ...noise()
  ];
  const result = aggregate({ episodes, catalog });
  const byTitle = result.candidates.find((candidate) => candidate.keySources.includes('title'));
  assert.equal(byTitle.kindHint, 'misfiring-skill');
  assert.equal(byTitle.kindTarget, 'release-notes');
  assert.match(byTitle.kindReason, /fired in 3 of 3 corrected episodes/);
  assert.deepEqual(byTitle.invoked, [{ qualifiedName: 'release-notes', episodes: 3, correctedEpisodes: 3 }]);
  const byCorrection = result.candidates.find((candidate) => candidate.keySources.includes('correction'));
  assert.equal(byCorrection.kindHint, 'misfiring-skill');
  assert.deepEqual(byTitle.related, [byCorrection.key]);
});

test('a skill that fires in every episode is not flagged as misfiring', () => {
  const catalog = makeCatalog([catalogEntry({ name: 'managing-linear', description: 'Manage Linear issues and projects.' })]);
  const fired = { skillsInvoked: [{ name: 'managing-linear', count: 1, sidechain: false }] };
  const fix = [correction('no, use pnpm not npm for the release build')];
  const episodes = [
    ep(1, '02', { title: 'Release notes for v1.1', ...fired, userCorrections: fix }),
    ep(2, '05', { title: 'Release notes for v1.2', ...fired, userCorrections: fix }),
    ep(3, '08', { title: 'Release notes for v1.3', ...fired, userCorrections: fix }),
    ...noise(fired)
  ];
  const byTitle = aggregate({ episodes, catalog }).candidates.find((candidate) => candidate.keySources.includes('title'));
  assert.equal(byTitle.kindHint, 'new-skill');
  assert.deepEqual(byTitle.invoked, [{ qualifiedName: 'managing-linear', episodes: 3, correctedEpisodes: 3 }]);
});

test('a skill named by summaries joins pre-match and gives silent-skill', () => {
  const catalog = makeCatalog([catalogEntry({ name: 'diagnosing-bugs', description: 'Diagnosis loop for hard bugs.' })]);
  const summary = {
    goal: 'Fix the flaky herds migration test',
    outcome: 'completed',
    procedures: [],
    corrections: [],
    repeatedManualSteps: [],
    skillCandidates: [],
    skillsThatShouldHaveFired: [{ name: 'diagnosing-bugs', why: 'a flaky test was debugged by hand' }],
    confidence: 'high'
  };
  const episodes = ['02', '03', '04'].map((d, i) => ep(i + 1, d, { summary }));
  const candidate = aggregate({ episodes, catalog }).candidates[0];
  assert.equal(candidate.key, 'fix the flaky herds migration test');
  assert.deepEqual(candidate.preMatch, [
    { qualifiedName: 'diagnosing-bugs', origin: 'repo', overlap: 0, invokedInEpisodes: 0, correctedEpisodes: 0, named: true }
  ]);
  assert.equal(candidate.kindHint, 'silent-skill');
  assert.match(candidate.kindReason, /summary names diagnosing-bugs/);
});

test('catalog usage counts invocations and flags never-invoked skills', () => {
  const catalog = makeCatalog([
    catalogEntry({ name: 'plan' }),
    catalogEntry({ name: 'tdd' }),
    catalogEntry({ name: 'never-used' }),
    catalogEntry({ name: 'brainstorming', namespace: 'superpowers', qualifiedName: 'superpowers:brainstorming', origin: 'plugin' })
  ]);
  const episodes = [
    ep(1, '02', { commandsUsed: [{ name: '/plan', count: 2 }], skillsInvoked: [{ name: 'superpowers:brainstorming', count: 1, sidechain: false }] }),
    ep(2, '05', {
      skillsInvoked: [
        { name: 'brainstorming', count: 1, sidechain: false },
        { name: 'tdd', count: 1, sidechain: true }
      ]
    })
  ];
  const usage = Object.fromEntries(aggregate({ episodes, catalog }).catalogUsage.map((entry) => [entry.qualifiedName, entry]));
  assert.deepEqual(
    { invocations: usage.plan.invocations, episodes: usage.plan.episodes, lastUsed: usage.plan.lastUsed },
    { invocations: 2, episodes: 1, lastUsed: '2026-09-02' }
  );
  assert.equal(usage['superpowers:brainstorming'].invocations, 2);
  assert.equal(usage['superpowers:brainstorming'].lastUsed, '2026-09-05');
  assert.equal(usage.tdd.episodes, 1);
  assert.equal(usage['never-used'].neverInvoked, true);
  assert.equal(usage['never-used'].lastUsed, null);
});

test('command-only clusters never become candidates and mixed clusters count task episodes only', () => {
  const episodes = [];
  for (let n = 1; n <= 12; n += 1) {
    episodes.push(ep(n, String(n).padStart(2, '0'), {
      title: 'Unknown',
      commandPatterns: [{ pattern: 'git status', count: 1 }, { pattern: 'pnpm lint', count: 1 }]
    }));
  }
  episodes.push(ep(13, '13', { title: 'Git status check', commandPatterns: [{ pattern: 'git status', count: 1 }] }));
  const result = aggregate({ episodes, catalog: makeCatalog([]) });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.commandClusters, [{ key: 'pnpm lint', episodes: 12, distinctDays: 12 }]);
  const mixed = result.belowThreshold.find((entry) => entry.key === 'git status check');
  assert.equal(mixed.episodes, 1);
  assert.match(mixed.reason, /1 episode/);
});

test('a candidate lists its top commands', () => {
  const commands = [{ pattern: './scripts/deploy-sim.sh staging', count: 2 }, { pattern: 'pnpm test', count: 1 }];
  const episodes = [
    ep(1, '02', { title: 'Deploy sim runner to staging', commandPatterns: [...commands, { pattern: 'pnpm lint', count: 1 }] }),
    ep(2, '03', { title: 'Deploy sim runner to staging', commandPatterns: commands }),
    ep(3, '04', { title: 'Deploy sim runner to staging', commandPatterns: commands })
  ];
  const deploy = byEpisodes(aggregate({ episodes, catalog: makeCatalog([]) }), 'claude-sessions:ep-1');
  assert.deepEqual(deploy.topCommands, [
    { pattern: './scripts/deploy-sim.sh staging', episodes: 3 },
    { pattern: 'pnpm test', episodes: 3 },
    { pattern: 'pnpm lint', episodes: 1 }
  ]);
  assert.equal(deploy.commandEpisodes, 0);
});

test('--max-candidates keeps the top candidates by score', () => {
  const titles = ['Deploy sim runner to staging', 'Write HTTP request files for devices', 'Rotate grafana admin token'];
  const episodes = [];
  let n = 0;
  titles.forEach((title, t) => {
    for (const d of ['02', '03', '04']) {
      n += 1;
      episodes.push(ep(n, d, { title, size: { toolCalls: 10 * (t + 1), assistantMessages: 0 } }));
    }
  });
  const result = aggregate({ episodes, catalog: makeCatalog([]), maxCandidates: 2 });
  assert.deepEqual(result.candidates.map((candidate) => candidate.key), ['rotate grafana admin token', 'write http request files for devices']);
  assert.match(result.belowThreshold.find((entry) => entry.key === 'deploy sim runner to staging').reason, /outside the top 2/);
});

test('clusterEpisodes merges keys at Jaccard 0.6 and keeps distinct work apart', () => {
  const clusters = clusterEpisodes([
    ep(1, '02', { title: 'Deploy sim runner staging' }),
    ep(2, '03', { title: 'Deploy sim runner staging again' }),
    ep(3, '04', { title: 'Write http file' })
  ]);
  assert.equal(clusters.length, 2);
  const deploy = clusters.find((cluster) => cluster.key === 'deploy sim runner staging');
  assert.deepEqual(deploy.episodeIds, ['claude-sessions:ep-1', 'claude-sessions:ep-2']);
  assert.deepEqual(deploy.taskEpisodeIds, deploy.episodeIds);
});

test('previous run statuses through the CLI: resolved, still-open, stale', () => {
  const root = tmpDir();
  const prevDir = path.join(root, 'runs', '20260901-000000-prev');
  const runDir = path.join(root, 'runs', '20260922-000000-cur');
  mkdirSync(prevDir, { recursive: true });
  const proposal = (name, description, triggerPhrases = []) => ({ name, description, triggerPhrases, outline: [], change: null });
  writeFileSync(path.join(prevDir, 'suggestions.json'), JSON.stringify({
    runId: '20260901-000000-prev',
    generatedAt: '2026-09-01T00:00:00.000Z',
    suggestions: [
      { id: 'sf-a', kind: 'new-skill', title: 'Write release notes', candidateKeys: ['release notes'], catalogChecked: [], proposal: proposal('release-notes', 'Write release notes.') },
      { id: 'sf-b', kind: 'new-skill', title: 'Deploy the sim runner to staging', candidateKeys: ['deploy sim runner to staging'], catalogChecked: [], proposal: proposal('deploy-sim-runner', 'Deploy the sim runner to staging and check dashboards.', ['deploy the sim runner']) },
      { id: 'sf-c', kind: 'new-skill', title: 'Rotate the grafana token', candidateKeys: ['rotate the grafana token'], catalogChecked: [], proposal: proposal('rotate-grafana-token', 'Rotate the grafana admin token.') },
      {
        id: 'sf-d',
        kind: 'silent-skill',
        title: 'The HTTP files skill never fires',
        candidateKeys: [],
        catalogChecked: [],
        proposal: { name: null, description: null, triggerPhrases: [], outline: [], change: { skill: 'write-http-files', path: '/x/SKILL.md', origin: 'repo', descriptionBefore: 'Old.', descriptionAfter: 'Author HTTP request files.' } }
      }
    ]
  }));
  writeRun(runDir, {
    episodes: [
      ep(1, '05', { title: 'Deploy sim runner to staging' }),
      ep(2, '06', { title: 'Deploy sim runner to staging' }),
      ep(3, '07', { title: 'Deploy sim runner to staging' }),
      makeEpisode({ n: 4, title: 'Rotate the grafana token', startedAt: '2026-08-20T10:00:00.000Z', endedAt: '2026-08-20T11:00:00.000Z', days: ['2026-08-20'] })
    ],
    catalog: makeCatalog([
      catalogEntry({ name: 'release-notes', description: 'Write release notes from merged pull requests.' }),
      catalogEntry({ name: 'write-http-files', description: 'Author HTTP request files.' })
    ])
  });
  const result = runScript('aggregate.mjs', ['--run', runDir, '--previous', 'auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.summary, { candidates: 1, belowThreshold: 1, commandClusters: 0, previous: 4 });
  const written = JSON.parse(readFileSync(path.join(runDir, 'aggregate.json'), 'utf8'));
  assert.equal(written.previous.runId, '20260901-000000-prev');
  const status = Object.fromEntries(written.previous.statuses.map((entry) => [entry.id, entry.status]));
  assert.deepEqual(status, { 'sf-a': 'resolved', 'sf-b': 'still-open', 'sf-c': 'stale', 'sf-d': 'resolved' });
  assert.equal(written.previous.statuses.find((entry) => entry.id === 'sf-b').newEpisodes.length, 3);
});

test('no previous run gives previous: null', () => {
  const runDir = path.join(tmpDir(), 'runs', '20260922-000000-cur');
  writeRun(runDir, { episodes: [ep(1, '02', { title: 'Deploy sim runner to staging' })], catalog: makeCatalog([]) });
  const result = runScript('aggregate.mjs', ['--run', runDir, '--previous', 'auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(runDir, 'aggregate.json'), 'utf8')).previous, null);
});

test('missing evidence exits 2', () => {
  assert.equal(runScript('aggregate.mjs', ['--run', tmpDir()]).status, 2);
});

test('a user-invoked skill never gives silent-skill', () => {
  const catalog = makeCatalog([
    catalogEntry({
      name: 'http-writer',
      invocation: 'user',
      description: 'Write HTTP request files for an API. Use when the user wants request files.',
      triggers: ['wants request files']
    })
  ]);
  const episodes = [
    ep(4, '05', { title: 'Write HTTP request files for the devices API' }),
    ep(5, '06', { title: 'Write HTTP request files for the herds API' }),
    ep(6, '07', { title: 'Write HTTP request files for the plans API' })
  ];
  const http = byEpisodes(aggregate({ episodes, catalog }), 'claude-sessions:ep-4');
  assert.equal(http.preMatch[0].qualifiedName, 'http-writer');
  assert.ok(http.preMatch[0].overlap >= 0.3);
  assert.equal(http.preMatch[0].invokedInEpisodes, 0);
  assert.equal(http.kindHint, 'new-skill');
  assert.equal(http.kindTarget, null);
});
