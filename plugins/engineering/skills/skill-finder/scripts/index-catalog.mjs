#!/usr/bin/env node
// Indexes the installed skill catalog: repo, user, and plugin roots.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { writeJson } from './lib/jsonl.mjs';

const MARKERS = ['use this when', 'use whenever', 'use when', 'trigger on', 'when the user'];
const MAX_TRIGGERS = 30;

// Minimal YAML frontmatter reader: plain, quoted, and block scalar values.
export function parseFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i += 1) {
    const pair = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, raw] = pair;
    let value = raw.trim();
    if (/^[>|][-+]?$/.test(value)) {
      const folded = value.startsWith('>');
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        i += 1;
        block.push(lines[i].trim());
      }
      value = folded ? block.filter(Boolean).join(' ') : block.join('\n').trim();
    } else if (/^".*"$/.test(value)) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        i += 1;
        value = `${value} ${lines[i].trim()}`.trim();
      }
    }
    data[key] = value;
  }
  return data;
}

export function extractTriggers(description) {
  const text = String(description ?? '').replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const phrases = [];
  for (const quoted of text.matchAll(/["“]([^"”]{3,80})["”]/g)) phrases.push(quoted[1]);
  for (const marker of MARKERS) {
    let from = lower.indexOf(marker);
    while (from !== -1) {
      const start = from + marker.length;
      // "use when" must not match inside "use whenever".
      if (!/[a-z]/.test(lower[start] ?? '')) {
        const rest = lower.slice(start);
        const end = rest.search(/[.!?](\s|$)|—| - /);
        const clause = end === -1 ? rest : rest.slice(0, end);
        for (const part of clause.split(/,|;|\bor\b/)) phrases.push(part);
      }
      from = lower.indexOf(marker, start);
    }
  }
  const triggers = [];
  for (const raw of phrases) {
    const phrase = raw
      .toLowerCase()
      .replace(/["“”()]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(and|the user|user|you|to)\s+/, '')
      .trim();
    const words = phrase.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 12 || triggers.includes(phrase)) continue;
    triggers.push(phrase);
    if (triggers.length === MAX_TRIGGERS) break;
  }
  return triggers;
}

function childDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => path.join(dir, entry.name));
}

// The skill folders that <installPath>/.claude-plugin/plugin.json lists in `skills`.
// null means: use the default skills/*/SKILL.md scan.
function manifestSkillDirs(installPath, warnings) {
  const file = path.join(installPath, '.claude-plugin', 'plugin.json');
  if (!existsSync(file)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    warnings.push(`cannot parse ${file}`);
    return null;
  }
  const listed = [].concat(manifest?.skills ?? []).filter((entry) => typeof entry === 'string');
  const found = listed.map((entry) => path.resolve(installPath, entry)).filter((dir) => existsSync(dir));
  // Claude Code runs the default scan when none of the listed paths exist.
  if (!found.length) return null;
  // An entry is a skill folder, or a folder of skill folders.
  return found.flatMap((dir) => {
    if (existsSync(path.join(dir, 'SKILL.md'))) return [dir];
    return statSync(dir).isDirectory() ? childDirs(dir) : [];
  });
}

function pluginRoots(home, warnings) {
  const file = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    warnings.push(`cannot parse ${file}`);
    return [];
  }
  const roots = [];
  for (const [key, installs] of Object.entries(data?.plugins ?? {})) {
    for (const install of [].concat(installs)) {
      if (!install?.installPath) continue;
      const namespace = key.split('@')[0];
      const skillDirs = manifestSkillDirs(install.installPath, warnings);
      if (skillDirs) roots.push({ path: install.installPath, skillDirs, origin: 'plugin', plugin: key, namespace });
      else roots.push({ path: path.join(install.installPath, 'skills'), origin: 'plugin', plugin: key, namespace });
    }
  }
  return roots;
}

// Order is priority: repo, then user, then plugin.
export function catalogRoots({ cwd, home, extraRoots = [], plugins = true, warnings = [] }) {
  return [
    { path: path.join(cwd, '.agents', 'skills'), origin: 'repo' },
    { path: path.join(cwd, '.claude', 'skills'), origin: 'repo' },
    ...extraRoots.map((root) => ({ path: path.resolve(cwd, root), origin: 'repo' })),
    { path: path.join(home, '.claude', 'skills'), origin: 'user' },
    { path: path.join(home, '.agents', 'skills'), origin: 'user' },
    ...(plugins ? pluginRoots(home, warnings) : [])
  ];
}

// A root with skillDirs (from a plugin manifest) uses those folders. Other roots use <path>/*/SKILL.md.
function skillFiles(root) {
  const dirs = root.skillDirs ?? (existsSync(root.path) ? childDirs(root.path) : []);
  return dirs
    .map((dir) => path.join(dir, 'SKILL.md'))
    .filter((file) => existsSync(file))
    .sort();
}

export function catalogHash(skills) {
  const text = skills.map((skill) => `${skill.qualifiedName}\n${skill.description}`).sort().join('\n');
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export function buildCatalog({ cwd = process.cwd(), home = os.homedir(), extraRoots = [], plugins = true } = {}) {
  const warnings = [];
  const roots = catalogRoots({ cwd, home, extraRoots, plugins, warnings });
  const byRealPath = new Map();
  const byQualifiedName = new Map();
  const skills = [];
  for (const root of roots) {
    root.exists = existsSync(root.path);
    for (const file of skillFiles(root)) {
      const realPath = realpathSync(file);
      const known = byRealPath.get(realPath);
      if (known) {
        if (known.path !== file) known.aliases.push(file);
        continue;
      }
      const frontmatter = parseFrontmatter(readFileSync(file, 'utf8'));
      const name = frontmatter.name || path.basename(path.dirname(file));
      const namespace = root.namespace ?? null;
      const qualifiedName = namespace ? `${namespace}:${name}` : name;
      const sameName = byQualifiedName.get(qualifiedName);
      if (sameName) {
        sameName.aliases.push(file);
        byRealPath.set(realPath, sameName);
        continue;
      }
      const description = String(frontmatter.description ?? '');
      const entry = {
        name,
        namespace,
        qualifiedName,
        description,
        triggers: extractTriggers(description),
        invocation: String(frontmatter['disable-model-invocation']).trim() === 'true' ? 'user' : 'model',
        path: file,
        realPath,
        origin: root.origin,
        plugin: root.plugin ?? null,
        aliases: []
      };
      byRealPath.set(realPath, entry);
      byQualifiedName.set(qualifiedName, entry);
      skills.push(entry);
    }
  }
  skills.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  return {
    generatedAt: new Date().toISOString(),
    options: { cwd, home, extraRoots, plugins },
    roots: roots.map((root) => ({
      path: root.path,
      origin: root.origin,
      plugin: root.plugin ?? null,
      exists: root.exists,
      ...(root.skillDirs ? { skillDirs: root.skillDirs } : {})
    })),
    skillCount: skills.length,
    hash: catalogHash(skills),
    warnings,
    skills
  };
}

async function main(argv) {
  const { values } = parseCli(argv, {
    out: { type: 'string' },
    cwd: { type: 'string' },
    home: { type: 'string' },
    root: { type: 'string', multiple: true },
    'no-plugins': { type: 'boolean' }
  });
  if (!values.out) throw new UsageError('--out <file> is required');
  const cwd = path.resolve(values.cwd ?? process.cwd());
  const catalog = buildCatalog({
    cwd,
    home: path.resolve(values.home ?? os.homedir()),
    extraRoots: values.root.map((root) => path.resolve(root)),
    plugins: !values['no-plugins']
  });
  const out = path.resolve(values.out);
  await writeJson(out, catalog);
  emit({ skills: catalog.skillCount, roots: catalog.roots.length, hash: catalog.hash, warnings: catalog.warnings.length, out });
}

if (isMain(import.meta.url)) runMain(main);
