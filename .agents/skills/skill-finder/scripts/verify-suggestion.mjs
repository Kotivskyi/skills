#!/usr/bin/env node
// Verify before import: pointers still resolve, the catalog diff is listed,
// and no newly added skill already covers the proposal.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { readJson, readLines, writeJson } from './lib/jsonl.mjs';
import { overlap, round2, skillTokens, tokenize } from './lib/tokens.mjs';
import { buildCatalog } from './index-catalog.mjs';

export const COVERED_OVERLAP = 0.5;
const normalizeSpace = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// The first 40 characters of the quote after whitespace normalization.
// A quote can hold a redaction marker that the raw source does not, so stop there.
export function quotePrefix(quote) {
  const text = normalizeSpace(quote);
  const cut = text.indexOf('[REDACTED');
  return (cut === -1 ? text : text.slice(0, cut)).slice(0, 40).trim();
}

// For a JSONL record: the message text of that one record. For a text file: the line and the next 4.
export async function lineTextAt(file, line, span = 5) {
  if (!file || !existsSync(file) || !Number.isInteger(line) || line < 1) return null;
  const rows = [];
  for await (const row of readLines(file)) {
    if (row.n < line) continue;
    rows.push(row.line);
    if (rows.length >= span) break;
  }
  if (!rows.length) return null;
  let record = null;
  try {
    record = JSON.parse(rows[0]);
  } catch {
    record = null;
  }
  if (record && typeof record === 'object') {
    const content = record.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n');
    return rows[0];
  }
  return rows.join('\n');
}

export function diffCatalogs(before, after) {
  const old = new Map(before.skills.map((skill) => [skill.qualifiedName, skill]));
  const now = new Map(after.skills.map((skill) => [skill.qualifiedName, skill]));
  return {
    added: [...now.keys()].filter((name) => !old.has(name)).sort(),
    removed: [...old.keys()].filter((name) => !now.has(name)).sort(),
    changed: [...now.keys()].filter((name) => old.has(name) && old.get(name).description !== now.get(name).description).sort()
  };
}

export function proposalText(suggestion) {
  const proposal = suggestion.proposal ?? {};
  return proposal.description || proposal.change?.descriptionAfter || proposal.change?.learningsEntry || suggestion.title || '';
}

export async function verifySuggestion(runDir, id) {
  const suggestions = await readJson(path.join(runDir, 'suggestions.json'));
  const catalog = await readJson(path.join(runDir, 'catalog.json'));
  const suggestion = (suggestions.suggestions ?? []).find((entry) => entry.id === id);
  if (!suggestion) throw new UsageError(`no suggestion with id ${id} in ${path.join(runDir, 'suggestions.json')}`);

  const failures = [];
  for (const item of suggestion.evidence ?? []) {
    const pointer = item.pointer ?? null;
    const text = await lineTextAt(pointer?.file, pointer?.line);
    if (text === null) {
      failures.push({ episodeId: item.episodeId ?? null, pointer, reason: 'file or line not found' });
      continue;
    }
    const prefix = quotePrefix(item.quote);
    if (prefix && !normalizeSpace(text).includes(prefix)) {
      failures.push({ episodeId: item.episodeId ?? null, pointer, reason: 'quote not found at pointer' });
    }
  }
  const pointersResolve = { pass: failures.length === 0, checked: (suggestion.evidence ?? []).length, failures };

  let catalogUnchanged;
  let notNewlyCovered;
  if (!catalog.options) {
    catalogUnchanged = { pass: true, changed: null, hashBefore: catalog.hash ?? null, hashAfter: null, diff: null, note: 'catalog.json has no options; the fresh index was skipped' };
    notNewlyCovered = { pass: true, coveredBy: [], note: 'the fresh index was skipped' };
  } else {
    const fresh = buildCatalog(catalog.options);
    const diff = diffCatalogs(catalog, fresh);
    catalogUnchanged = { pass: true, changed: fresh.hash !== catalog.hash, hashBefore: catalog.hash, hashAfter: fresh.hash, diff };
    const probe = tokenize(proposalText(suggestion));
    const coveredBy = fresh.skills
      .filter((skill) => diff.added.includes(skill.qualifiedName))
      .map((skill) => ({ qualifiedName: skill.qualifiedName, overlap: round2(overlap(probe, skillTokens(skill))) }))
      .filter((entry) => entry.overlap >= COVERED_OVERLAP);
    notNewlyCovered = { pass: coveredBy.length === 0, coveredBy };
  }
  const status = pointersResolve.pass && notNewlyCovered.pass ? 'ok' : 'blocked';
  return { id, checkedAt: new Date().toISOString(), status, checks: { pointersResolve, catalogUnchanged, notNewlyCovered } };
}

async function main(argv) {
  const { values } = parseCli(argv, { run: { type: 'string' }, id: { type: 'string' } });
  if (!values.run || !values.id) throw new UsageError('--run <dir> and --id <id> are required');
  const runDir = path.resolve(values.run);
  const result = await verifySuggestion(runDir, values.id);
  await writeJson(path.join(runDir, `verify-${values.id}.json`), result);
  const failed = Object.entries(result.checks).filter(([, check]) => !check.pass).map(([name]) => name);
  emit({ id: values.id, status: result.status, failed });
  if (result.status === 'blocked') process.exitCode = 1;
}

if (isMain(import.meta.url)) runMain(main);
