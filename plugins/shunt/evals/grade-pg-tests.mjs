#!/usr/bin/env node
// Usage: node grade-pg-tests.mjs WORKSPACE RESULT_DIR SOURCE_REPO
// WORKSPACE must be an isolated copy. The caller supplies Jest and its config.
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const helperRelative = 'apps/core/src/modules/device-fleet/pg-errors.ts';
const testRelative = 'apps/core/src/modules/device-fleet/pg-errors.spec.ts';
const timeoutMs = 45_000;
const codeComparison = '(e as { code: string }).code === code';
const directRecognition = '  if (hasPgCode(err, "23505")) return true;';
const mutations = [
  { id: 'remove-cause-recognition', from: 'return hasPgCode(err.cause, "23505");', to: 'return false;' },
  { id: 'remove-direct-recognition', from: directRecognition, to: '' },
  { id: 'loose-code-equality', from: codeComparison, to: '(e as { code: string }).code == code' },
  { id: 'accept-any-string-code', from: codeComparison, to: 'typeof (e as { code: string }).code === "string"' },
  { id: 'hardcode-unique-code', from: codeComparison, to: '(e as { code: string }).code === "23505"' },
  {
    id: 'stop-after-direct-code', from: directRecognition,
    to: '  if (typeof err === "object" && err !== null && "code" in err) return hasPgCode(err, "23505");',
  },
];

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveDestination(filename) {
  let ancestor = path.resolve(filename);
  const missing = [];
  while (!existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.resolve(realpathSync(ancestor), ...missing);
}

function prepareArtifact(directory, name) {
  const filename = path.join(directory, name);
  // Remove stale reports and links before starting a new run.
  rmSync(filename, { force: true });
  return filename;
}

function isMatcherFailure(detail) {
  return detail !== null && typeof detail === 'object'
    && detail.matcherResult !== null && typeof detail.matcherResult === 'object'
    && typeof detail.matcherResult.message === 'string';
}

function inspectReport(report, execution, expectedTests) {
  const errors = [];
  const suites = Array.isArray(report.testResults) ? report.testResults : [];
  const assertions = suites.flatMap(suite => Array.isArray(suite.assertionResults) ? suite.assertionResults : []);
  const failed = assertions.filter(assertion => assertion.status === 'failed');
  const assertionFailures = failed.filter(assertion => Array.isArray(assertion.failureDetails)
    && assertion.failureDetails.length > 0 && assertion.failureDetails.every(isMatcherFailure));
  const tests = report.numTotalTests;
  if (!Number.isInteger(tests) || tests <= 0 || assertions.length !== tests) errors.push('No complete, nonempty test result.');
  if (expectedTests !== undefined && tests !== expectedTests) errors.push('Test count changed from the baseline.');
  if (assertions.some(assertion => assertion.status === 'passed'
      && (!Number.isInteger(assertion.numPassingAsserts) || assertion.numPassingAsserts <= 0))) {
    errors.push('Every passing test must execute at least one Jest assertion.');
  }
  if (report.numPendingTests !== 0 || report.numTodoTests !== 0 || report.numPendingTestSuites !== 0
      || assertions.some(assertion => !['passed', 'failed'].includes(assertion.status))) {
    errors.push('Pending, skipped, or todo tests are not allowed.');
  }
  if (suites.length !== 1 || report.numTotalTestSuites !== 1) errors.push('Expected exactly one test suite.');
  if (report.numRuntimeErrorTestSuites !== 0 || report.wasInterrupted === true) errors.push('Jest reported a runtime error or interruption.');
  if (assertionFailures.length !== failed.length) errors.push('A failed test contains a runtime or non-matcher error.');
  if (report.numFailedTests !== failed.length
      || report.numPassedTests !== assertions.filter(assertion => assertion.status === 'passed').length) {
    errors.push('Jest test counts are inconsistent.');
  }
  if (execution.error) errors.push(execution.error);
  if (execution.timedOut) errors.push(`Jest exceeded ${timeoutMs} ms.`);
  if (execution.signal) errors.push(`Jest stopped with signal ${execution.signal}.`);
  if (![0, 1].includes(execution.exitCode)) errors.push(`Unexpected Jest exit code: ${execution.exitCode}.`);
  if ((execution.exitCode === 0) !== (report.success === true)) errors.push('Jest exit code and success flag disagree.');
  if (failed.length === 0 && (report.success !== true || report.numFailedTestSuites !== 0
      || suites.some(suite => suite.status !== 'passed'))) errors.push('The suite failed outside test assertions.');
  return {
    passed: errors.length === 0 && execution.exitCode === 0 && failed.length === 0,
    tests: Number.isInteger(tests) ? tests : 0,
    failedTests: failed.length,
    assertionFailures: assertionFailures.length,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    errors,
  };
}

let activeChild;
let interrupted;
function stopChild() {
  if (!activeChild?.pid) return;
  try {
    // Jest runs in band. Also stop any children created by a test.
    if (process.platform === 'win32') activeChild.kill('SIGKILL');
    else process.kill(-activeChild.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') activeChild.kill('SIGKILL');
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = signal;
    stopChild();
  });
}

async function runJest(workspace, resultDirectory, id, expectedTests) {
  if (interrupted) throw new Error(`Grader interrupted by ${interrupted}.`);
  const reportPath = prepareArtifact(resultDirectory, `${id}.jest.json`);
  const stdoutPath = prepareArtifact(resultDirectory, `${id}.stdout.log`);
  const stderrPath = prepareArtifact(resultDirectory, `${id}.stderr.log`);
  const stdout = openSync(stdoutPath, 'wx');
  const stderr = openSync(stderrPath, 'wx');
  let execution;
  try {
    execution = await new Promise(resolve => {
      let timedOut = false;
      let childError;
      const child = spawn(process.execPath, [
        path.join(workspace, 'node_modules/jest/bin/jest.js'),
        '--config', path.join(workspace, 'jest.config.cjs'),
        '--runInBand', '--no-cache', '--runTestsByPath', path.join(workspace, testRelative),
        '--json', '--outputFile', reportPath,
      ], {
        cwd: workspace, stdio: ['ignore', stdout, stderr],
        detached: process.platform !== 'win32',
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      });
      activeChild = child;
      const timer = setTimeout(() => { timedOut = true; stopChild(); }, timeoutMs);
      child.on('error', error => { childError = error.message; });
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        activeChild = undefined;
        resolve({ exitCode, signal, timedOut, error: childError });
      });
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  let result;
  try {
    result = inspectReport(JSON.parse(readFileSync(reportPath, 'utf8')), execution, expectedTests);
  } catch (error) {
    result = {
      passed: false, tests: 0, failedTests: 0, assertionFailures: 0,
      exitCode: execution.exitCode, timedOut: execution.timedOut,
      errors: [`Cannot read the Jest report: ${error.message}`,
        ...(execution.error ? [execution.error] : []),
        ...(execution.timedOut ? [`Jest exceeded ${timeoutMs} ms.`] : [])],
    };
  }
  return { ...result, logs: { report: reportPath, stdout: stdoutPath, stderr: stderrPath } };
}

const summary = {
  passed: false,
  baseline: { passed: false, tests: 0, status: 'not-run' },
  mutations: mutations.map(({ id }) => ({ id, killed: false, status: 'not-run' })),
  killed: 0,
  total: mutations.length,
  errors: [],
};
let resultDirectory;
let helper;
let original;
try {
  if (process.argv.length !== 5) throw new Error('Usage: node grade-pg-tests.mjs WORKSPACE RESULT_DIR SOURCE_REPO');
  const backend = realpathSync(process.argv[4]);
  if (!statSync(backend).isDirectory()) throw new Error('SOURCE_REPO must be a directory.');
  const workspace = realpathSync(process.argv[2]);
  if (within(backend, workspace)) throw new Error('The workspace must be outside the real backend.');
  helper = realpathSync(path.join(workspace, helperRelative));
  if (!within(workspace, helper) || within(backend, helper)) throw new Error('The helper must be an isolated file inside the workspace.');
  const helperStat = statSync(helper);
  if (!helperStat.isFile() || helperStat.nlink !== 1) throw new Error('The helper must be a regular file without hard links.');
  for (const required of [testRelative, 'jest.config.cjs', 'node_modules/jest/bin/jest.js']) {
    if (!statSync(path.join(workspace, required)).isFile()) throw new Error(`Missing workspace file: ${required}`);
  }
  const destination = resolveDestination(process.argv[3]);
  if (within(backend, destination)) throw new Error('The result directory must be outside the real backend.');
  mkdirSync(destination, { recursive: true });
  resultDirectory = realpathSync(destination);
  if (within(backend, resultDirectory)) {
    resultDirectory = undefined;
    throw new Error('The result directory must be outside the real backend.');
  }
  original = readFileSync(helper);
  const source = original.toString('utf8');
  // Validate all edits before executing or changing the helper.
  const mutatedSources = mutations.map(mutation => {
    const matches = source.split(mutation.from).length - 1;
    if (matches !== 1) throw new Error(`Mutation ${mutation.id} matched ${matches} times; expected exactly one.`);
    return source.replace(mutation.from, mutation.to);
  });
  summary.baseline = await runJest(workspace, resultDirectory, 'baseline');
  if (summary.baseline.passed) {
    for (let index = 0; index < mutations.length; index++) {
      try {
        if (interrupted) throw new Error(`Grader interrupted by ${interrupted}.`);
        writeFileSync(helper, mutatedSources[index]);
        const result = await runJest(workspace, resultDirectory, mutations[index].id, summary.baseline.tests);
        const killed = result.errors.length === 0 && result.exitCode === 1 && result.assertionFailures > 0;
        summary.mutations[index] = {
          id: mutations[index].id, killed,
          status: result.errors.length ? 'error' : killed ? 'killed' : 'survived',
          ...result,
        };
      } finally {
        writeFileSync(helper, original);
      }
    }
  }
} catch (error) {
  summary.errors.push(error.message);
} finally {
  if (original && helper) {
    try { writeFileSync(helper, original); }
    catch (error) { summary.errors.push(`Cannot restore the helper: ${error.message}`); }
  }
}
if (interrupted) summary.errors.push(`Grader interrupted by ${interrupted}.`);
summary.killed = summary.mutations.filter(mutation => mutation.killed).length;
summary.passed = summary.errors.length === 0 && summary.baseline.passed && summary.killed === summary.total;
if (resultDirectory) {
  try {
    const filename = prepareArtifact(resultDirectory, 'result.json');
    writeFileSync(filename, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    summary.passed = false;
    summary.errors.push(`Cannot write result.json: ${error.message}`);
  }
}
console.log(JSON.stringify(summary));
process.exitCode = summary.passed ? 0 : 1;
