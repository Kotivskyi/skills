#!/usr/bin/env node
// Run private repository tasks in disposable workspaces.
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const evalDir = path.dirname(fileURLToPath(import.meta.url));
const toolList = 'Read,Write,Edit,Bash,Glob,Grep,Skill';
const runtimeEntries = ['.claude-plugin/plugin.json', '.pi/settings.json', 'scripts', 'skills', 'hooks'];
const workerEnvKeys = ['PI_BIN', 'SHUNT_PI_PROVIDER', 'SHUNT_PI_MODEL', 'SHUNT_PI_THINKING', 'SHUNT_BULK_READER_PROVIDER', 'SHUNT_BULK_READER_MODEL', 'SHUNT_BULK_READER_THINKING', 'SHUNT_CODE_WRITER_PROVIDER', 'SHUNT_CODE_WRITER_MODEL', 'SHUNT_CODE_WRITER_THINKING', 'SHUNT_TIMEOUT_SECONDS', 'SHUNT_MAX_PAYLOAD_BYTES'];
let interrupted;
let stopActiveProcess;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { interrupted = signal; stopActiveProcess?.(); });
}
const jestConfig = `module.exports = {
  rootDir: __dirname,
  roots: ['<rootDir>/apps/core/src/modules/device-fleet'],
  testMatch: ['**/pg-errors.spec.ts'],
  transform: {
    '^.+\\\\.ts$': ['ts-jest', {
      tsconfig: {
        strict: true,
        target: 'ES2022',
        module: 'CommonJS',
        esModuleInterop: true,
        types: ['jest', 'node'],
      },
      diagnostics: { warnOnly: false },
    }],
  },
};
`;

function usage() {
  return 'Usage: node real-world.mjs --repo PATH [--plugin PATH] [--out PATH] [--case ID] [--budget-usd N] [--timeout-seconds N]';
}

function parseArgs(argv) {
  const options = { plugin: path.dirname(evalDir), budgetUsd: 1.5, timeoutSeconds: 300 };
  const names = { '--repo': 'repo', '--plugin': 'plugin', '--out': 'out', '--case': 'caseId', '--budget-usd': 'budgetUsd', '--timeout-seconds': 'timeoutSeconds' };
  const seen = new Set();
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!names[flag]) throw new Error(`Unknown option: ${flag}`);
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    seen.add(flag);
    options[names[flag]] = value;
  }
  if (!options.repo) throw new Error('--repo is required');
  for (const name of ['budgetUsd', 'timeoutSeconds']) {
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name]) || options[name] <= 0) throw new Error(`${name} must be a positive number`);
  }
  if (options.timeoutSeconds * 1000 > 2_147_483_647) throw new Error('timeoutSeconds exceeds the timer limit');
  return options;
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe relative path: ${JSON.stringify(value)}`);
  }
  return value;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function checkedPath(root, relative, allowMissing = false) {
  relativePath(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${current}`);
    } catch (error) {
      if (!(allowMissing && error.code === 'ENOENT')) throw error;
    }
  }
  return current;
}

async function hashFile(filename) {
  return createHash('sha256').update(await fs.readFile(filename)).digest('hex');
}

async function hashInputs(root, files) {
  const hashes = {};
  for (const relative of files) {
    const filename = await checkedPath(root, relative);
    if (!(await fs.stat(filename)).isFile()) throw new Error(`Expected a regular file: ${filename}`);
    hashes[relative] = await hashFile(filename);
  }
  return hashes;
}

async function copyTree(source, destination) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const name of (await fs.readdir(source)).sort()) {
      if (name === 'evals' || name === 'rubrics') continue;
      await copyTree(path.join(source, name), path.join(destination, name));
    }
  } else if (stat.isFile()) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination, 1 /* COPYFILE_EXCL */);
    await fs.chmod(destination, stat.mode & 0o777);
  } else {
    throw new Error(`Unsupported file type: ${source}`);
  }
}

async function filesUnder(root, prefix = '') {
  const files = [];
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = await fs.lstat(path.join(root, relative));
    if (stat.isDirectory()) files.push(...await filesUnder(root, relative));
    else files.push(relative);
  }
  return files;
}

function gitValue(root, args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

async function prepareOutput(requested, protectedRoots) {
  const desired = path.resolve(requested || path.join(os.tmpdir(), 'shunt-real-world-'));
  let ancestor = requested ? desired : path.dirname(desired);
  const missing = [];
  while (true) {
    try { await fs.lstat(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  const resolved = path.join(await fs.realpath(ancestor), ...missing);
  if (protectedRoots.some(root => isWithin(root, resolved))) throw new Error('Output must be outside the source and plugin repositories');
  if (!requested) return fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shunt-real-world-'));
  if (ancestor === desired) {
    const stat = await fs.lstat(desired);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('--out must be a directory, not a symlink');
    if ((await fs.readdir(desired)).length) throw new Error('--out must be empty; existing files will not be overwritten');
  } else {
    await fs.mkdir(resolved, { recursive: true });
  }
  return fs.realpath(resolved);
}

function validateManifest(manifest, caseId) {
  if (!Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.evals) || !manifest.evals.length) throw new Error('Expected files and evals arrays in evals.json');
  const files = manifest.files.map(relativePath);
  if (new Set(files).size !== files.length) throw new Error('Duplicate source paths in evals.json');
  const ids = new Set();
  for (const entry of manifest.evals) {
    if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid or duplicate case ID: ${entry.id}`);
    ids.add(entry.id);
    relativePath(entry.output);
    if (!entry.prompt || typeof entry.prompt !== 'string' || !['review', 'pg-tests'].includes(entry.grader)) throw new Error(`Invalid case: ${entry.id}`);
    if (entry.seed !== undefined && typeof entry.seed !== 'string') throw new Error(`Invalid seed: ${entry.id}`);
    if ([...files, 'jest.config.cjs', 'node_modules'].some(file => file === entry.output || entry.output.startsWith(`${file}/`) || file.startsWith(`${entry.output}/`))) throw new Error(`Output conflicts with an input: ${entry.id}`);
  }
  if (files.some(file => file === 'jest.config.cjs' || file === 'node_modules' || file.startsWith('node_modules/'))) throw new Error('Input conflicts with workspace configuration');
  const selected = manifest.evals.filter(entry => !caseId || entry.id === caseId);
  if (!selected.length) throw new Error(`Unknown case: ${caseId}`);
  return { files, selected };
}

async function runProcess(command, args, cwd, stdoutPath, stderrPath, timeoutSeconds, input) {
  const stdout = await fs.open(stdoutPath, 'wx');
  const stderr = await fs.open(stderrPath, 'wx');
  const started = Date.now();
  try {
    return await new Promise(resolve => {
      let timedOut = false;
      let spawnError = null;
      let killTimer;
      let killDone = Promise.resolve();
      const child = spawn(command, args, { cwd, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', stdout.fd, stderr.fd] });
      const killGroup = signal => {
        if (!child.pid) return;
        try { process.kill(-child.pid, signal); }
        catch (error) { if (error.code !== 'ESRCH') spawnError ||= error.message; }
      };
      const terminate = () => {
        if (killTimer) return;
        killGroup('SIGTERM');
        killDone = new Promise(done => { killTimer = setTimeout(() => { killGroup('SIGKILL'); done(); }, 1000); });
      };
      stopActiveProcess = terminate;
      const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutSeconds * 1000);
      if (interrupted) terminate();
      child.on('error', error => { spawnError = error.message; });
      if (input !== undefined) {
        child.stdin.on('error', error => { if (error.code !== 'EPIPE') spawnError ||= error.message; });
        child.stdin.end(input);
      }
      child.on('close', async (code, signal) => {
        clearTimeout(timer);
        await killDone;
        clearTimeout(killTimer);
        stopActiveProcess = undefined;
        resolve({ exit_code: code, signal, timed_out: timedOut, interrupted: interrupted || null, error: spawnError, elapsed_seconds: (Date.now() - started) / 1000 });
      });
    });
  } finally {
    await stdout.close();
    await stderr.close();
  }
}

async function readClaudeResult(filename) {
  let result = null;
  let malformedLines = 0;
  const lines = createInterface({ input: createReadStream(filename), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'result') result = event;
    } catch { malformedLines += 1; }
  }
  return { result, malformedLines };
}

function casePrompt(entry, workspace) {
  const check = entry.grader === 'pg-tests'
    ? `- The allowed test check is: node node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --runTestsByPath ${entry.output}\n`
    : '- Verify the saved report against the supplied source. This report task does not require a test run.\n';
  return `${entry.prompt}\n\nWorkspace rules:\n- Use ${workspace} as the task workspace.\n- Keep all source and reference files unchanged. Never change source repositories.\n- Write only ${entry.output}. Do not create other workspace files.\n- Preserve any existing content in the output file verbatim.\n- Read task source files only from this workspace.\n- You may read and run the loaded Shunt skills and scripts outside this workspace.\n- Shunt may call its configured model services. This exception also applies to any network restriction in the task.\n- You may use the linked dependencies for the allowed test command.\n- Do not read other external source files, use other network services, install dependencies, or change external files.\n- Keep node_modules and jest.config.cjs unchanged.\n${check}`;
}

async function writeJson(filename, value, exclusive = true) {
  await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: exclusive ? 'wx' : 'w' });
}

async function checkHashes(report, name, root, expected) {
  try {
    const after = await hashInputs(root, Object.keys(expected));
    report.checks[name] = Object.keys(expected).every(file => expected[file] === after[file]);
  } catch (error) { report.checks[name] = false; report.errors.push(error.message); }
  if (!report.checks[name]) report.errors.push(`${name} check failed`);
}

async function runCase(entry, context) {
  const { out, repo, files, inputHashes, plugin, options } = context;
  const resultDir = path.join(out, 'cases', entry.id);
  const workspace = path.join(resultDir, 'WORKSPACE');
  await fs.mkdir(workspace, { recursive: true });
  const report = { id: entry.id, status: 'failed', grader: entry.grader, workspace, output: entry.output, errors: [], checks: {} };
  const started = Date.now();
  try {
    for (const relative of files) await copyTree(await checkedPath(repo, relative), path.join(workspace, relative));
    await fs.symlink(path.join(repo, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
    await fs.writeFile(path.join(workspace, 'jest.config.cjs'), jestConfig, { flag: 'wx' });
    const before = await hashInputs(workspace, [...files, 'jest.config.cjs']);
    if (files.some(file => before[file] !== inputHashes[file])) throw new Error('Source inputs changed before this case started');
    const outputPath = await checkedPath(workspace, entry.output, true);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    if (entry.seed !== undefined) await fs.writeFile(outputPath, entry.seed, { flag: 'wx' });
    const prompt = casePrompt(entry, workspace);
    await fs.writeFile(path.join(resultDir, 'prompt.txt'), prompt, { flag: 'wx' });
    const args = ['-p', '--plugin-dir', plugin, '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--tools', toolList, '--allowedTools', toolList, '--max-budget-usd', String(options.budgetUsd)];
    report.process = await runProcess('claude', args, workspace, path.join(resultDir, 'trace.jsonl'), path.join(resultDir, 'stderr.log'), options.timeoutSeconds, prompt);
    const { result, malformedLines } = await readClaudeResult(path.join(resultDir, 'trace.jsonl'));
    report.claude = result ? { subtype: result.subtype, is_error: result.is_error, errors: result.errors, usage: result.usage, modelUsage: result.modelUsage, total_cost_usd: result.total_cost_usd } : null;
    await fs.writeFile(path.join(resultDir, 'final-answer.txt'), typeof result?.result === 'string' ? result.result : '', { flag: 'wx' });
    if (report.process.error) report.errors.push(report.process.error);
    if (report.process.interrupted) report.errors.push(`Run interrupted by ${report.process.interrupted}`);
    if (report.process.timed_out) report.errors.push('Claude exceeded the time limit; its process group was terminated');
    if (report.process.exit_code !== 0) report.errors.push(`Claude exited with code ${report.process.exit_code}`);
    if (malformedLines) report.errors.push(`Trace has ${malformedLines} non-JSON lines`);
    if (!result || result.subtype !== 'success' || result.is_error !== false) report.errors.push('Claude did not return a successful result');
    for (const [name, root, expected] of [['workspace_inputs_unchanged', workspace, before], ['source_repo_inputs_unchanged', repo, inputHashes]]) {
      await checkHashes(report, name, root, expected);
    }
    const allowed = new Set([...files, 'jest.config.cjs', 'node_modules', entry.output]);
    report.checks.unexpected_files = (await filesUnder(workspace)).filter(file => !allowed.has(file));
    if (report.checks.unexpected_files.length) report.errors.push('Claude created unexpected workspace files');
    const deps = await fs.lstat(path.join(workspace, 'node_modules'));
    report.checks.dependencies_link_unchanged = deps.isSymbolicLink() && await fs.readlink(path.join(workspace, 'node_modules')) === path.join(repo, 'node_modules');
    if (!report.checks.dependencies_link_unchanged) report.errors.push('The node_modules link changed');
    try {
      const safeOutput = await checkedPath(workspace, entry.output);
      if (!(await fs.stat(safeOutput)).isFile()) throw new Error('Output is not a regular file');
      const output = await fs.readFile(safeOutput, 'utf8');
      report.checks.output_nonempty = output.trim().length > 0;
      report.checks.seed_preserved = entry.seed === undefined ? null : output.includes(entry.seed);
      if (!report.checks.output_nonempty) report.errors.push('Output is empty');
      if (report.checks.seed_preserved === false) report.errors.push('The seed block was changed or removed');
      report.output_sha256 = await hashFile(safeOutput);
    } catch (error) { report.checks.output_nonempty = false; report.errors.push(`Output check failed: ${error.message}`); }
    if (!report.errors.length && entry.grader === 'pg-tests') {
      const gradingDir = path.join(resultDir, 'grading');
      await fs.mkdir(gradingDir);
      report.checks.test_grader_passed = false;
      try {
        report.grading = await runProcess(process.execPath, [path.join(evalDir, 'grade-pg-tests.mjs'), workspace, gradingDir, repo], resultDir, path.join(gradingDir, 'stdout.log'), path.join(gradingDir, 'stderr.log'), options.timeoutSeconds);
        report.grading.result_path = path.join(gradingDir, 'result.json');
        const grade = JSON.parse(await fs.readFile(report.grading.result_path, 'utf8'));
        report.grading.result = grade;
        report.checks.test_grader_passed = report.grading.exit_code === 0 && !report.grading.timed_out && !report.grading.interrupted && !report.grading.error && grade.passed === true;
      } catch (error) { report.errors.push(`Grader failed: ${error.message}`); }
      finally {
        await checkHashes(report, 'post_grading_workspace_inputs_unchanged', workspace, before);
        await checkHashes(report, 'post_grading_source_repo_inputs_unchanged', repo, inputHashes);
        await checkHashes(report, 'post_grading_output_unchanged', workspace, { [entry.output]: report.output_sha256 });
        try {
          const output = await fs.readFile(await checkedPath(workspace, entry.output), 'utf8');
          report.checks.post_grading_seed_preserved = entry.seed === undefined ? null : output.includes(entry.seed);
          if (report.checks.post_grading_seed_preserved === false) report.errors.push('Grading changed or removed the seed block');
        } catch (error) { report.checks.post_grading_seed_preserved = false; report.errors.push(error.message); }
        try {
          report.checks.post_grading_unexpected_files = (await filesUnder(workspace)).filter(file => !allowed.has(file));
          if (report.checks.post_grading_unexpected_files.length) report.errors.push('Grading created unexpected workspace files');
        } catch (error) { report.errors.push(`Cannot inspect workspace after grading: ${error.message}`); }
        try {
          const depsAfter = await fs.lstat(path.join(workspace, 'node_modules'));
          report.checks.post_grading_dependencies_link_unchanged = depsAfter.isSymbolicLink() && await fs.readlink(path.join(workspace, 'node_modules')) === path.join(repo, 'node_modules');
          if (!report.checks.post_grading_dependencies_link_unchanged) report.errors.push('Grading changed the node_modules link');
        } catch (error) { report.checks.post_grading_dependencies_link_unchanged = false; report.errors.push(error.message); }
      }
      if (!report.checks.test_grader_passed) report.errors.push('The test grader did not pass');
      if (!report.errors.length) report.status = 'review_required';
    } else if (!report.errors.length) {
      report.status = 'review_required';
    }
  } catch (error) { report.errors.push(error.message); }
  report.elapsed_seconds = (Date.now() - started) / 1000;
  await writeJson(path.join(resultDir, 'summary.json'), report);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (process.platform === 'win32') throw new Error('This runner requires POSIX process groups');
  const repo = await fs.realpath(options.repo);
  const pluginSource = await fs.realpath(options.plugin);
  if (!(await fs.stat(repo)).isDirectory() || !(await fs.stat(pluginSource)).isDirectory()) throw new Error('--repo and --plugin must be directories');
  const manifestPath = path.join(evalDir, 'evals.json');
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const { files, selected } = validateManifest(manifest, options.caseId);
  const inputHashes = await hashInputs(repo, files);
  if (!(await fs.stat(path.join(repo, 'node_modules'))).isDirectory()) throw new Error('The source repository must have installed node_modules');
  for (const entry of runtimeEntries) await checkedPath(pluginSource, entry);
  const protectedRoots = [...new Set([repo, pluginSource, path.dirname(evalDir), gitValue(pluginSource, ['rev-parse', '--show-toplevel']), gitValue(evalDir, ['rev-parse', '--show-toplevel'])].filter(Boolean))];
  const out = await prepareOutput(options.out, protectedRoots);
  const manifestSnapshot = path.join(out, 'evals.json');
  await fs.writeFile(manifestSnapshot, manifestBytes, { flag: 'wx' });
  const plugin = path.join(out, 'plugin');
  await fs.mkdir(plugin);
  for (const entry of runtimeEntries) await copyTree(path.join(pluginSource, entry), path.join(plugin, entry));
  const pi = JSON.parse(await fs.readFile(path.join(plugin, '.pi/settings.json'), 'utf8'));
  const summary = {
    schema_version: 1,
    started_at: new Date().toISOString(),
    status: 'running',
    source_repo: { path: repo, commit: gitValue(repo, ['rev-parse', 'HEAD']) },
    input_hashes: inputHashes,
    evals_manifest: { path: manifestPath, snapshot: manifestSnapshot, sha256: await hashFile(manifestSnapshot) },
    grader: { path: path.join(evalDir, 'grade-pg-tests.mjs'), sha256: await hashFile(path.join(evalDir, 'grade-pg-tests.mjs')) },
    plugin: { source: pluginSource, frozen: plugin, hashes: await hashInputs(plugin, await filesUnder(plugin)), worker_settings: { defaultProvider: pi.defaultProvider, defaultModel: pi.defaultModel, defaultThinkingLevel: pi.defaultThinkingLevel } },
    settings: { budget_usd_per_claude_case: options.budgetUsd, timeout_seconds_per_process: options.timeoutSeconds, case_ids: selected.map(entry => entry.id), tools: toolList, setting_sources: [], strict_mcp_config: true, permission_mode: 'dontAsk' },
    worker_env_overrides: Object.fromEntries(workerEnvKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
    limitations: ['Workspace rules are prompt constraints, not an operating system sandbox.', 'The dependency symlink provides shared access to source repository node_modules.', 'Claude cost and budget cover the parent call; Pi worker cost is not included.', 'All cases require separate trace review; a test grader pass does not grade parent behavior.'],
    cases: [],
  };
  await writeJson(path.join(out, 'summary.json'), summary);
  console.log(`Run output: ${out}`);
  for (const entry of selected) {
    if (interrupted) break;
    console.log(`Running ${entry.id}`);
    const report = await runCase(entry, { out, repo, files, inputHashes, plugin, options });
    summary.cases.push(report);
    await writeJson(path.join(out, 'summary.json'), summary, false);
    console.log(`${entry.id}: ${report.status}`);
  }
  summary.completed_at = new Date().toISOString();
  summary.elapsed_seconds = (Date.parse(summary.completed_at) - Date.parse(summary.started_at)) / 1000;
  summary.interrupted = interrupted || null;
  summary.status = interrupted || summary.cases.some(entry => entry.status === 'failed') ? 'failed' : summary.cases.some(entry => entry.status === 'review_required') ? 'review_required' : 'passed';
  await writeJson(path.join(out, 'summary.json'), summary, false);
  console.log(`Summary: ${path.join(out, 'summary.json')}`);
  if (summary.status === 'failed') process.exitCode = 1;
}

main().catch(error => { console.error(`${error.message}\n${usage()}`); process.exitCode = 2; });
