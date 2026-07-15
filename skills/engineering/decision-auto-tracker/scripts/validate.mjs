#!/usr/bin/env node
// Validate decision-log files in `decisions/log/`.
//
// Importable so a repo precheck script can fold the findings into its central
// report. Also runnable as a CLI for ad-hoc local use.
//
// Checks:
//   - Filename matches YYYY-MM-DD-NN-slug.md
//   - Frontmatter parses and contains required fields
//   - id matches filename prefix
//   - date matches the date portion of id
//   - topic matches the slug portion of filename
//   - status is one of: active | superseded | reversed
//   - tags is a YAML list (possibly empty)
//   - linear (if non-empty) matches a Linear issue id (e.g. PASE-387)
//   - supersedes (if non-empty) is a valid id AND points to an existing file
//     in the log dir
//   - Body has H1 title and the four required `##` sections in the exact order:
//       Decision, Context, Reasoning, Source
//   - None of the four required sections is empty
//
// CLI usage (run from the repo root; <skill-dir> is this skill's directory):
//   node <skill-dir>/scripts/validate.mjs
//   node <skill-dir>/scripts/validate.mjs --log-dir decisions/log
//
// Exit codes (CLI mode):
//   0 on success, 1 on any validation failure, 2 on usage / IO error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_LOG_DIR = "decisions/log";
export const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LINEAR_RE = /^[A-Z][A-Z0-9]*-\d+$/;
export const ALLOWED_STATUSES = new Set(["active", "superseded", "reversed"]);
export const REQUIRED_FRONTMATTER = ["id", "date", "topic", "status", "tags"];
export const REQUIRED_SECTIONS = ["Decision", "Context", "Reasoning", "Source"];

function parseArgs(argv) {
  const args = { logDir: DEFAULT_LOG_DIR };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--log-dir") {
      args.logDir = argv[++i];
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    "Usage: node validate.mjs [--log-dir <path>]\n" +
      "\n" +
      "Validates every *.md file in the log directory.\n" +
      `Default --log-dir is \`${DEFAULT_LOG_DIR}\` relative to the current working directory.`
  );
}

/**
 * Minimal frontmatter parser. Supports the small subset we need:
 *   key: scalar
 *   key: [a, b, c]   (inline YAML list)
 *   key:             (blank — treated as null)
 *
 * Deliberately no YAML dependency so the validator runs in any Node
 * installation in this repo.
 */
export function parseFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    return { ok: false, error: "missing leading `---` frontmatter delimiter" };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { ok: false, error: "missing closing `---` frontmatter delimiter" };
  }
  const body = lines.slice(end + 1).join("\n");
  const data = {};
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const colon = raw.indexOf(":");
    if (colon === -1) {
      return { ok: false, error: `frontmatter line ${i + 1}: no colon: ${JSON.stringify(raw)}` };
    }
    const key = raw.slice(0, colon).trim();
    let value = raw.slice(colon + 1).trim();
    if (value === "") {
      data[key] = null;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (inner === "") {
        data[key] = [];
      } else {
        data[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
    } else {
      data[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { ok: true, data, body };
}

export function extractSections(body) {
  // Returns array of { name, content, line } for every `## Name` header.
  // `content` is the raw text up to the next `##` header (trimmed).
  const lines = body.split("\n");
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (m) headers.push({ name: m[1].trim(), line: i });
  }
  const sections = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].line + 1;
    const end = i + 1 < headers.length ? headers[i + 1].line : lines.length;
    const content = lines.slice(start, end).join("\n").trim();
    sections.push({ name: headers[i].name, content, line: headers[i].line + 1 });
  }
  return sections;
}

export function hasH1(body) {
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    return /^#\s+\S/.test(line);
  }
  return false;
}

function pushFinding(out, file, message) {
  out.push({ severity: "Warning", file, line: 1, message });
}

/**
 * Validate a single decision-log file's content against the format rules.
 * Returns an array of findings (without `file` and `line`).
 */
export function validateContent(filename, content, knownIds) {
  const issues = [];

  const fnMatch = filename.match(FILENAME_RE);
  if (!fnMatch) {
    issues.push(`filename does not match YYYY-MM-DD-NN-slug.md`);
    return issues;
  }
  const [, fnDate, fnSeq, fnSlug] = fnMatch;
  const fnId = `${fnDate}-${fnSeq}`;

  const fm = parseFrontmatter(content);
  if (!fm.ok) {
    issues.push(`frontmatter parse: ${fm.error}`);
    return issues;
  }
  const { data, body } = fm;

  for (const key of REQUIRED_FRONTMATTER) {
    if (!(key in data)) issues.push(`frontmatter: missing required field \`${key}\``);
  }

  if (data.id && data.id !== fnId) {
    issues.push(`frontmatter \`id\` (${data.id}) does not match filename id (${fnId})`);
  }
  if (data.id && !ID_RE.test(data.id)) {
    issues.push(`frontmatter \`id\` is not YYYY-MM-DD-NN format: ${data.id}`);
  }
  if (data.date && !DATE_RE.test(data.date)) {
    issues.push(`frontmatter \`date\` is not YYYY-MM-DD format: ${data.date}`);
  }
  if (data.date && data.id && data.id.slice(0, 10) !== data.date) {
    issues.push(
      `frontmatter \`date\` (${data.date}) does not match date portion of \`id\` (${data.id.slice(0, 10)})`
    );
  }
  if (data.topic && !SLUG_RE.test(data.topic)) {
    issues.push(`frontmatter \`topic\` is not a kebab-case slug: ${data.topic}`);
  }
  if (data.topic && data.topic !== fnSlug) {
    issues.push(`frontmatter \`topic\` (${data.topic}) does not match filename slug (${fnSlug})`);
  }
  if (data.status && !ALLOWED_STATUSES.has(data.status)) {
    issues.push(
      `frontmatter \`status\` is not one of ${[...ALLOWED_STATUSES].join("|")}: ${data.status}`
    );
  }
  if ("tags" in data) {
    if (!Array.isArray(data.tags)) {
      issues.push(`frontmatter \`tags\` must be a YAML list (use \`tags: []\` for empty)`);
    } else {
      for (const t of data.tags) {
        if (!SLUG_RE.test(t)) issues.push(`frontmatter \`tags\` entry is not kebab-case: ${t}`);
      }
    }
  }
  if (data.linear && !LINEAR_RE.test(data.linear)) {
    issues.push(`frontmatter \`linear\` is not a Linear issue id (e.g. ABC-123): ${data.linear}`);
  }
  if (data.supersedes) {
    if (!ID_RE.test(data.supersedes)) {
      issues.push(`frontmatter \`supersedes\` is not a valid id: ${data.supersedes}`);
    } else if (knownIds && !knownIds.has(data.supersedes)) {
      issues.push(
        `frontmatter \`supersedes\` points to id ${data.supersedes} but no matching file exists in the log dir`
      );
    }
  }

  if (!hasH1(body)) {
    issues.push(`body: missing H1 title (first non-blank line must start with \`# \`)`);
  }
  const sections = extractSections(body);
  const sectionNames = sections.map((s) => s.name);
  for (let i = 0; i < REQUIRED_SECTIONS.length; i++) {
    if (sectionNames[i] !== REQUIRED_SECTIONS[i]) {
      issues.push(
        `body: section #${i + 1} must be \`## ${REQUIRED_SECTIONS[i]}\`, got \`## ${
          sectionNames[i] ?? "(missing)"
        }\``
      );
    }
  }
  for (let i = 0; i < Math.min(sections.length, REQUIRED_SECTIONS.length); i++) {
    if (sections[i].content === "") {
      issues.push(`body: section \`## ${sections[i].name}\` is empty`);
    }
  }

  return issues;
}

/**
 * Precheck-compatible entry point.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the repo root.
 * @param {string[]} opts.allFiles - all repo-relative file paths the precheck knows about.
 * @param {(relPath: string) => string|null} opts.readFile - reader honouring precheck's ignore rules.
 * @param {string} [opts.logDir] - log directory, repo-relative. Defaults to `decisions/log`.
 * @returns {Array<{severity: 'Warning'|'Blocking', file: string, line: number, message: string}>}
 */
export function validateDecisionLog({ repoRoot, allFiles, readFile, logDir = DEFAULT_LOG_DIR }) {
  const findings = [];
  if (!repoRoot) return findings;

  const logDirAbs = path.resolve(repoRoot, logDir);
  if (!fs.existsSync(logDirAbs)) return findings;
  if (!fs.statSync(logDirAbs).isDirectory()) return findings;

  // Source of truth for "files in the log dir" is the filesystem here, not the
  // caller's allFiles list — precheck may pass us a filtered set.
  const files = fs
    .readdirSync(logDirAbs)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const knownIds = new Set();
  for (const f of files) {
    const m = f.match(FILENAME_RE);
    if (m) knownIds.add(`${m[1]}-${m[2]}`);
  }

  for (const filename of files) {
    const repoRel = path.posix.join(logDir.replaceAll(path.sep, "/"), filename);
    let content;
    if (typeof readFile === "function") {
      content = readFile(repoRel);
    }
    if (content == null) {
      content = fs.readFileSync(path.join(logDirAbs, filename), "utf8");
    }
    const issues = validateContent(filename, content, knownIds);
    for (const msg of issues) {
      pushFinding(findings, repoRel, msg);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cliMain() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const repoRoot = process.cwd();
  const logDirAbs = path.resolve(repoRoot, args.logDir);
  if (!fs.existsSync(logDirAbs)) {
    console.log(`decision-auto-tracker: ${args.logDir} does not exist yet — nothing to validate.`);
    process.exit(0);
  }
  if (!fs.statSync(logDirAbs).isDirectory()) {
    console.error(`decision-auto-tracker: ${args.logDir} is not a directory`);
    process.exit(2);
  }

  const findings = validateDecisionLog({
    repoRoot,
    allFiles: [],
    readFile: () => null,
    logDir: args.logDir
  });

  const filesScanned = fs
    .readdirSync(logDirAbs)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f.message);
  }

  for (const filename of filesScanned) {
    const repoRel = path.posix.join(args.logDir.replaceAll(path.sep, "/"), filename);
    const msgs = byFile.get(repoRel) || [];
    if (msgs.length === 0) {
      console.log(`✓ ${repoRel}`);
    } else {
      console.error(`✗ ${repoRel}`);
      for (const m of msgs) console.error(`    ${m}`);
    }
  }

  if (filesScanned.length === 0) {
    console.log(`decision-auto-tracker: ${args.logDir} is empty — nothing to validate.`);
    process.exit(0);
  }
  if (findings.length > 0) {
    console.error(`\n${findings.length} error(s) across ${filesScanned.length} file(s).`);
    process.exit(1);
  }
  console.log(`\nAll ${filesScanned.length} decision file(s) valid.`);
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  cliMain();
}
