#!/usr/bin/env node
// Build a mechanical audit manifest for `decisions/log/`.
//
// One JSON object per entry (JSONL on stdout) with the parsed frontmatter, size
// metrics, and the mechanical quality flags defined in references/triage-rubric.md:
//
//   long-slug          slug has more than config.maxSlugWords words
//   id-collision       another file in the log shares the same YYYY-MM-DD-NN id
//   decision-too-long  `## Decision` has more than config.maxDecisionSentences sentences
//   undated-source     `## Source` has no YYYY-MM-DD date
//   hook-sourced       `## Source` cites a hook, gate, linter or CI rather than the user
//   ticket-in-slug     slug contains an issue-tracker id such as abc-123
//   validator-error    validate.mjs reports at least one error for the file
//
// The semantic pass (category, verdict) is done by a reviewer with the rubric and
// merged on `file`. This script never modifies anything.
//
// CLI usage (run from the repo root; <skill-dir> is this skill's directory):
//   node <skill-dir>/scripts/audit-manifest.mjs [--log-dir decisions/log] [--config <path>] [--repo <label>] [--summary]
//
// Exit codes: 0 on success, 2 on usage / IO error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOG_DIR,
  FILENAME_RE,
  parseFrontmatter,
  extractSections,
  countSentences,
  loadConfig,
  validateDecisionLog,
} from "./validate.mjs";

export const HOOK_SOURCE_RE =
  /\b(stop[- ]?hook|stop[- ]?gate|pre-?commit|linter|lint check|ci (run|job|check)|hook feedback|gate feedback|skill text|skill instructions)\b/i;
export const TICKET_IN_SLUG_RE = /(^|-)[a-z]{2,10}-\d{1,6}(-|$)/;
export const DATE_IN_TEXT_RE = /\b\d{4}-\d{2}-\d{2}\b/;

function parseArgs(argv) {
  const args = { logDir: DEFAULT_LOG_DIR, configPath: null, repo: null, summary: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--log-dir") args.logDir = argv[++i];
    else if (a === "--config") args.configPath = argv[++i];
    else if (a === "--repo") args.repo = argv[++i];
    else if (a === "--summary") args.summary = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    "Usage: node audit-manifest.mjs [--log-dir <path>] [--config <path>] [--repo <label>] [--summary]\n" +
      "\n" +
      "Prints one JSON object per decision-log file (JSONL) with mechanical quality flags.\n" +
      "--repo adds a label to every row so manifests from several repos can be merged.\n" +
      "--summary also prints flag counts to stderr.\n" +
      `Default --log-dir is \`${DEFAULT_LOG_DIR}\` relative to the current working directory.`
  );
}

function firstH1(body) {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : null;
}

/**
 * Build the manifest rows for every *.md in `logDirAbs`.
 * Returns { rows, counts } where counts is a flag → number map.
 */
export function buildManifest(logDirAbs, { repo = null, configPath = null } = {}) {
  const loaded = loadConfig(logDirAbs, configPath);
  if (loaded.error) throw new Error(loaded.error);
  const config = loaded.config;

  const files = fs.readdirSync(logDirAbs).filter((f) => f.endsWith(".md")).sort();

  const idOwners = new Map();
  for (const f of files) {
    const m = f.match(FILENAME_RE);
    if (!m) continue;
    const id = `${m[1]}-${m[2]}`;
    if (!idOwners.has(id)) idOwners.set(id, []);
    idOwners.get(id).push(f);
  }

  // Run the validator once over the whole log so graph checks apply; key by basename.
  const findings = validateDecisionLog({ repoRoot: logDirAbs, allFiles: [], readFile: () => null, logDir: ".", configPath });
  const issuesByFile = new Map();
  for (const fi of findings) {
    const key = path.posix.basename(fi.file);
    if (!issuesByFile.has(key)) issuesByFile.set(key, []);
    issuesByFile.get(key).push({ level: fi.level, message: fi.message });
  }

  const rows = [];
  const counts = {};
  const bump = (flag) => (counts[flag] = (counts[flag] || 0) + 1);

  for (const f of files) {
    const content = fs.readFileSync(path.join(logDirAbs, f), "utf8");
    const fm = parseFrontmatter(content);
    const data = fm.ok ? fm.data : {};
    const body = fm.ok ? fm.body : content;
    const sections = extractSections(body);
    const section = (name) => sections.find((s) => s.name === name)?.content ?? "";

    const m = f.match(FILENAME_RE);
    const date = m ? m[1] : null;
    const seq = m ? m[2] : null;
    const slug = m ? m[3] : f.replace(/\.md$/, "");
    const id = m ? `${date}-${seq}` : null;
    const slugWords = slug.split("-").filter(Boolean).length;
    const decision = section("Decision");
    const source = section("Source");
    const decisionSentences = countSentences(decision);
    const validatorIssues = issuesByFile.get(f) || [];

    const flags = [];
    if (slugWords > config.maxSlugWords) flags.push("long-slug");
    if (id && idOwners.get(id).length > 1) flags.push("id-collision");
    if (decisionSentences > config.maxDecisionSentences) flags.push("decision-too-long");
    if (!DATE_IN_TEXT_RE.test(source)) flags.push("undated-source");
    if (HOOK_SOURCE_RE.test(source)) flags.push("hook-sourced");
    if (TICKET_IN_SLUG_RE.test(slug)) flags.push("ticket-in-slug");
    if (validatorIssues.some((i) => i.level === "error")) flags.push("validator-error");
    for (const fl of flags) bump(fl);

    rows.push({
      repo,
      file: f,
      id,
      date,
      seq,
      slug,
      slug_words: slugWords,
      title: firstH1(body),
      tags: Array.isArray(data.tags) ? data.tags : [],
      bucket: data.bucket ?? null,
      status: data.status ?? null,
      linear: data.linear ?? null,
      supersedes: data.supersedes ?? null,
      decision_sentences: decisionSentences,
      decision_chars: decision.length,
      body_chars: body.length,
      source_excerpt: source.replace(/\s+/g, " ").slice(0, 160),
      id_collision_with: id ? idOwners.get(id).filter((o) => o !== f) : [],
      validator_issues: validatorIssues,
      flags,
    });
  }

  return { rows, counts, config, configPath: loaded.path };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const logDirAbs = path.resolve(process.cwd(), args.logDir);
  if (!fs.existsSync(logDirAbs) || !fs.statSync(logDirAbs).isDirectory()) {
    console.error(`Log directory not found: ${logDirAbs}`);
    process.exit(2);
  }
  let result;
  try {
    result = buildManifest(logDirAbs, { repo: args.repo, configPath: args.configPath ? path.resolve(args.configPath) : null });
  } catch (e) {
    console.error(`audit-manifest: ${e.message}`);
    process.exit(2);
  }
  for (const row of result.rows) process.stdout.write(`${JSON.stringify(row)}\n`);
  if (args.summary) {
    console.error(`${result.rows.length} file(s) in ${args.logDir} (config: ${result.configPath ? path.relative(process.cwd(), result.configPath) : "defaults"})`);
    for (const [flag, n] of Object.entries(result.counts).sort((a, b) => b[1] - a[1])) {
      console.error(`  ${String(n).padStart(4)}  ${flag}`);
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
