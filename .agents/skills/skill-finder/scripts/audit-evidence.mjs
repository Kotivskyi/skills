#!/usr/bin/env node
// Audits evidence.jsonl before any judgment. Errors block; warnings go to report limitations.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { readJsonlRecords, writeJson } from './lib/jsonl.mjs';
import { isLowInformationTitle } from './lib/tokens.mjs';

// A new adapter adds its source name here. See references/adapter-contract.md.
export const KNOWN_SOURCES = ['claude-sessions', 'openspec-archive'];
const OUTCOMES = ['completed', 'partial', 'abandoned', 'unknown'];
const HIGH_REDACTION = 20;

const isStr = (value) => typeof value === 'string';
const isStrOrNull = (value) => value === null || typeof value === 'string';
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const arrayOf = (value, check) => Array.isArray(value) && value.every(check);
const textEntry = (entry) => isObj(entry) && isStr(entry.text);
const countEntry = (key) => (entry) => isObj(entry) && isStr(entry[key]) && isNum(entry.count);

const FIELDS = {
  id: isStr,
  source: isStr,
  project: isStrOrNull,
  startedAt: isStrOrNull,
  endedAt: isStrOrNull,
  days: (value) => arrayOf(value, isStr),
  title: isStr,
  intents: (value) => arrayOf(value, textEntry),
  skillsInvoked: (value) => arrayOf(value, countEntry('name')),
  commandsUsed: (value) => arrayOf(value, countEntry('name')),
  toolsUsed: (value) => isObj(value) && Object.values(value).every(isNum),
  commandPatterns: (value) => arrayOf(value, countEntry('pattern')),
  userCorrections: (value) => arrayOf(value, textEntry),
  repeatedInstructions: (value) => arrayOf(value, textEntry),
  artifacts: (value) => arrayOf(value, isStr),
  outcome: (value) => OUTCOMES.includes(value),
  size: (value) => isObj(value) && ['userMessages', 'assistantMessages', 'toolCalls', 'bytes'].every((key) => isNum(value[key])),
  digest: isStrOrNull,
  summary: (value) => value === null || isObj(value),
  redactions: (value) => arrayOf(value, countEntry('kind'))
};

export function validateEpisode(record) {
  if (!isObj(record)) return ['record is not an object'];
  const problems = [];
  for (const [key, check] of Object.entries(FIELDS)) {
    if (!(key in record)) problems.push(`missing ${key}`);
    else if (!check(record[key])) problems.push(`bad ${key}`);
  }
  if (isStr(record.id) && isStr(record.source) && !record.id.startsWith(`${record.source}:`)) {
    problems.push('id does not start with source');
  }
  return problems;
}

export async function auditEvidence(file, { allowSources = [], expectSummaries = false } = {}) {
  const rows = await readJsonlRecords(file);
  const runDir = path.dirname(file);
  const sources = new Set([...KNOWN_SOURCES, ...allowSources]);
  const errors = [];
  const warnings = [];
  const firstLine = new Map();
  for (const row of rows) {
    if (row.error) {
      errors.push({ code: 'malformed_record', line: row.line, id: null, detail: `invalid JSON: ${row.error}` });
      continue;
    }
    const record = row.value;
    const problems = validateEpisode(record);
    if (problems.length) {
      errors.push({ code: 'malformed_record', line: row.line, id: record?.id ?? null, detail: problems.join(', ') });
      continue;
    }
    if (firstLine.has(record.id)) {
      errors.push({ code: 'duplicate_id', line: row.line, id: record.id, detail: `first seen on line ${firstLine.get(record.id)}` });
    } else {
      firstLine.set(record.id, row.line);
    }
    if (!sources.has(record.source)) {
      errors.push({ code: 'unknown_source', line: row.line, id: record.id, detail: record.source });
    }
    const warn = (code, detail) => warnings.push({ code, line: row.line, id: record.id, detail });
    if (!record.intents.length) warn('empty_intents', 'no user-authored text');
    if (isLowInformationTitle(record.title)) warn('low_information_title', record.title || '(empty)');
    if (!record.days.length) warn('missing_days', 'no dates');
    if (!record.digest || !existsSync(path.join(runDir, record.digest))) warn('missing_digest', record.digest ?? '(none)');
    if (expectSummaries && record.summary === null) warn('summary_missing', 'no summary after the backend ran');
    const redactions = record.redactions.reduce((sum, entry) => sum + entry.count, 0);
    if (redactions > HIGH_REDACTION) warn('high_redaction', `${redactions} redactions`);
  }
  const warningCounts = {};
  for (const warning of warnings) warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;
  return {
    evidence: file,
    generatedAt: new Date().toISOString(),
    episodes: rows.length,
    blocking: errors.length > 0,
    errors,
    warnings,
    warningCounts
  };
}

async function main(argv) {
  const { values, positionals } = parseCli(argv, {
    strict: { type: 'boolean' },
    'allow-source': { type: 'string', multiple: true },
    'expect-summaries': { type: 'boolean' },
    out: { type: 'string' }
  });
  if (positionals.length !== 1) throw new UsageError('usage: audit-evidence.mjs <evidence.jsonl> [--strict] [--allow-source <name>]');
  const file = path.resolve(positionals[0]);
  const result = await auditEvidence(file, { allowSources: values['allow-source'], expectSummaries: values['expect-summaries'] });
  await writeJson(path.resolve(values.out ?? path.join(path.dirname(file), 'evidence-audit.json')), result);
  emit({ episodes: result.episodes, errors: result.errors.length, warnings: result.warnings.length, blocking: result.blocking });
  if (values.strict && result.blocking) process.exitCode = 1;
}

if (isMain(import.meta.url)) runMain(main);
