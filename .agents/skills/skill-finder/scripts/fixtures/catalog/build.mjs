// Builds a skill catalog tree at test time. The repo sync script mirrors every
// committed SKILL.md as a skill, so fixture SKILL.md files never live in git.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeSkill(dir, { name, description, extra = '' }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`);
}

const DEPLOY = 'Deploy services to staging. Use when the user asks to deploy the sim runner, wants a staging rollout, or says "ship it to staging".';

// Layout:
//   <root>/project/.agents/skills/deploy-helper   repo skill
//   <root>/project/.claude/skills/deploy-helper   copy with the same name -> alias
//   <root>/project/.agents/skills/manual-only     user-invoked, folded description
//   <root>/home/.claude/skills/notes-keeper       user skill, quoted description
//   <root>/home/.agents/skills/deploy-helper      symlink to the repo skill -> alias
//   <root>/home/.claude/plugins/cache/acme/acme-tools/1.0.0/skills/{release-notes,deploy-helper}
//   <root>/home/.claude/plugins/installed_plugins.json
export function buildCatalogFixture(root) {
  const cwd = path.join(root, 'project');
  const home = path.join(root, 'home');
  const deploy = path.join(cwd, '.agents', 'skills', 'deploy-helper');
  writeSkill(deploy, { name: 'deploy-helper', description: DEPLOY });
  writeSkill(path.join(cwd, '.claude', 'skills', 'deploy-helper'), { name: 'deploy-helper', description: DEPLOY });
  const manual = path.join(cwd, '.agents', 'skills', 'manual-only');
  mkdirSync(manual, { recursive: true });
  writeFileSync(
    path.join(manual, 'SKILL.md'),
    '---\nname: manual-only\ndescription: >\n  Rotate credentials by hand.\n  Use when the user types /manual-only.\ndisable-model-invocation: true\n---\n\n# manual-only\n'
  );
  writeSkill(path.join(home, '.claude', 'skills', 'notes-keeper'), {
    name: 'notes-keeper',
    description: '"Keep meeting notes in docs/notes. Use whenever the user shares meeting notes."'
  });
  mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
  symlinkSync(deploy, path.join(home, '.agents', 'skills', 'deploy-helper'));
  const install = path.join(home, '.claude', 'plugins', 'cache', 'acme', 'acme-tools', '1.0.0');
  writeSkill(path.join(install, 'skills', 'release-notes'), {
    name: 'release-notes',
    description: 'Write release notes from merged PRs. Use when the user asks for release notes or a changelog entry.'
  });
  writeSkill(path.join(install, 'skills', 'deploy-helper'), {
    name: 'deploy-helper',
    description: 'Plugin copy of the deploy helper. Use when the user asks to deploy with acme tools.'
  });
  writeFileSync(
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'acme-tools@acme': [{ scope: 'user', installPath: install, version: '1.0.0' }] } }, null, 2)
  );
  return { cwd, home };
}
