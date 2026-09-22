#!/usr/bin/env node
// Creates <cwd>/.skill-finder/runs/<YYYYMMDD-HHMMSS>-<slug>/ and run.json.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { writeJson } from './lib/jsonl.mjs';

export const SKILL_FINDER_VERSION = 1;
const IGNORE_LINES = ['.skill-finder', '.skill-finder/', '/.skill-finder', '/.skill-finder/', '.skill-finder/*', '/.skill-finder/*'];

export function runStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export function slugify(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'run';
}

export function gitignoreCovers(cwd) {
  const file = path.join(cwd, '.gitignore');
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).some((line) => IGNORE_LINES.includes(line));
}

async function main(argv) {
  const { values } = parseCli(argv, {
    cwd: { type: 'string' },
    slug: { type: 'string' },
    out: { type: 'string' },
    source: { type: 'string', multiple: true },
    since: { type: 'string' },
    until: { type: 'string' },
    'max-episodes': { type: 'number' },
    'min-episodes': { type: 'number', default: 3 },
    'min-days': { type: 'number', default: 2 },
    now: { type: 'string' }
  });
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) throw new UsageError(`Node 18 or later is required, found ${process.version}`);
  const cwd = path.resolve(values.cwd ?? process.cwd());
  const now = values.now ? new Date(values.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new UsageError(`--now needs an ISO time, got ${values.now}`);
  const runId = `${runStamp(now)}-${slugify(values.slug ?? path.basename(cwd))}`;
  const runDir = path.resolve(values.out ?? path.join(cwd, '.skill-finder', 'runs', runId));
  if (existsSync(path.join(runDir, 'run.json'))) throw new UsageError(`run folder already holds run.json: ${runDir}`);
  await mkdir(path.join(runDir, 'digests'), { recursive: true });
  await mkdir(path.join(runDir, 'summaries'), { recursive: true });
  const insideCwd = !path.relative(cwd, runDir).startsWith('..') && !path.isAbsolute(path.relative(cwd, runDir));
  // Warn only. The skill never edits .gitignore.
  const gitignoreWarning = insideCwd && !gitignoreCovers(cwd);
  await writeJson(path.join(runDir, 'run.json'), {
    runId,
    createdAt: now.toISOString(),
    cwd,
    sources: values.source,
    window: { since: values.since ?? null, until: values.until ?? null, maxEpisodes: values['max-episodes'] ?? null },
    thresholds: { minEpisodes: values['min-episodes'], minDays: values['min-days'] },
    summaryBackend: null,
    versions: { node: process.version, skillFinder: SKILL_FINDER_VERSION }
  });
  emit({ run: runDir, runId, gitignoreWarning });
}

if (isMain(import.meta.url)) runMain(main);
