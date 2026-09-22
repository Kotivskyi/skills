#!/usr/bin/env node
// Adapter: OpenSpec archive -> evidence.jsonl + digests/.
// Knowledge for this source: references/sources/openspec-archive.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { InputError, UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { appendJsonl, existingIds } from './lib/jsonl.mjs';
import { countsToList, redact } from './lib/redact.mjs';
import { commandPatterns } from './lib/tokens.mjs';
import { digestPath, inWindow, validWindowValue } from './lib/paths.mjs';
import { capDigest, truncate, writeDigest } from './lib/digest.mjs';

export const SOURCE = 'openspec-archive';
const FOLDER = /^(\d{4}-\d{2}-\d{2})-(.+)$/;
// Section names vary by schema.
const WHY = /^(why|motivation|problem)\b/i;
const WHAT_CHANGES = /^(what changes|changes|scope)\b/i;

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

// Returns the lines under a level-2 or level-3 heading, with 1-based line numbers.
export function findSection(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#{2,3}\s/.test(line) && heading.test(line.replace(/^#+\s*/, '').trim()));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s/);
    if (match && match[1].length <= level) break;
    body.push({ text: lines[i], line: i + 1 });
  }
  return body;
}

export function firstParagraph(body) {
  if (!body) return null;
  const start = body.findIndex((row) => row.text.trim() !== '');
  if (start === -1) return null;
  const parts = [];
  for (let i = start; i < body.length && body[i].text.trim() !== ''; i += 1) parts.push(body[i].text.trim());
  return { text: parts.join(' '), line: body[start].line };
}

export function firstBullets(body, count) {
  if (!body) return [];
  return body
    .filter((row) => /^\s*[-*]\s+/.test(row.text))
    .slice(0, count)
    .map((row) => ({ text: row.text.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim(), line: row.line }));
}

export function taskOutcome(tasks) {
  if (tasks === null || tasks === undefined) return { outcome: 'unknown', total: 0, checked: 0 };
  const checked = (tasks.match(/^\s*[-*]\s+\[[xX]\]/gm) ?? []).length;
  const open = (tasks.match(/^\s*[-*]\s+\[ \]/gm) ?? []).length;
  const total = checked + open;
  let outcome = 'unknown';
  if (total > 0) outcome = open === 0 ? 'completed' : checked === 0 ? 'abandoned' : 'partial';
  return { outcome, total, checked };
}

function projectRoot(archiveDir) {
  const parts = archiveDir.split(path.sep);
  if (parts.slice(-3).join('/') === 'openspec/changes/archive') return parts.slice(0, -3).join(path.sep) || path.sep;
  return path.dirname(archiveDir);
}

export function extractChange(archiveDir, folder) {
  const [, date, slug] = folder.match(FOLDER);
  const dir = path.join(archiveDir, folder);
  const counts = new Map();
  const proposalFile = path.join(dir, 'proposal.md');
  const yaml = readIfExists(path.join(dir, '.openspec.yaml'));
  // Redact once. Redaction never adds or removes a newline, so line numbers stay valid.
  const rawProposal = readIfExists(proposalFile);
  const rawTasks = readIfExists(path.join(dir, 'tasks.md'));
  const proposal = rawProposal === null ? null : redact(rawProposal, counts);
  const tasks = rawTasks === null ? null : redact(rawTasks, counts);

  const created = yaml?.match(/^created:\s*['"]?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  const days = [...new Set([created, date].filter(Boolean))].sort();
  const intents = [];
  if (proposal) {
    const why = firstParagraph(findSection(proposal, WHY));
    if (why) intents.push({ text: truncate(why.text, 600), pointer: { file: proposalFile, line: why.line } });
    for (const bullet of firstBullets(findSection(proposal, WHAT_CHANGES), 3)) {
      intents.push({ text: truncate(bullet.text, 600), pointer: { file: proposalFile, line: bullet.line } });
    }
  }
  const heading = proposal?.match(/^#\s+(.+)$/m)?.[1]?.replace(/^(proposal|change)\s*:\s*/i, '').trim();
  const title = truncate(heading || slug.replace(/-/g, ' '), 200);
  const { outcome, total } = taskOutcome(tasks);
  const patterns = new Map();
  for (const match of (tasks ?? '').matchAll(/`([^`\n]+)`/g)) {
    for (const pattern of commandPatterns(match[1])) patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
  }
  const specsDir = path.join(dir, 'specs');
  const artifacts = existsSync(specsDir)
    ? readdirSync(specsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
  const files = ['.openspec.yaml', 'proposal.md', 'design.md', 'tasks.md'].map((name) => path.join(dir, name)).filter((file) => existsSync(file));
  const id = `${SOURCE}:${folder}`;
  const record = {
    id,
    source: SOURCE,
    project: projectRoot(archiveDir),
    startedAt: `${days[0]}T00:00:00.000Z`,
    endedAt: `${date}T00:00:00.000Z`,
    days,
    title,
    intents,
    skillsInvoked: [],
    commandsUsed: [],
    toolsUsed: {},
    commandPatterns: [...patterns]
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)),
    userCorrections: [],
    repeatedInstructions: [],
    artifacts,
    outcome,
    size: {
      userMessages: intents.length,
      assistantMessages: 0,
      toolCalls: total,
      bytes: files.reduce((sum, file) => sum + statSync(file).size, 0)
    },
    digest: digestPath(id),
    summary: null,
    redactions: countsToList(counts)
  };
  const digest = capDigest(redact([
    `# ${title}`,
    '',
    `- episode: ${id}`,
    `- source: ${SOURCE}`,
    `- project: ${record.project}`,
    `- time: ${record.startedAt} .. ${record.endedAt}`,
    `- outcome: ${outcome}`,
    '',
    '## Proposal',
    '',
    proposal ?? '(missing)',
    '',
    '## Tasks',
    '',
    tasks ?? '(missing)'
  ].join('\n')));
  return { record, digest };
}

async function main(argv) {
  const { values } = parseCli(argv, {
    out: { type: 'string' },
    path: { type: 'string' },
    since: { type: 'string' },
    until: { type: 'string' },
    'max-episodes': { type: 'number' }
  });
  if (!values.out) throw new UsageError('--out <run-dir> is required');
  for (const flag of ['since', 'until']) {
    if (values[flag] && !validWindowValue(values[flag])) throw new UsageError(`--${flag} needs an ISO date, got ${values[flag]}`);
  }
  const archiveDir = path.resolve(values.path ?? path.join(process.cwd(), 'openspec', 'changes', 'archive'));
  if (!existsSync(archiveDir) || !statSync(archiveDir).isDirectory()) {
    throw new InputError(`openspec-archive: archive not found or unreadable: ${archiveDir}`);
  }
  const runDir = path.resolve(values.out);
  await mkdir(path.join(runDir, 'digests'), { recursive: true });
  const evidenceFile = path.join(runDir, 'evidence.jsonl');
  const seen = await existingIds(evidenceFile);
  let skipped = 0;
  let bytes = 0;
  const found = [];
  const entries = readdirSync(archiveDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!FOLDER.test(entry.name) || seen.has(`${SOURCE}:${entry.name}`)) {
      skipped += 1;
      continue;
    }
    const result = extractChange(archiveDir, entry.name);
    bytes += result.record.size.bytes;
    if (!inWindow(result.record.endedAt, values)) {
      skipped += 1;
      continue;
    }
    found.push(result);
  }
  found.sort((a, b) => b.record.endedAt.localeCompare(a.record.endedAt));
  const limit = values['max-episodes'];
  const kept = limit ? found.slice(0, limit) : found;
  skipped += found.length - kept.length;
  kept.sort((a, b) => a.record.endedAt.localeCompare(b.record.endedAt) || a.record.id.localeCompare(b.record.id));
  for (const { record, digest } of kept) await writeDigest(runDir, record.digest, digest);
  await appendJsonl(evidenceFile, kept.map(({ record }) => record));
  emit({ source: SOURCE, episodes: kept.length, skipped, bytes });
}

if (isMain(import.meta.url)) runMain(main);
