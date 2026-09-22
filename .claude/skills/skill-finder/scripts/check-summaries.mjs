#!/usr/bin/env node
// Plans summary batches and validates one batch of episode summaries.
// Schema: references/summary-schema.md. Prompt: references/summary-prompt.md.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError, UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { readJsonl, writeJson } from './lib/jsonl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROMPT_FILE = path.join(HERE, '..', 'references', 'summary-prompt.md');
export const BATCH_SIZE = 10;
const OUTCOMES = ['completed', 'partial', 'abandoned', 'unknown'];
const CONFIDENCE = ['high', 'medium', 'low'];

const isStr = (value) => typeof value === 'string';
const isStrArray = (value) => Array.isArray(value) && value.every(isStr);
const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const arrayOf = (value, check) => Array.isArray(value) && value.every((item) => isObj(item) && check(item));

// Backends sometimes wrap the array in prose. Try the whole text, then the outermost [...].
export function extractJsonArray(text) {
  const trimmed = String(text ?? '').trim();
  const attempts = [trimmed];
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end > start) attempts.push(trimmed.slice(start, end + 1));
  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt);
      if (Array.isArray(value)) return value;
      if (isObj(value) && Array.isArray(value.summaries)) return value.summaries;
    } catch {
      // Try the next form.
    }
  }
  return null;
}

export function summaryProblems(summary, ids) {
  if (!isObj(summary)) return ['summary is not an object'];
  const problems = [];
  if (!isStr(summary.episodeId)) problems.push('episodeId must be a string');
  else if (!ids.has(summary.episodeId)) problems.push(`unknown episodeId ${summary.episodeId}`);
  if (!isStr(summary.goal) || !summary.goal.trim()) problems.push('goal must be a non-empty string');
  if (!OUTCOMES.includes(summary.outcome)) problems.push(`outcome must be one of ${OUTCOMES.join(', ')}`);
  if (!arrayOf(summary.procedures, (p) => isStr(p.name) && isStrArray(p.steps) && typeof p.taughtByUser === 'boolean')) {
    problems.push('procedures must be [{ name, steps[], taughtByUser }]');
  }
  if (!arrayOf(summary.corrections, (c) => isStr(c.what) && isStr(c.cause) && isStr(c.fix))) {
    problems.push('corrections must be [{ what, cause, fix }]');
  }
  if (!isStrArray(summary.repeatedManualSteps)) problems.push('repeatedManualSteps must be a string array');
  if (!arrayOf(summary.skillCandidates, (c) => isStr(c.name) && isStr(c.why))) problems.push('skillCandidates must be [{ name, why }]');
  if (!arrayOf(summary.skillsThatShouldHaveFired, (c) => isStr(c.name) && isStr(c.why))) {
    problems.push('skillsThatShouldHaveFired must be [{ name, why }]');
  }
  if (!CONFIDENCE.includes(summary.confidence)) problems.push(`confidence must be one of ${CONFIDENCE.join(', ')}`);
  return problems;
}

export function validateBatch(text, ids) {
  const summaries = extractJsonArray(text);
  if (!summaries) return { summaries: [], errors: [{ index: null, episodeId: null, problems: ['no JSON array found'] }] };
  const errors = [];
  const seen = new Set();
  summaries.forEach((summary, index) => {
    const problems = summaryProblems(summary, ids);
    if (isObj(summary) && isStr(summary.episodeId)) {
      if (seen.has(summary.episodeId)) problems.push('duplicate episodeId');
      seen.add(summary.episodeId);
    }
    if (problems.length) errors.push({ index, episodeId: summary?.episodeId ?? null, problems });
  });
  return { summaries, errors };
}

function firstSentence(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  const match = value.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : value).trim().slice(0, 160);
}

export function catalogLines(catalog) {
  return (catalog?.skills ?? []).map((skill) => `- ${skill.qualifiedName}: ${firstSentence(skill.description)}`);
}

async function plan(runDir, size) {
  const episodes = await readJsonl(path.join(runDir, 'evidence.jsonl'));
  const withDigest = episodes.filter((episode) => episode.digest && existsSync(path.join(runDir, episode.digest)));
  const batches = [];
  for (let i = 0; i < withDigest.length; i += size) {
    const slice = withDigest.slice(i, i + size);
    const name = `batch-${String(batches.length + 1).padStart(2, '0')}`;
    batches.push({
      name,
      file: path.join(runDir, 'summaries', `${name}.json`),
      episodeIds: slice.map((episode) => episode.id),
      digests: slice.map((episode) => path.join(runDir, episode.digest))
    });
  }
  const bytes = withDigest.reduce((sum, episode) => sum + statSync(path.join(runDir, episode.digest)).size, 0);
  const catalogFile = path.join(runDir, 'catalog.json');
  const catalog = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, 'utf8')) : null;
  const prompt = readFileSync(PROMPT_FILE, 'utf8').trim();
  const lines = catalogLines(catalog);
  const question = lines.length ? `${prompt}\n\nInstalled skills:\n${lines.join('\n')}\n` : `${prompt}\n`;
  const questionFile = path.join(runDir, 'summaries', 'question.txt');
  await mkdir(path.dirname(questionFile), { recursive: true });
  await writeFile(questionFile, question);
  await writeJson(path.join(runDir, 'summaries', 'plan.json'), { batchSize: size, digests: withDigest.length, bytes, calls: batches.length, batches });
  return { digests: withDigest.length, bytes, calls: batches.length, question: questionFile };
}

async function main(argv) {
  const { values } = parseCli(argv, {
    run: { type: 'string' },
    batch: { type: 'string' },
    plan: { type: 'boolean' },
    size: { type: 'number', default: BATCH_SIZE }
  });
  if (!values.run) throw new UsageError('--run <dir> is required');
  const runDir = path.resolve(values.run);
  if (values.plan) {
    emit(await plan(runDir, values.size));
    return;
  }
  if (!values.batch) throw new UsageError('pass --plan or --batch <file>');
  const batchFile = path.resolve(values.batch);
  if (!existsSync(batchFile)) throw new InputError(`missing batch file: ${batchFile}`);
  const ids = new Set((await readJsonl(path.join(runDir, 'evidence.jsonl'))).map((episode) => episode.id));
  const { summaries, errors } = validateBatch(await readFile(batchFile, 'utf8'), ids);
  emit({ batch: batchFile, valid: errors.length === 0, summaries: summaries.length, errors: errors.slice(0, 20) });
  if (errors.length) process.exitCode = 1;
}

if (isMain(import.meta.url)) runMain(main);
