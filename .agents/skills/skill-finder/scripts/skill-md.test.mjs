import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SCRIPTS } from './lib/testing.mjs';
import { parseFrontmatter } from './index-catalog.mjs';

const ROOT = path.resolve(SCRIPTS, '..');
const DESCRIPTION = 'Find which skills to create or fix from real work history. Use when the user asks what skills are missing, wants skill suggestions, asks why a skill did not fire or keeps going wrong, wants to mine Claude Code sessions, OpenSpec archives, or other work history for recurring tasks, or wants evals built from real prompts for a new or existing skill. Reads the sources the user names, ranks suggestions by frequency and cost, and hands off to skill-creator after approval.';

const text = () => readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');

test('frontmatter names the skill, keeps the spec description, and stays model-invoked', () => {
  const frontmatter = parseFrontmatter(text());
  assert.equal(frontmatter.name, 'skill-finder');
  assert.equal(frontmatter.description, DESCRIPTION);
  assert.ok(frontmatter.description.length <= 1024);
  assert.equal('disable-model-invocation' in frontmatter, false);
});

test('every script and reference that SKILL.md names exists', () => {
  const body = text();
  const scripts = [...body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/scripts\/([a-z-]+\.mjs)/g)].map((match) => match[1]);
  const references = [...body.matchAll(/references\/([a-z/-]+\.md)/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 9, `found ${scripts.length} script references`);
  assert.ok(references.length >= 8, `found ${references.length} reference links`);
  for (const name of new Set(scripts)) assert.ok(existsSync(path.join(ROOT, 'scripts', name)), `scripts/${name}`);
  for (const name of new Set(references)) assert.ok(existsSync(path.join(ROOT, 'references', name)), `references/${name}`);
});

test('no committed file other than the skill root is named SKILL.md', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'SKILL.md') found.push(path.relative(ROOT, full));
    }
  };
  walk(ROOT);
  assert.deepEqual(found, ['SKILL.md']);
});
