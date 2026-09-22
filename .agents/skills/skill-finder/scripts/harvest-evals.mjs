#!/usr/bin/env node
// Harvests evals for one suggestion in the skill-creator format.
// Rules: references/eval-harvest.md.
import path from 'node:path';
import { UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { readJson, readJsonl, readOptionalJson, writeJson } from './lib/jsonl.mjs';
import { EMAIL_TEST } from './lib/redact.mjs';
import { normalizeText, overlap, tokenize } from './lib/tokens.mjs';
import { invocationsOf, makeResolver } from './aggregate.mjs';

export const POSITIVE_MIN = 0.15;
export const NEAR_MISS_MIN = 0.15;
export const NEAR_MISS_MAX = 0.5;
export const NEAR_DUPLICATE = 0.8;
const WRAPPER = /<\/?(command-|local-command|system-reminder|task-notification|bash-)/;

export function quotas(target) {
  const behavior = Math.max(10, Math.round(target * 0.2));
  const triggers = Math.max(40, target - behavior);
  return { positives: Math.ceil(triggers / 2), negatives: Math.floor(triggers / 2), behavior };
}

export function acceptPrompt(text) {
  const value = String(text ?? '').trim();
  if (value.length < 40 || value.length > 600) return false;
  if (WRAPPER.test(value)) return false;
  if (EMAIL_TEST.test(value)) return false;
  return true;
}

export function keywordSet(suggestion) {
  const change = suggestion.proposal?.change ?? {};
  return new Set(tokenize([
    suggestion.title,
    String(suggestion.proposal?.name ?? '').replace(/-/g, ' '),
    ...(suggestion.proposal?.triggerPhrases ?? []),
    ...(suggestion.candidateKeys ?? []),
    String(change.skill ?? '').replace(/[-:]/g, ' ')
  ].join(' ')));
}

// Rejects exact repeats (normalized) and near-duplicates (overlap >= 0.8).
class Picker {
  constructor(texts = []) {
    this.seen = new Set();
    this.tokens = [];
    for (const text of texts) this.add(text);
  }

  add(text) {
    const key = normalizeText(text);
    const tokens = tokenize(text);
    if (this.seen.has(key) || this.tokens.some((other) => overlap(other, tokens) >= NEAR_DUPLICATE)) return false;
    this.seen.add(key);
    this.tokens.push(tokens);
    return true;
  }
}

export function harvest({ suggestion, episodes, aggregate = null, catalog = null, target = 50 }) {
  const want = quotas(target);
  const keywords = keywordSet(suggestion);
  const own = new Set(suggestion.provenance?.episodeIds ?? []);
  const ownKeys = new Set(suggestion.candidateKeys ?? []);
  const otherClusters = new Set(
    (aggregate?.candidates ?? []).filter((candidate) => !ownKeys.has(candidate.key)).flatMap((candidate) => candidate.episodeIds ?? [])
  );
  const resolve = catalog ? makeResolver(catalog.skills ?? []) : () => [];
  // The skill this suggestion changes, as qualified names. Empty for a new skill.
  const targetName = suggestion.catalogMatch || suggestion.proposal?.change?.skill || null;
  const targets = new Set(targetName ? resolve(targetName).map((skill) => skill.qualifiedName) : []);
  const positives = [];
  const negatives = [];
  const starts = [];
  const ordered = [...episodes].sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')) || a.id.localeCompare(b.id));
  for (const episode of ordered) {
    const intents = (episode.intents ?? []).filter((item) => acceptPrompt(item.text));
    if (own.has(episode.id)) {
      if (intents[0]) starts.push({ episode, intent: intents[0] });
      for (const item of intents) {
        const score = overlap(tokenize(item.text), keywords);
        if (score >= POSITIVE_MIN) positives.push({ episode, intent: item, score });
      }
    } else {
      const fired = invocationsOf(episode).flatMap((entry) => resolve(entry.name).map((skill) => skill.qualifiedName));
      // Where the target skill fired, the prompts can be positives, so they are never negatives.
      if (fired.some((name) => targets.has(name))) continue;
      const preferred = otherClusters.has(episode.id) || fired.some((name) => !targets.has(name));
      for (const item of intents) {
        const score = overlap(tokenize(item.text), keywords);
        if (score >= NEAR_MISS_MIN && score < NEAR_MISS_MAX) negatives.push({ episode, intent: item, score, preferred });
      }
    }
  }
  const byText = (a, b) => a.intent.text.localeCompare(b.intent.text);
  positives.sort((a, b) => b.score - a.score || byText(a, b));
  negatives.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.score - a.score || byText(a, b));

  const picker = new Picker();
  const triggers = [];
  const take = (pool, count, shouldTrigger) => {
    let taken = 0;
    for (const item of pool) {
      if (taken >= count) break;
      if (!picker.add(item.intent.text)) continue;
      triggers.push({
        query: item.intent.text.trim(),
        should_trigger: shouldTrigger,
        episodeId: item.episode.id,
        pointer: item.intent.pointer ?? null,
        origin: 'real'
      });
      taken += 1;
    }
    return taken;
  };
  const realPositives = take(positives, want.positives, true);
  const realNegatives = take(negatives, want.negatives, false);

  const behaviorPicker = new Picker();
  const behavior = [];
  for (const item of starts) {
    if (behavior.length >= want.behavior) break;
    if (!behaviorPicker.add(item.intent.text)) continue;
    behavior.push({
      prompt: item.intent.text.trim(),
      expected_output: '',
      expectations: [],
      episodeId: item.episode.id,
      pointer: item.intent.pointer ?? null,
      origin: 'real'
    });
  }
  return {
    quotas: want,
    keywords: [...keywords].sort(),
    triggers,
    behavior,
    real: { positives: realPositives, negatives: realNegatives, behavior: behavior.length }
  };
}

export function addSynthetic(result, synthetic) {
  const added = { positives: 0, negatives: 0, behavior: 0 };
  const picker = new Picker(result.triggers.map((entry) => entry.query));
  for (const item of synthetic.triggers ?? []) {
    if (typeof item?.should_trigger !== 'boolean' || !acceptPrompt(item.query) || !picker.add(item.query)) continue;
    result.triggers.push({ query: item.query.trim(), should_trigger: item.should_trigger, episodeId: null, pointer: null, origin: 'synthetic' });
    added[item.should_trigger ? 'positives' : 'negatives'] += 1;
  }
  const behaviorPicker = new Picker(result.behavior.map((entry) => entry.prompt));
  for (const item of synthetic.behavior ?? []) {
    if (!acceptPrompt(item?.prompt) || !behaviorPicker.add(item.prompt)) continue;
    result.behavior.push({
      prompt: item.prompt.trim(),
      expected_output: item.expected_output ?? '',
      expectations: item.expectations ?? [],
      episodeId: null,
      pointer: null,
      origin: 'synthetic'
    });
    added.behavior += 1;
  }
  return added;
}

// trigger-eval.json keeps only { query, should_trigger }, because run_eval.py reads only those.
export function toFiles(result, skillName) {
  const triggers = [...result.triggers].sort((a, b) => Number(b.should_trigger) - Number(a.should_trigger));
  return {
    triggerEval: triggers.map(({ query, should_trigger }) => ({ query, should_trigger })),
    provenance: triggers.map(({ query, should_trigger, episodeId, pointer, origin }) => ({ query, should_trigger, episodeId, pointer, origin })),
    evals: {
      skill_name: skillName,
      evals: result.behavior.map((item, index) => ({
        id: index + 1,
        name: `${skillName}-case-${index + 1}`,
        prompt: item.prompt,
        expected_output: item.expected_output,
        files: [],
        expectations: item.expectations,
        provenance: { episodeId: item.episodeId, pointer: item.pointer, origin: item.origin }
      }))
    }
  };
}

export function summarize(result, synthetic, target) {
  const count = (flag) => result.triggers.filter((entry) => entry.should_trigger === flag).length;
  const counts = { positives: count(true), negatives: count(false), behavior: result.behavior.length };
  counts.total = counts.positives + counts.negatives + counts.behavior;
  const real = { ...result.real, total: result.real.positives + result.real.negatives + result.real.behavior };
  const want = result.quotas;
  return {
    target,
    quotas: want,
    counts,
    real,
    synthetic: { ...synthetic, total: synthetic.positives + synthetic.negatives + synthetic.behavior },
    shortfall: {
      positives: Math.max(0, want.positives - real.positives),
      negatives: Math.max(0, want.negatives - real.negatives),
      behavior: Math.max(0, want.behavior - real.behavior),
      total: Math.max(0, target - real.total)
    }
  };
}

export function isPluginCache(dir) {
  return path.resolve(dir).split(path.sep).join('/').includes('/.claude/plugins/');
}

export async function mergeInto(dir, files) {
  const triggerFile = path.join(dir, 'trigger-eval.json');
  const provenanceFile = path.join(dir, 'trigger-eval.provenance.json');
  const evalsFile = path.join(dir, 'evals.json');
  const triggers = (await readOptionalJson(triggerFile)) ?? [];
  const oldProvenance = (await readOptionalJson(provenanceFile)) ?? [];
  // Keep provenance aligned with trigger-eval.json by index.
  const provenance = triggers.map((trigger, index) => {
    const known = oldProvenance[index];
    return known && normalizeText(known.query) === normalizeText(trigger.query)
      ? known
      : { query: trigger.query, should_trigger: trigger.should_trigger, episodeId: null, pointer: null, origin: 'existing' };
  });
  const seen = new Set(triggers.map((trigger) => normalizeText(trigger.query)));
  let addedTriggers = 0;
  files.triggerEval.forEach((trigger, index) => {
    const key = normalizeText(trigger.query);
    if (seen.has(key)) return;
    seen.add(key);
    triggers.push(trigger);
    provenance.push(files.provenance[index]);
    addedTriggers += 1;
  });
  const doc = (await readOptionalJson(evalsFile)) ?? { skill_name: files.evals.skill_name, evals: [] };
  doc.evals = doc.evals ?? [];
  let lastId = doc.evals.reduce((max, entry) => (Number.isInteger(entry.id) && entry.id > max ? entry.id : max), 0);
  const prompts = new Set(doc.evals.map((entry) => normalizeText(entry.prompt)));
  let addedEvals = 0;
  for (const item of files.evals.evals) {
    const key = normalizeText(item.prompt);
    if (prompts.has(key)) continue;
    prompts.add(key);
    lastId += 1;
    doc.evals.push({ ...item, id: lastId, name: `${doc.skill_name}-case-${lastId}` });
    addedEvals += 1;
  }
  await writeJson(triggerFile, triggers);
  await writeJson(provenanceFile, provenance);
  await writeJson(evalsFile, doc);
  return { addedTriggers, addedEvals, triggers: triggers.length, evals: doc.evals.length, lastId };
}

function skillNameFor(suggestion) {
  return String(suggestion.proposal?.name || suggestion.proposal?.change?.skill || suggestion.id).split(':').pop();
}

async function main(argv) {
  const { values } = parseCli(argv, {
    run: { type: 'string' },
    id: { type: 'string' },
    target: { type: 'number', default: 50 },
    out: { type: 'string' },
    'merge-into': { type: 'string' },
    'add-synthetic': { type: 'string' }
  });
  if (!values.run || !values.id) throw new UsageError('--run <dir> and --id <id> are required');
  const runDir = path.resolve(values.run);
  const outDir = path.resolve(values.out ?? path.join(runDir, `evals-${values.id}`));

  if (values['merge-into']) {
    const target = path.resolve(values['merge-into']);
    if (isPluginCache(target)) throw new UsageError(`refusing to merge into a plugin cache: ${target}. Keep the evals in ${outDir}.`);
    const files = {
      triggerEval: await readJson(path.join(outDir, 'trigger-eval.json')),
      provenance: await readJson(path.join(outDir, 'trigger-eval.provenance.json')),
      evals: await readJson(path.join(outDir, 'evals.json'))
    };
    emit({ id: values.id, mergedInto: target, ...(await mergeInto(target, files)) });
    return;
  }

  const suggestions = await readJson(path.join(runDir, 'suggestions.json'));
  const suggestion = (suggestions.suggestions ?? []).find((entry) => entry.id === values.id);
  if (!suggestion) throw new UsageError(`no suggestion with id ${values.id}`);
  const result = harvest({
    suggestion,
    episodes: await readJsonl(path.join(runDir, 'evidence.jsonl')),
    aggregate: await readOptionalJson(path.join(runDir, 'aggregate.json')),
    catalog: await readOptionalJson(path.join(runDir, 'catalog.json')),
    target: values.target
  });
  const synthetic = values['add-synthetic']
    ? addSynthetic(result, await readJson(path.resolve(values['add-synthetic'])))
    : { positives: 0, negatives: 0, behavior: 0 };
  const skillName = skillNameFor(suggestion);
  const files = toFiles(result, skillName);
  const report = summarize(result, synthetic, values.target);
  await writeJson(path.join(outDir, 'trigger-eval.json'), files.triggerEval);
  await writeJson(path.join(outDir, 'trigger-eval.provenance.json'), files.provenance);
  await writeJson(path.join(outDir, 'evals.json'), files.evals);
  await writeJson(path.join(outDir, 'harvest.json'), { id: values.id, skillName, keywords: result.keywords, ...report });
  emit({ id: values.id, out: outDir, ...report });
}

if (isMain(import.meta.url)) runMain(main);
