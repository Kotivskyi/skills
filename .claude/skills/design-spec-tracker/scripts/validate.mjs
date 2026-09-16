#!/usr/bin/env node
// Validate design-spec files in `design-specs/`.
//
// Importable so a repo precheck script can fold the findings into its central
// report. Also runnable as a CLI for ad-hoc local use.
//
// Checks (level Blocking fails the run; level Warning is reported only):
//   Blocking  Filename matches kebab-case.md
//   Blocking  Frontmatter parses and contains required fields
//   Blocking  feature matches filename slug; status and updated are valid
//   Blocking  Body has the required H1 and eleven sections in exact order
//   Blocking  Sections, Open Questions, and Changelog follow the spec format
//   Blocking  ready-for-dev specs do not contain uncovered primary sections
//   Warning   ready-for-dev specs retain open questions or proposed content
//
// CLI usage (run from the repo root; <skill-dir> is this skill's directory):
//   node <skill-dir>/scripts/validate.mjs
//   node <skill-dir>/scripts/validate.mjs --spec-dir design-specs --summary
//
// Exit codes (CLI mode):
//   0 on success (warnings allowed), 1 on any Blocking finding, 2 on usage / IO error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_SPEC_DIR = "design-specs";
export const FILENAME_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ALLOWED_STATUSES = new Set(["draft", "ready-for-dev", "handed-off"]);
export const REQUIRED_FRONTMATTER = ["feature", "title", "status", "figma", "ticket", "updated"];
export const REQUIRED_SECTIONS = [
  "Overview",
  "Layout",
  "Design Tokens Used",
  "Components",
  "States and Interactions",
  "Responsive Behavior",
  "Edge Cases",
  "Animation / Motion",
  "Accessibility Notes",
  "Open Questions",
  "Changelog",
];
export const PLACEHOLDER = "_Not covered yet._";
export const NONE = "_None._";
export const PROPOSED_RE = /\[proposed\]/g;

function parseArgs(argv) {
  const args = { specDir: DEFAULT_SPEC_DIR, summary: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--spec-dir") {
      const value = argv[++i];
      if (!value) throw new Error("missing value for --spec-dir");
      args.specDir = value;
    } else if (a === "--summary") {
      args.summary = true;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    "Usage: node validate.mjs [--spec-dir <path>] [--summary]\n" +
      "\n" +
      "Validates every *.md file in the design spec directory.\n" +
      `Default --spec-dir is \`${DEFAULT_SPEC_DIR}\` relative to the current working directory.`
  );
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Minimal frontmatter parser. Supports the small subset we need:
 *   key: scalar
 *   key: [a, b, c]   (inline YAML list)
 *   key:             (blank — treated as null)
 *
 * Deliberately no YAML dependency so the validator runs in any Node
 * installation. Block lists (`- item` lines) are NOT supported.
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
      data[key] = inner === "" ? [] : inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
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

function emptyStats() {
  return {
    feature: null,
    title: null,
    status: null,
    updated: null,
    covered: 0,
    notCovered: [],
    openQuestions: 0,
    proposed: 0,
    changelog: 0,
  };
}

function firstNonBlankLine(body) {
  return body.split("\n").find((line) => line.trim() !== "") || "";
}

// ---------------------------------------------------------------------------
// Per-file validation
// ---------------------------------------------------------------------------

/**
 * Validate a single design-spec file's content against the format rules.
 *
 * Returns { errors, warnings, stats }, where stats support summary reporting.
 */
export function validateContent(filename, content) {
  const errors = [];
  const warnings = [];
  const stats = emptyStats();
  const error = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  const fnMatch = filename.match(FILENAME_RE);
  if (!fnMatch) {
    error("filename does not match kebab-case slug.md");
    return { errors, warnings, stats };
  }
  const fnSlug = fnMatch[1];

  const fm = parseFrontmatter(content);
  if (!fm.ok) {
    error(`frontmatter parse: ${fm.error}`);
    return { errors, warnings, stats };
  }

  const { data, body } = fm;
  stats.feature = data.feature ?? null;
  stats.title = data.title ?? null;
  stats.status = data.status ?? null;
  stats.updated = data.updated ?? null;

  for (const key of REQUIRED_FRONTMATTER) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      error(`frontmatter: missing required field \`${key}\``);
    }
  }

  if (data.feature !== fnSlug) {
    error(`frontmatter \`feature\` (${data.feature}) does not match filename slug (${fnSlug})`);
  }
  if (!ALLOWED_STATUSES.has(data.status)) {
    error(`frontmatter \`status\` is not one of ${[...ALLOWED_STATUSES].join("|")}: ${data.status}`);
  }
  if (!DATE_RE.test(data.updated || "")) {
    error(`frontmatter \`updated\` is not YYYY-MM-DD format: ${data.updated}`);
  }

  const firstLine = firstNonBlankLine(body);
  if (!hasH1(body)) {
    error("body: missing H1 title (first non-blank line must start with `# `)");
  } else if (!firstLine.startsWith("# Handoff Spec: ")) {
    error("body: H1 title must start with `# Handoff Spec: `");
  }

  const sections = extractSections(body);

  // Count [proposed] only inside the nine handoff sections; a mention inside

  // Open Questions refers to the same item and must not double-count it.

  const handoffSections = new Set(REQUIRED_SECTIONS.slice(0, 9));

  stats.proposed = sections

    .filter((s) => handoffSections.has(s.name))

    .reduce((n, s) => n + (s.content.match(PROPOSED_RE) || []).length, 0);
  for (let i = 0; i < REQUIRED_SECTIONS.length; i++) {
    const expected = REQUIRED_SECTIONS[i];
    const actual = sections[i];
    if (!actual) {
      error(`body: section #${i + 1} must be \`## ${expected}\`, got \`## (missing)\``);
    } else if (actual.name !== expected) {
      error(`body: section #${i + 1} must be \`## ${expected}\`, got \`## ${actual.name}\``);
    }
  }
  for (let i = REQUIRED_SECTIONS.length; i < sections.length; i++) {
    error(`body: unexpected extra section \`## ${sections[i].name}\``);
  }
  for (const section of sections) {
    if (section.content === "") error(`body: section \`## ${section.name}\` is empty`);
  }

  const sectionsByName = new Map();
  for (const section of sections) {
    if (!sectionsByName.has(section.name)) sectionsByName.set(section.name, section);
  }

  for (const name of REQUIRED_SECTIONS.slice(0, 9)) {
    const section = sectionsByName.get(name);
    if (section && section.content !== PLACEHOLDER) {
      stats.covered++;
    } else {
      stats.notCovered.push(name);
    }
  }

  const openQuestions = sectionsByName.get("Open Questions");
  if (openQuestions) {
    if (openQuestions.content !== NONE) {
      for (const line of openQuestions.content.split("\n")) {
        if (line.trim() === "") continue;
        if (/^- \[x\]/i.test(line)) {
          error("answered questions must be removed, not checked off");
        } else if (!/^- \[ \] \S/.test(line)) {
          error("body: Open Questions lines must match `- [ ] <question>` or be exactly `_None._`");
        }
      }
      stats.openQuestions = openQuestions.content.split("\n").filter((line) => /^- \[ \]/.test(line)).length;
    }
  }

  const changelog = sectionsByName.get("Changelog");
  if (changelog) {
    const lines = changelog.content.split("\n").filter((line) => line.trim() !== "");
    stats.changelog = lines.length;
    if (lines.length === 0) {
      error("body: Changelog has zero lines");
    }
    for (const line of lines) {
      if (!/^- \d{4}-\d{2}-\d{2}: \S/.test(line)) {
        error("body: Changelog lines must match `- YYYY-MM-DD: <what changed>`");
      }
    }
  }

  if (data.status === "ready-for-dev") {
    const uncovered = REQUIRED_SECTIONS.slice(0, 9).filter((name) => sectionsByName.get(name)?.content === PLACEHOLDER);
    if (uncovered.length > 0) {
      error(`status \`ready-for-dev\` cannot contain \`${PLACEHOLDER}\` in: ${uncovered.join(", ")}`);
    }
    if (stats.openQuestions > 0) {
      warn(`status \`ready-for-dev\` has ${stats.openQuestions} open question(s)`);
    }
    if (stats.proposed > 0) {
      warn(`status \`ready-for-dev\` has ${stats.proposed} proposed item(s)`);
    }
  }

  return { errors, warnings, stats };
}

// ---------------------------------------------------------------------------
// Whole-directory validation
// ---------------------------------------------------------------------------

/**
 * Precheck-compatible entry point.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the repo root.
 * @param {string[]} opts.allFiles - all repo-relative file paths the precheck knows about (unused; the spec dir is read directly).
 * @param {(relPath: string) => string|null} opts.readFile - reader honouring precheck's ignore rules.
 * @param {string} [opts.specDir] - spec directory, repo-relative. Defaults to `design-specs`.
 * @returns {Array<{severity: 'Warning'|'Blocking', file: string, line: number, message: string}>}
 */
export function validateDesignSpecs({ repoRoot, allFiles, readFile, specDir = DEFAULT_SPEC_DIR }) {
  const findings = [];
  if (!repoRoot) return findings;

  const specDirAbs = path.resolve(repoRoot, specDir);
  if (!fs.existsSync(specDirAbs)) return findings;
  if (!fs.statSync(specDirAbs).isDirectory()) return findings;

  const specDirPosix = specDir.replaceAll(path.sep, "/");
  const files = fs.readdirSync(specDirAbs).filter((f) => f.endsWith(".md")).sort();

  for (const filename of files) {
    const repoRel = path.posix.join(specDirPosix, filename);
    let content = typeof readFile === "function" ? readFile(repoRel) : null;
    if (content == null) content = fs.readFileSync(path.join(specDirAbs, filename), "utf8");

    const result = validateContent(filename, content);
    for (const message of result.errors) {
      findings.push({ severity: "Blocking", file: repoRel, line: 1, message });
    }
    for (const message of result.warnings) {
      findings.push({ severity: "Warning", file: repoRel, line: 1, message });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printSummary(records) {
  const headers = ["feature", "status", "covered", "open", "proposed", "updated"];
  const rows = records.map(({ stats }) => [
    stats.feature == null ? "" : String(stats.feature),
    stats.status == null ? "" : String(stats.status),
    `${stats.covered}/9`,
    String(stats.openQuestions),
    String(stats.proposed),
    stats.updated == null ? "" : String(stats.updated),
  ]);
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i].length)));
  const format = (row) => row.map((value, i) => value.padEnd(widths[i])).join(" | ");

  console.log(format(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("-|-"));
  for (const row of rows) console.log(format(row));
}

function cliMain() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    console.error(`design-spec-tracker: ${e.message}`);
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const repoRoot = process.cwd();
  const specDirAbs = path.resolve(repoRoot, args.specDir);
  if (!fs.existsSync(specDirAbs)) {
    console.log(`design-spec-tracker: ${args.specDir} does not exist yet — nothing to validate.`);
    process.exit(0);
  }
  if (!fs.statSync(specDirAbs).isDirectory()) {
    console.error(`design-spec-tracker: ${args.specDir} is not a directory`);
    process.exit(2);
  }

  const files = fs.readdirSync(specDirAbs).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) {
    console.log(`design-spec-tracker: ${args.specDir} is empty — nothing to validate.`);
    process.exit(0);
  }

  const findings = validateDesignSpecs({
    repoRoot,
    allFiles: [],
    readFile: () => null,
    specDir: args.specDir,
  });

  const specDirPosix = args.specDir.replaceAll(path.sep, "/");
  const records = files.map((filename) => {
    const content = fs.readFileSync(path.join(specDirAbs, filename), "utf8");
    return {
      filename,
      repoRel: path.posix.join(specDirPosix, filename),
      stats: validateContent(filename, content).stats,
    };
  });

  if (args.summary) printSummary(records);

  const byFile = new Map();
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }

  for (const { repoRel } of records) {
    const items = byFile.get(repoRel) || [];
    const errors = items.filter((item) => item.severity === "Blocking");
    const warnings = items.filter((item) => item.severity === "Warning");
    if (items.length === 0) {
      console.log(`✓ ${repoRel}`);
      continue;
    }

    const mark = errors.length ? "✗" : "!";
    const out = errors.length ? console.error : console.log;
    out(`${mark} ${repoRel}`);
    for (const item of errors) console.error(`    ${item.message}`);
    for (const item of warnings) out(`    warn: ${item.message}`);
  }

  const errorCount = findings.filter((finding) => finding.severity === "Blocking").length;
  const warningCount = findings.length - errorCount;
  console.log(`\n${files.length} spec(s), ${errorCount} error(s), ${warningCount} warning(s).`);
  process.exit(errorCount > 0 ? 1 : 0);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    cliMain();
  } catch (e) {
    console.error(`design-spec-tracker: ${e.message}`);
    process.exit(2);
  }
}
