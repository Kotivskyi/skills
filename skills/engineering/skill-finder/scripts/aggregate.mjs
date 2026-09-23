#!/usr/bin/env node
// Clusters episodes into candidates, applies the recurrence rule, ranks by cost,
// pre-matches the catalog, hints a kind, and reports catalog usage and previous-run statuses.
// Candidates come from three signals: lexical clusters, skills that summaries name, and families.
// Rules and constants: references/ranking.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { readJson, readJsonl, readOptionalJson, writeJson } from './lib/jsonl.mjs';
import { isLowInformationTitle, jaccard, normalizeText, overlap, round2, skillTokens, tokenize } from './lib/tokens.mjs';

export const MERGE_JACCARD = 0.6;
export const RELATED_JACCARD = 0.5;
export const SILENT_OVERLAP = 0.3;
export const RESOLVED_OVERLAP = 0.5;
export const NEW_EPISODE_OVERLAP = 0.6;
export const CORRECTION_WEIGHT = 3;
export const PRE_MATCH_TOP = 3;
export const MISFIRE_LIFT = 2;
export const MAX_FAMILY_SHARE = 0.5;
export const NAMED_MIN_EPISODES = 2;
export const MAX_CANDIDATES = 60;
const COMMAND_SOURCE = 'commandPattern';
const NAMED_SOURCE = 'skillsThatShouldHaveFired';
const FAMILY_SOURCE = 'family';
const LABEL_LIMIT = 8;
const TOP_COMMANDS = 5;
const COMMAND_CLUSTER_LIMIT = 20;
const BELOW_THRESHOLD_LIMIT = 100;

export function correctionsOf(episode) {
  return Math.max(episode.userCorrections?.length ?? 0, episode.summary?.corrections?.length ?? 0);
}

export function episodeCost(episode) {
  return (episode.size?.toolCalls ?? 0) + (episode.size?.assistantMessages ?? 0) + CORRECTION_WEIGHT * correctionsOf(episode);
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function episodeKeys(episode) {
  const keys = [];
  const add = (label, from) => {
    const tokens = [...new Set(tokenize(label))];
    if (tokens.length >= 2) keys.push({ label: normalizeText(label), tokens, from });
  };
  const summary = episode.summary;
  if (summary) {
    for (const candidate of summary.skillCandidates ?? []) add(String(candidate.name).replace(/[-_]/g, ' '), 'skillCandidate');
    for (const procedure of summary.procedures ?? []) add(procedure.name, 'procedure');
    for (const item of summary.corrections ?? []) add(item.what, 'correction');
    if (summary.goal) add(summary.goal, 'goal');
  } else if (!isLowInformationTitle(episode.title)) {
    add(episode.title, 'title');
  }
  for (const entry of episode.commandPatterns ?? []) add(entry.pattern, COMMAND_SOURCE);
  for (const entry of episode.userCorrections ?? []) add(entry.text, 'correction');
  return keys;
}

// Task labels win over command labels, then the most frequent, then the shortest.
function pickKey(labels) {
  return [...labels].sort((a, b) =>
    Number(b[1].task) - Number(a[1].task) || b[1].count - a[1].count || a[0].length - b[0].length || a[0].localeCompare(b[0])
  )[0][0];
}

// Greedy and deterministic: a key joins the first cluster whose representative
// tokens have Jaccard >= 0.6 with it. An inverted index keeps it fast.
export function clusterEpisodes(episodes) {
  const occurrences = [];
  for (const episode of episodes) {
    for (const key of episodeKeys(episode)) occurrences.push({ ...key, episodeId: episode.id });
  }
  occurrences.sort((a, b) => a.tokens.length - b.tokens.length || a.label.localeCompare(b.label) || a.episodeId.localeCompare(b.episodeId));
  const clusters = [];
  const index = new Map();
  for (const occurrence of occurrences) {
    const candidates = [...new Set(occurrence.tokens.flatMap((token) => index.get(token) ?? []))].sort((a, b) => a - b);
    let at = candidates.find((i) => jaccard(clusters[i].tokens, occurrence.tokens) >= MERGE_JACCARD);
    if (at === undefined) {
      at = clusters.length;
      clusters.push({ tokens: occurrence.tokens, labels: new Map(), from: new Set(), members: new Map(), allTokens: new Set() });
      for (const token of occurrence.tokens) {
        if (!index.has(token)) index.set(token, []);
        index.get(token).push(at);
      }
    }
    const cluster = clusters[at];
    const label = cluster.labels.get(occurrence.label) ?? { count: 0, task: false };
    label.count += 1;
    label.task = label.task || occurrence.from !== COMMAND_SOURCE;
    cluster.labels.set(occurrence.label, label);
    cluster.from.add(occurrence.from);
    if (!cluster.members.has(occurrence.episodeId)) cluster.members.set(occurrence.episodeId, new Set());
    cluster.members.get(occurrence.episodeId).add(occurrence.from);
    for (const token of occurrence.tokens) cluster.allTokens.add(token);
  }
  return clusters.map((cluster) => ({
    signal: 'cluster',
    key: pickKey(cluster.labels),
    labels: [...cluster.labels.keys()].sort(),
    keySources: [...cluster.from].sort(),
    episodeIds: [...cluster.members.keys()].sort(),
    taskEpisodeIds: [...cluster.members]
      .filter(([, from]) => [...from].some((source) => source !== COMMAND_SOURCE))
      .map(([id]) => id)
      .sort(),
    tokens: [...cluster.allTokens].sort()
  }));
}

// Exact qualified name first, then the bare name after any namespace.
export function makeResolver(skills) {
  const byQualified = new Map(skills.map((skill) => [skill.qualifiedName, skill]));
  const byName = new Map();
  for (const skill of skills) {
    if (!byName.has(skill.name)) byName.set(skill.name, []);
    byName.get(skill.name).push(skill);
  }
  return (rawName) => {
    const name = String(rawName ?? '').trim().replace(/^\//, '');
    if (!name) return [];
    if (byQualified.has(name)) return [byQualified.get(name)];
    return byName.get(name.includes(':') ? name.split(':').pop() : name) ?? [];
  };
}

export function invocationsOf(episode) {
  return [
    ...(episode.skillsInvoked ?? []).map((entry) => ({ name: entry.name, count: entry.count })),
    ...(episode.commandsUsed ?? []).map((entry) => ({ name: entry.name, count: entry.count }))
  ];
}

function firedSkills(episode, resolve) {
  return new Set(invocationsOf(episode).flatMap((entry) => resolve(entry.name).map((skill) => skill.qualifiedName)));
}

// Share of episodes in which each skill fired. Only sources that record invocations count.
export function firingRates(episodes, resolve) {
  const sources = new Set(episodes.filter((episode) => invocationsOf(episode).length).map((episode) => episode.source));
  const pool = episodes.filter((episode) => sources.has(episode.source));
  const fired = new Map();
  for (const episode of pool) {
    for (const name of firedSkills(episode, resolve)) fired.set(name, (fired.get(name) ?? 0) + 1);
  }
  return new Map([...fired].map(([name, count]) => [name, count / pool.length]));
}

function invokedSkills(episodes, resolve) {
  const invoked = new Map();
  for (const episode of episodes) {
    const corrected = correctionsOf(episode) > 0;
    for (const name of firedSkills(episode, resolve)) {
      const stats = invoked.get(name) ?? { episodes: 0, correctedEpisodes: 0 };
      stats.episodes += 1;
      if (corrected) stats.correctedEpisodes += 1;
      invoked.set(name, stats);
    }
  }
  return invoked;
}

// One cluster per model-invoked catalog skill that summaries name in skillsThatShouldHaveFired.
// Only the episodes where the skill did not fire count. Labels are the distinct `why` lines.
export function namedSkillClusters(episodes, catalog, resolve) {
  const byQualified = new Map(catalog.skills.map((skill) => [skill.qualifiedName, skill]));
  const groups = new Map();
  for (const episode of episodes) {
    const fired = firedSkills(episode, resolve);
    for (const entry of episode.summary?.skillsThatShouldHaveFired ?? []) {
      for (const skill of resolve(entry.name)) {
        if (skill.invocation === 'user' || fired.has(skill.qualifiedName)) continue;
        const group = groups.get(skill.qualifiedName) ?? { members: new Set(), whys: new Set() };
        group.members.add(episode.id);
        if (entry.why) group.whys.add(String(entry.why).trim());
        groups.set(skill.qualifiedName, group);
      }
    }
  }
  return [...groups]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([qualifiedName, group]) => {
      const skill = byQualified.get(qualifiedName);
      const labels = [...group.whys].sort().slice(0, LABEL_LIMIT);
      const episodeIds = [...group.members].sort();
      return {
        signal: 'named-skill',
        key: qualifiedName,
        labels,
        keySources: [NAMED_SOURCE],
        episodeIds,
        taskEpisodeIds: episodeIds,
        tokens: [...new Set(tokenize(`${skill.name.replace(/[-_]/g, ' ')} ${labels.join(' ')}`))].sort()
      };
    });
}

// One cluster per family from families.json. Unknown episode ids are dropped.
export function familyClusters(families, byId) {
  return (families?.families ?? []).map((family) => {
    const episodeIds = [...new Set((family.episodeIds ?? []).filter((id) => byId.has(id)))].sort();
    const name = String(family.name ?? '').replace(/-/g, ' ').trim();
    return {
      signal: 'family',
      key: name,
      labels: [String(family.description ?? '')],
      keySources: [FAMILY_SOURCE],
      episodeIds,
      taskEpisodeIds: episodeIds,
      tokens: [...new Set(tokenize(`${name} ${family.description ?? ''}`))].sort()
    };
  });
}

// userInvoked: qualified names of user-invoked skills. They cannot fire by themselves, so they are never silent.
export function kindHintFor(preMatch, invoked, minEpisodes, rates = new Map(), correctedEpisodes = 0, userInvoked = new Set()) {
  const misfire = [...invoked]
    .filter(([, stats]) => correctedEpisodes > 0 && stats.correctedEpisodes >= minEpisodes)
    .map(([name, stats]) => ({ name, stats, lift: stats.correctedEpisodes / correctedEpisodes / (rates.get(name) || 1) }))
    .filter((entry) => entry.lift >= MISFIRE_LIFT)
    .sort((a, b) => b.lift - a.lift || b.stats.correctedEpisodes - a.stats.correctedEpisodes || a.name.localeCompare(b.name))[0];
  if (misfire) {
    return {
      kindHint: 'misfiring-skill',
      kindTarget: misfire.name,
      kindReason: `${misfire.name} fired in ${misfire.stats.correctedEpisodes} of ${correctedEpisodes} corrected episodes, ${Math.round(misfire.lift * 10) / 10} times its rate in the run`
    };
  }
  // One summary that names a skill is weak evidence. Two or more count.
  const silent = preMatch.find(
    (match) =>
      (match.overlap >= SILENT_OVERLAP || match.namedInEpisodes >= NAMED_MIN_EPISODES) &&
      match.invokedInEpisodes === 0 &&
      !userInvoked.has(match.qualifiedName)
  );
  if (silent) {
    return {
      kindHint: 'silent-skill',
      kindTarget: silent.qualifiedName,
      kindReason: silent.named
        ? `a summary names ${silent.qualifiedName} and it never fired`
        : `${silent.qualifiedName} overlaps ${silent.overlap} and never fired`
    };
  }
  return {
    kindHint: 'new-skill',
    kindTarget: null,
    kindReason: 'no model-invoked catalog skill overlaps 0.3 or more without firing, and none fired with repeated corrections'
  };
}

function topCommands(members) {
  const counts = new Map();
  for (const episode of members) {
    for (const pattern of new Set((episode.commandPatterns ?? []).map((entry) => entry.pattern))) counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_COMMANDS)
    .map(([pattern, episodes]) => ({ pattern, episodes }));
}

function buildCandidate(cluster, members, days, context) {
  const { catalog, resolve, minEpisodes, rates } = context;
  const costMedian = median(members.map(episodeCost));
  const corrections = members.reduce((sum, episode) => sum + correctionsOf(episode), 0);
  const correctedEpisodes = members.filter((episode) => correctionsOf(episode) > 0).length;
  const invoked = invokedSkills(members, resolve);
  // How many of the candidate's summaries name each skill in skillsThatShouldHaveFired.
  const named = new Map();
  for (const episode of members) {
    const inEpisode = new Set((episode.summary?.skillsThatShouldHaveFired ?? []).flatMap((entry) => resolve(entry.name).map((skill) => skill.qualifiedName)));
    for (const qualifiedName of inEpisode) named.set(qualifiedName, (named.get(qualifiedName) ?? 0) + 1);
  }
  const tokens = new Set(cluster.tokens);
  const scored = catalog.skills
    .map((entry) => ({ entry, overlap: overlap(tokens, skillTokens(entry)) }))
    .sort((a, b) => b.overlap - a.overlap || a.entry.qualifiedName.localeCompare(b.entry.qualifiedName));
  const picked = scored.slice(0, PRE_MATCH_TOP).filter((item) => item.overlap > 0);
  for (const qualifiedName of [...named.keys()].sort()) {
    if (picked.some((item) => item.entry.qualifiedName === qualifiedName)) continue;
    const hit = scored.find((item) => item.entry.qualifiedName === qualifiedName);
    if (hit) picked.push(hit);
  }
  const userInvoked = new Set(picked.filter(({ entry }) => entry.invocation === 'user').map(({ entry }) => entry.qualifiedName));
  const preMatch = picked.map(({ entry, overlap: value }) => ({
    qualifiedName: entry.qualifiedName,
    origin: entry.origin,
    overlap: round2(value),
    invokedInEpisodes: invoked.get(entry.qualifiedName)?.episodes ?? 0,
    correctedEpisodes: invoked.get(entry.qualifiedName)?.correctedEpisodes ?? 0,
    named: named.has(entry.qualifiedName),
    namedInEpisodes: named.get(entry.qualifiedName) ?? 0
  }));
  const kind = kindHintFor(preMatch, invoked, minEpisodes, rates, correctedEpisodes, userInvoked);
  if (cluster.signal === 'named-skill') {
    kind.kindHint = 'silent-skill';
    kind.kindTarget = cluster.key;
    kind.kindReason = `${cluster.key} is named in ${members.length} episodes and fired in none of them`;
  }
  return {
    signal: cluster.signal,
    key: cluster.key,
    labels: cluster.labels,
    keySources: cluster.keySources,
    episodes: members.length,
    distinctDays: days.size,
    sources: [...new Set(members.map((episode) => episode.source))].sort(),
    episodeIds: cluster.taskEpisodeIds,
    commandEpisodes: cluster.episodeIds.length - cluster.taskEpisodeIds.length,
    cost: { median: costMedian, score: members.length * costMedian, corrections },
    ...kind,
    preMatch,
    invoked: [...invoked]
      .map(([qualifiedName, stats]) => ({ qualifiedName, ...stats }))
      .sort((a, b) => b.episodes - a.episodes || a.qualifiedName.localeCompare(b.qualifiedName)),
    topCommands: topCommands(members),
    related: []
  };
}

function rankOrder(a, b) {
  return b.cost.score - a.cost.score || b.distinctDays - a.distinctDays || b.cost.corrections - a.cost.corrections || a.key.localeCompare(b.key);
}

function catalogUsage(episodes, catalog, resolve) {
  const usage = new Map(catalog.skills.map((skill) => [skill.qualifiedName, {
    qualifiedName: skill.qualifiedName,
    origin: skill.origin,
    invocation: skill.invocation,
    invocations: 0,
    episodes: 0,
    lastUsed: null
  }]));
  for (const episode of episodes) {
    const counts = new Map();
    for (const entry of invocationsOf(episode)) {
      for (const skill of resolve(entry.name)) counts.set(skill.qualifiedName, (counts.get(skill.qualifiedName) ?? 0) + entry.count);
    }
    const day = (episode.endedAt ?? episode.startedAt ?? '').slice(0, 10) || null;
    for (const [qualifiedName, count] of counts) {
      const stats = usage.get(qualifiedName);
      stats.invocations += count;
      stats.episodes += 1;
      if (day && (!stats.lastUsed || day > stats.lastUsed)) stats.lastUsed = day;
    }
  }
  return [...usage.values()]
    .map((stats) => ({ ...stats, neverInvoked: stats.invocations === 0 }))
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
}

// "auto" is the newest sibling run folder, sorted by name, that sorts before this one and holds suggestions.json.
export function findPreviousRun(runDir, previous) {
  if (!previous) return null;
  if (previous !== 'auto') return path.resolve(previous);
  const own = path.resolve(runDir);
  const parent = path.dirname(own);
  if (!existsSync(parent)) return null;
  const earlier = readdirSync(parent)
    .filter((name) => name < path.basename(own) && existsSync(path.join(parent, name, 'suggestions.json')))
    .sort();
  return earlier.length ? path.join(parent, earlier.at(-1)) : null;
}

export function isResolved(suggestion, catalog) {
  const change = suggestion.proposal?.change;
  const target = change ? catalog.skills.find((skill) => skill.qualifiedName === change.skill || skill.name === change.skill) : null;
  if (suggestion.kind === 'silent-skill' && change) {
    return Boolean(target) && normalizeText(target.description) === normalizeText(change.descriptionAfter);
  }
  if (suggestion.kind === 'misfiring-skill' && change) {
    if (!target || !existsSync(target.path)) return false;
    return normalizeText(readFileSync(target.path, 'utf8')).includes(normalizeText(change.learningsEntry).slice(0, 60));
  }
  const name = suggestion.proposal?.name;
  if (name && catalog.skills.some((skill) => skill.name === name)) return true;
  const description = suggestion.proposal?.description;
  if (!description) return false;
  const checked = new Set((suggestion.catalogChecked ?? []).map((entry) => entry.qualifiedName));
  const probe = tokenize(description);
  return catalog.skills.some((skill) => !checked.has(skill.qualifiedName) && overlap(probe, skillTokens(skill)) >= RESOLVED_OVERLAP);
}

export function previousStatuses({ dir, suggestions }, episodes, catalog) {
  const since = suggestions.generatedAt ?? '';
  const statuses = (suggestions.suggestions ?? []).map((suggestion) => {
    const resolved = isResolved(suggestion, catalog);
    const probe = new Set(tokenize([
      suggestion.title,
      String(suggestion.proposal?.name ?? '').replace(/-/g, ' '),
      ...(suggestion.proposal?.triggerPhrases ?? []),
      ...(suggestion.candidateKeys ?? [])
    ].join(' ')));
    const newEpisodes = episodes
      .filter((episode) => (episode.startedAt ?? '') > since && episodeKeys(episode).some((key) => overlap(key.tokens, probe) >= NEW_EPISODE_OVERLAP))
      .map((episode) => episode.id);
    const status = resolved ? 'resolved' : newEpisodes.length ? 'still-open' : 'stale';
    return { id: suggestion.id, kind: suggestion.kind, title: suggestion.title, status, newEpisodes };
  });
  return { runId: suggestions.runId ?? path.basename(dir), dir, generatedAt: since || null, statuses };
}

function addRelated(candidates) {
  for (const candidate of candidates) {
    candidate.related = candidates
      .filter((other) => other !== candidate && jaccard(candidate.episodeIds, other.episodeIds) >= RELATED_JACCARD)
      .map((other) => other.key);
  }
}

export function aggregate({ episodes, catalog, families = null, minEpisodes = 3, minDays = 2, maxCandidates = MAX_CANDIDATES, previous = null, runId = null }) {
  const byId = new Map(episodes.map((episode) => [episode.id, episode]));
  const resolve = makeResolver(catalog.skills);
  const context = { catalog, resolve, minEpisodes, rates: firingRates(episodes, resolve) };
  const clusters = clusterEpisodes(episodes);
  const named = namedSkillClusters(episodes, catalog, resolve);
  const familyList = familyClusters(families, byId);
  const passed = [];
  const below = [];
  const commandClusters = [];
  const maxFamilyEpisodes = Math.floor(MAX_FAMILY_SHARE * episodes.length);
  for (const cluster of [...clusters, ...named, ...familyList]) {
    if (!cluster.taskEpisodeIds.length) {
      if (cluster.signal !== 'cluster') continue;
      const members = cluster.episodeIds.map((id) => byId.get(id));
      commandClusters.push({ key: cluster.key, episodes: members.length, distinctDays: new Set(members.flatMap((episode) => episode.days ?? [])).size });
      continue;
    }
    const members = cluster.taskEpisodeIds.map((id) => byId.get(id));
    const days = new Set(members.flatMap((episode) => episode.days ?? []));
    const base = { signal: cluster.signal, key: cluster.key, episodes: members.length, distinctDays: days.size };
    if (members.length < minEpisodes) below.push({ ...base, reason: `${members.length} episode(s), need ${minEpisodes}` });
    else if (days.size < minDays) below.push({ ...base, reason: `${days.size} distinct day(s), need ${minDays}` });
    else if (cluster.signal === 'family' && members.length > maxFamilyEpisodes) {
      below.push({ ...base, reason: `too broad: ${members.length} of ${episodes.length} episodes, the limit is ${maxFamilyEpisodes}` });
    } else passed.push(buildCandidate(cluster, members, days, context));
  }
  passed.sort(rankOrder);
  const candidates = passed.slice(0, maxCandidates);
  for (const extra of passed.slice(maxCandidates)) {
    below.push({ signal: extra.signal, key: extra.key, episodes: extra.episodes, distinctDays: extra.distinctDays, reason: `outside the top ${maxCandidates} by score` });
  }
  addRelated(candidates);
  below.sort((a, b) => b.episodes - a.episodes || a.key.localeCompare(b.key));
  commandClusters.sort((a, b) => b.episodes - a.episodes || a.key.localeCompare(b.key));
  const bySource = {};
  for (const episode of episodes) bySource[episode.source] = (bySource[episode.source] ?? 0) + 1;
  return {
    runId,
    generatedAt: new Date().toISOString(),
    thresholds: { minEpisodes, minDays, mergeJaccard: MERGE_JACCARD, silentOverlap: SILENT_OVERLAP, misfireLift: MISFIRE_LIFT, maxFamilyShare: MAX_FAMILY_SHARE, maxCandidates },
    totals: {
      episodes: episodes.length,
      bySource,
      withSummary: episodes.filter((episode) => episode.summary).length,
      clusters: clusters.length,
      namedSkills: named.length,
      families: familyList.length,
      familiesBackend: families?.backend ?? null
    },
    candidates,
    belowThreshold: below.slice(0, BELOW_THRESHOLD_LIMIT),
    belowThresholdTotal: below.length,
    commandClusters: commandClusters.slice(0, COMMAND_CLUSTER_LIMIT),
    commandClustersTotal: commandClusters.length,
    catalogUsage: catalogUsage(episodes, catalog, resolve),
    previous: previous ? previousStatuses(previous, episodes, catalog) : null
  };
}

async function main(argv) {
  const { values } = parseCli(argv, {
    run: { type: 'string' },
    previous: { type: 'string' },
    'min-episodes': { type: 'number', default: 3 },
    'min-days': { type: 'number', default: 2 },
    'max-candidates': { type: 'number', default: MAX_CANDIDATES }
  });
  if (!values.run) throw new UsageError('--run <dir> is required');
  const runDir = path.resolve(values.run);
  const episodes = await readJsonl(path.join(runDir, 'evidence.jsonl'));
  const catalog = await readJson(path.join(runDir, 'catalog.json'));
  const families = await readOptionalJson(path.join(runDir, 'families.json'));
  const previousDir = findPreviousRun(runDir, values.previous);
  const previous = previousDir ? { dir: previousDir, suggestions: await readJson(path.join(previousDir, 'suggestions.json')) } : null;
  const result = aggregate({
    episodes,
    catalog,
    families,
    minEpisodes: values['min-episodes'],
    minDays: values['min-days'],
    maxCandidates: values['max-candidates'],
    previous,
    runId: path.basename(runDir)
  });
  await writeJson(path.join(runDir, 'aggregate.json'), result);
  emit({
    candidates: result.candidates.length,
    belowThreshold: result.belowThresholdTotal,
    commandClusters: result.commandClustersTotal,
    families: result.totals.families,
    namedSkills: result.totals.namedSkills,
    previous: result.previous?.statuses.length ?? 0
  });
}

if (isMain(import.meta.url)) runMain(main);
