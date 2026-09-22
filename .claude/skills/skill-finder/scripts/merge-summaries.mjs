#!/usr/bin/env node
// Merges valid summary batches into evidence.jsonl. Invalid batches stay out; their episodes keep summary: null.
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { readJson, readJsonl, writeJson, writeJsonl } from './lib/jsonl.mjs';
import { validateBatch } from './check-summaries.mjs';

const BACKENDS = ['pi', 'subagent', 'none'];

export async function mergeSummaries(runDir) {
  const evidenceFile = path.join(runDir, 'evidence.jsonl');
  const episodes = await readJsonl(evidenceFile);
  const ids = new Set(episodes.map((episode) => episode.id));
  const dir = path.join(runDir, 'summaries');
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => /^batch-\d+\.json$/.test(name)).sort() : [];
  const byId = new Map();
  const invalidBatches = [];
  for (const name of files) {
    const { summaries, errors } = validateBatch(await readFile(path.join(dir, name), 'utf8'), ids);
    if (errors.length) {
      invalidBatches.push(name);
      continue;
    }
    for (const summary of summaries) byId.set(summary.episodeId, summary);
  }
  let merged = 0;
  let outcomesFilled = 0;
  for (const episode of episodes) {
    const summary = byId.get(episode.id);
    if (!summary) continue;
    const { episodeId: _episodeId, ...rest } = summary;
    episode.summary = rest;
    merged += 1;
    if (episode.outcome === 'unknown' && rest.outcome !== 'unknown') {
      episode.outcome = rest.outcome;
      outcomesFilled += 1;
    }
  }
  await writeJsonl(evidenceFile, episodes);
  return { merged, invalidBatches, outcomesFilled, batches: files.length };
}

async function main(argv) {
  const { values } = parseCli(argv, { run: { type: 'string' }, backend: { type: 'string' } });
  if (!values.run) throw new UsageError('--run <dir> is required');
  if (values.backend && !BACKENDS.includes(values.backend)) throw new UsageError(`--backend must be one of ${BACKENDS.join(', ')}`);
  const runDir = path.resolve(values.run);
  const result = await mergeSummaries(runDir);
  if (values.backend) {
    const runFile = path.join(runDir, 'run.json');
    const run = existsSync(runFile) ? await readJson(runFile) : {};
    run.summaryBackend = values.backend;
    run.summaries = { merged: result.merged, invalidBatches: result.invalidBatches };
    await writeJson(runFile, run);
  }
  emit({ ...result, backend: values.backend ?? null });
}

if (isMain(import.meta.url)) runMain(main);
