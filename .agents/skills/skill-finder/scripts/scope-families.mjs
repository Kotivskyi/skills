#!/usr/bin/env node
// Plans the family call, validates its answer, and writes families.json.
// A family is one kind of task that comes back across episodes. It is the shared vocabulary
// that the aggregation counts. Schema: references/family-schema.md. Prompt: references/family-prompt.md.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError, UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { readJson, readJsonl, writeJson } from './lib/jsonl.mjs';
import { isLowInformationTitle } from './lib/tokens.mjs';
import { extractJsonArray } from './check-summaries.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROMPT_FILE = path.join(HERE, '..', 'references', 'family-prompt.md');
export const BATCH_SIZE = 400;
export const MAX_DESCRIPTION_WORDS = 40;
const BACKENDS = ['pi', 'subagent', 'none'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+){1,5}$/;

const isStr = (value) => typeof value === 'string';
const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// One line per episode. Episodes without a goal or a usable title give no line.
export function episodeLine(episode) {
  const summary = episode.summary;
  if (summary) {
    const parts = [`goal: ${clean(summary.goal)}`];
    const procedures = (summary.procedures ?? []).map((procedure) => clean(procedure.name)).filter(Boolean);
    const candidates = (summary.skillCandidates ?? []).map((candidate) => clean(String(candidate.name).replace(/[-_]/g, ' '))).filter(Boolean);
    if (procedures.length) parts.push(`procedures: ${procedures.join('; ')}`);
    if (candidates.length) parts.push(`candidates: ${candidates.join('; ')}`);
    return `- ${episode.id} | ${parts.join(' | ')}`;
  }
  if (isLowInformationTitle(episode.title)) return null;
  return `- ${episode.id} | goal: ${clean(episode.title)}`;
}

export function familyProblems(family, ids) {
  if (!isObj(family)) return ['family is not an object'];
  const problems = [];
  if (!isStr(family.name) || !KEBAB.test(family.name)) problems.push('name must be kebab-case, 2 to 6 words');
  if (!isStr(family.description) || !family.description.trim()) problems.push('description must be a non-empty string');
  else if (clean(family.description).split(' ').length > MAX_DESCRIPTION_WORDS) problems.push(`description must be ${MAX_DESCRIPTION_WORDS} words or less`);
  if (!Array.isArray(family.episodeIds) || !family.episodeIds.length || !family.episodeIds.every(isStr)) {
    problems.push('episodeIds must be a non-empty string array');
    return problems;
  }
  const seen = new Set();
  for (const id of family.episodeIds) {
    if (seen.has(id)) problems.push(`duplicate episodeId ${id}`);
    seen.add(id);
  }
  if (!family.episodeIds.some((id) => ids.has(id))) problems.push('no known episodeId');
  return problems;
}

// Backends mistype an id now and then. An unknown id is a warning, and the family keeps its known ids.
export function unknownIds(family, ids) {
  return Array.isArray(family?.episodeIds) ? family.episodeIds.filter((id) => isStr(id) && !ids.has(id)) : [];
}

export function validateAnswer(text, ids) {
  const families = extractJsonArray(text, ['families']);
  if (!families) return { families: [], errors: [{ index: null, name: null, problems: ['no JSON array found'] }], warnings: [] };
  const errors = [];
  const warnings = [];
  const names = new Set();
  families.forEach((family, index) => {
    const problems = familyProblems(family, ids);
    if (isObj(family) && isStr(family.name)) {
      if (names.has(family.name)) problems.push(`duplicate family ${family.name}`);
      names.add(family.name);
    }
    if (problems.length) errors.push({ index, name: family?.name ?? null, problems });
    for (const id of unknownIds(family, ids)) warnings.push({ index, name: family?.name ?? null, droppedId: id });
  });
  return { families, errors, warnings };
}

// Families with the same name merge. The first description wins. Ids are sorted and unique.
export function mergeFamilies(answers, ids) {
  const byName = new Map();
  for (const families of answers) {
    for (const family of families) {
      const known = byName.get(family.name) ?? { name: family.name, description: clean(family.description), ids: new Set() };
      for (const id of family.episodeIds) if (ids.has(id)) known.ids.add(id);
      byName.set(family.name, known);
    }
  }
  return [...byName.values()]
    .map((family) => ({ name: family.name, description: family.description, episodeIds: [...family.ids].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function plan(runDir, size) {
  const episodes = await readJsonl(path.join(runDir, 'evidence.jsonl'));
  const lines = episodes.map((episode) => ({ id: episode.id, line: episodeLine(episode) })).filter((entry) => entry.line);
  const dir = path.join(runDir, 'families');
  await mkdir(dir, { recursive: true });
  const batches = [];
  let bytes = 0;
  for (let i = 0; i < lines.length; i += size) {
    const slice = lines.slice(i, i + size);
    const name = `batch-${String(batches.length + 1).padStart(2, '0')}`;
    const suffix = String(batches.length + 1).padStart(2, '0');
    const input = path.join(dir, `episodes-${suffix}.md`);
    const text = `# Episodes\n\n${slice.map((entry) => entry.line).join('\n')}\n`;
    await writeFile(input, text);
    bytes += Buffer.byteLength(text);
    batches.push({ name, input, file: path.join(dir, `answer-${suffix}.json`), episodeIds: slice.map((entry) => entry.id) });
  }
  const question = path.join(dir, 'question.txt');
  await writeFile(question, `${readFileSync(PROMPT_FILE, 'utf8').trim()}\n`);
  await writeJson(path.join(dir, 'plan.json'), { batchSize: size, episodes: episodes.length, lines: lines.length, bytes, calls: batches.length, question, batches });
  return { episodes: episodes.length, lines: lines.length, bytes, calls: batches.length, question };
}

async function recordRun(runDir, families) {
  const runFile = path.join(runDir, 'run.json');
  const run = existsSync(runFile) ? await readJson(runFile) : {};
  run.families = families;
  await writeJson(runFile, run);
}

async function main(argv) {
  const { values } = parseCli(argv, {
    run: { type: 'string' },
    plan: { type: 'boolean' },
    size: { type: 'number', default: BATCH_SIZE },
    answer: { type: 'string', multiple: true },
    backend: { type: 'string' }
  });
  if (!values.run) throw new UsageError('--run <dir> is required');
  if (values.backend && !BACKENDS.includes(values.backend)) throw new UsageError(`--backend must be one of ${BACKENDS.join(', ')}`);
  const runDir = path.resolve(values.run);
  if (values.plan) {
    if (!Number.isInteger(values.size) || values.size < 1) throw new UsageError(`--size needs an integer of 1 or more, got ${values.size}`);
    emit(await plan(runDir, values.size));
    return;
  }
  if (!values.answer.length) {
    if (values.backend !== 'none') throw new UsageError('pass --plan, --answer <file>, or --backend none');
    const skipped = { backend: 'none', families: 0, assigned: 0 };
    await recordRun(runDir, skipped);
    emit(skipped);
    return;
  }
  const episodes = await readJsonl(path.join(runDir, 'evidence.jsonl'));
  const ids = new Set(episodes.map((episode) => episode.id));
  const answers = [];
  const errors = [];
  const warnings = [];
  for (const file of values.answer.map((entry) => path.resolve(entry))) {
    if (!existsSync(file)) throw new InputError(`missing answer file: ${file}`);
    const result = validateAnswer(await readFile(file, 'utf8'), ids);
    answers.push(result.families);
    errors.push(...result.errors.map((error) => ({ file, ...error })));
    warnings.push(...result.warnings.map((warning) => ({ file, ...warning })));
  }
  if (errors.length) {
    emit({ valid: false, errors: errors.slice(0, 20), warnings: warnings.length });
    process.exitCode = 1;
    return;
  }
  const backend = values.backend ?? 'pi';
  const families = mergeFamilies(answers, ids);
  const assigned = new Set(families.flatMap((family) => family.episodeIds)).size;
  const droppedIds = warnings.map((warning) => warning.droppedId);
  const out = path.join(runDir, 'families.json');
  await writeJson(out, { generatedAt: new Date().toISOString(), backend, episodes: episodes.length, assigned, droppedIds, families });
  await recordRun(runDir, { backend, families: families.length, assigned, droppedIds: droppedIds.length });
  emit({ valid: true, backend, families: families.length, assigned, droppedIds: droppedIds.length, out });
}

if (isMain(import.meta.url)) runMain(main);
