// Test helpers. Scripts never import this file.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(SCRIPTS, 'fixtures');

export function tmpDir(prefix = 'skill-finder-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function runScript(name, args = [], options = {}) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, name), ...args], { encoding: 'utf8', ...options });
  const last = result.stdout.trim().split('\n').at(-1);
  let summary = null;
  try {
    summary = last ? JSON.parse(last) : null;
  } catch {
    summary = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, summary };
}

export function makeEpisode(overrides = {}) {
  const { n = 1, size = {}, ...rest } = overrides;
  const base = {
    id: `claude-sessions:ep-${n}`,
    source: 'claude-sessions',
    project: '/work/app',
    startedAt: '2026-09-01T10:00:00.000Z',
    endedAt: '2026-09-01T11:00:00.000Z',
    days: ['2026-09-01'],
    title: `Episode ${n}`,
    intents: [],
    skillsInvoked: [],
    commandsUsed: [],
    toolsUsed: {},
    commandPatterns: [],
    userCorrections: [],
    repeatedInstructions: [],
    artifacts: [],
    outcome: 'unknown',
    size: { userMessages: 1, assistantMessages: 10, toolCalls: 20, bytes: 1000 },
    digest: null,
    summary: null,
    redactions: []
  };
  return { ...base, ...rest, size: { ...base.size, ...size } };
}

export function catalogEntry(overrides = {}) {
  const name = overrides.name ?? 'sample-skill';
  return {
    name,
    namespace: null,
    qualifiedName: name,
    description: '',
    triggers: [],
    invocation: 'model',
    path: `/skills/${name}/SKILL.md`,
    realPath: `/skills/${name}/SKILL.md`,
    origin: 'repo',
    plugin: null,
    aliases: [],
    ...overrides
  };
}

export function makeCatalog(skills, extra = {}) {
  return {
    generatedAt: '2026-09-22T00:00:00.000Z',
    options: null,
    roots: [],
    skillCount: skills.length,
    hash: 'sha256:test',
    skills,
    ...extra
  };
}

export function writeRun(dir, { episodes = [], catalog, suggestions, runJson, files = {} } = {}) {
  mkdirSync(path.join(dir, 'digests'), { recursive: true });
  mkdirSync(path.join(dir, 'summaries'), { recursive: true });
  writeFileSync(
    path.join(dir, 'evidence.jsonl'),
    episodes.map((episode) => JSON.stringify(episode)).join('\n') + (episodes.length ? '\n' : '')
  );
  if (catalog) writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog, null, 2));
  if (suggestions) writeFileSync(path.join(dir, 'suggestions.json'), JSON.stringify(suggestions, null, 2));
  if (runJson) writeFileSync(path.join(dir, 'run.json'), JSON.stringify(runJson, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
