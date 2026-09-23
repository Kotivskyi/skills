import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runScript, tmpDir } from './lib/testing.mjs';
import { buildCatalogFixture, writeSkill } from './fixtures/catalog/build.mjs';
import { buildCatalog, extractTriggers, parseFrontmatter } from './index-catalog.mjs';

function indexFixture(extra = []) {
  const root = tmpDir();
  const { cwd, home } = buildCatalogFixture(root);
  const out = path.join(root, 'catalog.json');
  const result = runScript('index-catalog.mjs', ['--cwd', cwd, '--home', home, '--out', out, ...extra]);
  assert.equal(result.status, 0, result.stderr);
  return { root, cwd, home, result, catalog: JSON.parse(readFileSync(out, 'utf8')) };
}

const byName = (catalog, qualifiedName) => catalog.skills.find((skill) => skill.qualifiedName === qualifiedName);

test('dedups by real path and by qualified name, keeping the higher-priority origin', () => {
  const { catalog, cwd, home, result } = indexFixture();
  assert.deepEqual(catalog.skills.map((skill) => skill.qualifiedName), [
    'acme-tools:deploy-helper',
    'acme-tools:release-notes',
    'deploy-helper',
    'manual-only',
    'notes-keeper'
  ]);
  assert.equal(result.summary.skills, 5);
  const deploy = byName(catalog, 'deploy-helper');
  assert.equal(deploy.origin, 'repo');
  assert.equal(deploy.path, path.join(cwd, '.agents', 'skills', 'deploy-helper', 'SKILL.md'));
  assert.deepEqual(deploy.aliases, [
    path.join(cwd, '.claude', 'skills', 'deploy-helper', 'SKILL.md'),
    path.join(home, '.agents', 'skills', 'deploy-helper', 'SKILL.md')
  ]);
  assert.equal(byName(catalog, 'notes-keeper').origin, 'user');
  assert.equal(byName(catalog, 'notes-keeper').description, 'Keep meeting notes in docs/notes. Use whenever the user shares meeting notes.');
});

test('plugin skills get a namespace and a plugin key', () => {
  const { catalog } = indexFixture();
  const notes = byName(catalog, 'acme-tools:release-notes');
  assert.equal(notes.namespace, 'acme-tools');
  assert.equal(notes.name, 'release-notes');
  assert.equal(notes.origin, 'plugin');
  assert.equal(notes.plugin, 'acme-tools@acme');
});

test('invocation comes from disable-model-invocation and folded descriptions parse', () => {
  const { catalog } = indexFixture();
  const manual = byName(catalog, 'manual-only');
  assert.equal(manual.invocation, 'user');
  assert.equal(manual.description, 'Rotate credentials by hand. Use when the user types /manual-only.');
  assert.equal(byName(catalog, 'deploy-helper').invocation, 'model');
});

test('trigger phrases come from "use when" clauses and quotes', () => {
  const { catalog } = indexFixture();
  const triggers = byName(catalog, 'deploy-helper').triggers;
  for (const phrase of ['ship it to staging', 'asks to deploy the sim runner', 'wants a staging rollout']) {
    assert.ok(triggers.includes(phrase), `${phrase} in ${JSON.stringify(triggers)}`);
  }
  assert.equal(triggers.some((phrase) => phrase.includes('deploy services')), false);
});

test('--no-plugins drops plugin skills and --root adds a repo root', () => {
  const root = tmpDir();
  const { cwd, home } = buildCatalogFixture(root);
  writeSkill(path.join(root, 'extra', 'extra-skill'), { name: 'extra-skill', description: 'Extra. Use when the user asks for extra help.' });
  const out = path.join(root, 'catalog.json');
  const result = runScript('index-catalog.mjs', ['--cwd', cwd, '--home', home, '--out', out, '--no-plugins', '--root', path.join(root, 'extra')]);
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(catalog.skills.some((skill) => skill.origin === 'plugin'), false);
  assert.equal(byName(catalog, 'extra-skill').origin, 'repo');
  assert.deepEqual(catalog.options.extraRoots, [path.join(root, 'extra')]);
  assert.equal(catalog.options.plugins, false);
});

test('the hash is stable and changes when a description changes', () => {
  const root = tmpDir();
  const { cwd, home } = buildCatalogFixture(root);
  const first = buildCatalog({ cwd, home });
  const second = buildCatalog({ cwd, home });
  assert.equal(first.hash, second.hash);
  assert.match(first.hash, /^sha256:[0-9a-f]{64}$/);
  writeFileSync(path.join(cwd, '.agents', 'skills', 'manual-only', 'SKILL.md'), '---\nname: manual-only\ndescription: Changed.\n---\n');
  assert.notEqual(buildCatalog({ cwd, home }).hash, first.hash);
});

test('missing roots are recorded and skipped', () => {
  const root = tmpDir();
  const catalog = buildCatalog({ cwd: path.join(root, 'empty'), home: path.join(root, 'nohome') });
  assert.equal(catalog.skillCount, 0);
  assert.ok(catalog.roots.every((entry) => entry.exists === false));
});

test('a missing --out exits 1', () => {
  assert.equal(runScript('index-catalog.mjs', ['--cwd', tmpDir()]).status, 1);
});

test('parseFrontmatter reads plain, quoted, and block values', () => {
  const text = "---\nname: a\ndescription: 'It''s here'\nlist: |\n  one\n  two\nflag: true\n---\nbody";
  assert.deepEqual(parseFrontmatter(text), { name: 'a', description: "It's here", list: 'one\ntwo', flag: 'true' });
  assert.deepEqual(parseFrontmatter('no frontmatter'), {});
});

test('extractTriggers splits clauses and keeps 2 to 12 words', () => {
  const triggers = extractTriggers('Review code. Use this when the user asks for a review, wants feedback; or pastes a diff. Trigger on "lgtm?".');
  assert.deepEqual(triggers, ['asks for a review', 'wants feedback', 'pastes a diff']);
});

// A home with installed plugins only. installs maps a plugin key to { skills, manifest }.
function pluginHome(installs, { raw } = {}) {
  const root = tmpDir();
  const home = path.join(root, 'home');
  const plugins = {};
  for (const [key, { skills, manifest }] of Object.entries(installs)) {
    const installPath = path.join(home, '.claude', 'plugins', 'cache', 'acme', key.split('@')[0], '1.0.0');
    for (const rel of skills) {
      const name = path.basename(rel);
      writeSkill(path.join(installPath, rel), { name, description: `The ${name} skill. Use when the user asks for ${name} work.` });
    }
    if (manifest !== undefined) {
      mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
      writeFileSync(path.join(installPath, '.claude-plugin', 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    }
    plugins[key] = [{ scope: 'user', installPath, version: '1.0.0' }];
  }
  mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), raw ?? JSON.stringify({ version: 2, plugins }));
  const out = path.join(root, 'catalog.json');
  const result = runScript('index-catalog.mjs', ['--cwd', path.join(root, 'project'), '--home', home, '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  return { result, catalog: JSON.parse(readFileSync(out, 'utf8')) };
}

test('plugin skills come from the manifest skills list, or from skills/ when it lists none', () => {
  const { catalog, result } = pluginHome({
    'alpha-tools@acme': { skills: ['skills/engineering/alpha'], manifest: { name: 'alpha-tools', skills: ['./skills/engineering/alpha'] } },
    'beta-tools@acme': { skills: ['skills/beta'] }
  });
  assert.deepEqual(catalog.skills.map((skill) => [skill.qualifiedName, skill.origin]), [
    ['alpha-tools:alpha', 'plugin'],
    ['beta-tools:beta', 'plugin']
  ]);
  assert.deepEqual(catalog.warnings, []);
  assert.equal(result.summary.warnings, 0);
});

test('a manifest skills list adds to the skills/ scan and never drops a default skill', () => {
  const { catalog } = pluginHome({
    'delta-tools@acme': {
      skills: ['skills/main-tool', 'extras/legacy-tool'],
      manifest: { name: 'delta-tools', skills: ['./extras/legacy-tool'] }
    },
    'omega-tools@acme': {
      skills: ['skills/core-tool', 'extras/side-tool'],
      manifest: { name: 'omega-tools', skills: ['./extras/side-tool', './skills/core-tool'] }
    }
  });
  assert.deepEqual(catalog.skills.map((skill) => skill.qualifiedName), [
    'delta-tools:legacy-tool',
    'delta-tools:main-tool',
    'omega-tools:core-tool',
    'omega-tools:side-tool'
  ]);
  assert.ok(catalog.skills.every((skill) => skill.aliases.length === 0));
});

test('a malformed installed_plugins.json gives no plugin skills and one warning', () => {
  const { catalog, result } = pluginHome({ 'beta-tools@acme': { skills: ['skills/beta'] } }, { raw: '{ not json' });
  assert.equal(catalog.skills.filter((skill) => skill.origin === 'plugin').length, 0);
  assert.equal(catalog.warnings.length, 1);
  assert.match(catalog.warnings[0], /installed_plugins\.json/);
  assert.equal(result.summary.warnings, 1);
});

test('a malformed plugin.json gives one warning and falls back to skills/', () => {
  const { catalog, result } = pluginHome({ 'gamma-tools@acme': { skills: ['skills/gamma'], manifest: '{ not json' } });
  assert.deepEqual(catalog.skills.map((skill) => skill.qualifiedName), ['gamma-tools:gamma']);
  assert.equal(catalog.warnings.length, 1);
  assert.match(catalog.warnings[0], /plugin\.json/);
  assert.equal(result.summary.warnings, 1);
});
