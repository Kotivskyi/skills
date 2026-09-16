#!/usr/bin/env node
// Validate decision-log files in `decisions/log/`.
//
// Importable so a repo precheck script can fold the findings into its central
// report. Also runnable as a CLI for ad-hoc local use.
//
// Per-repo behaviour comes from an optional config file, `decision-log.json`,
// that sits NEXT TO the log dir (i.e. `decisions/decision-log.json`). Every key
// is optional; see DEFAULT_CONFIG and references/config.md.
//
// Checks (level `error` fails the run; level `warn` is reported only):
//   error  Filename matches YYYY-MM-DD-NN-slug.md
//   error  Frontmatter parses and contains required fields
//   error  id matches filename prefix; date matches id; topic matches slug
//   error  No two files share an id — two branches can allocate the same NN and
//          still merge cleanly, so the collision has to be caught here (ids dated
//          on/after config.ratchetFrom, or all when ratchetFrom is unset)
//   error  tags is a YAML list (possibly empty) of kebab-case strings
//   error  linear (if non-empty) matches config.linearPattern
//   error  supersedes (if non-empty) is an id, an id-slug stem, or an inline list
//          of them; each resolves to exactly one existing file; none is this file
//   error  status, per config.statusMode:
//            stored  — required, one of active|superseded|reversed, and it agrees
//                      with the supersedes graph (a superseded entry says so)
//            derived — optional legacy field; if present it must agree with the
//                      graph, and the fix is to delete the line, not edit it
//   error  bucket (only when config.buckets is set) is one of the allowed values,
//          and is present on entries dated on/after config.bucketRequiredFrom
//   error  slug has at most config.maxSlugWords words (entries dated on/after
//          config.ratchetFrom, or all entries when ratchetFrom is unset)
//   error  Body has an H1 title and the four `##` sections in order, none empty,
//          none still a `TODO` stub
//   warn   `## Decision` has at most config.maxDecisionSentences sentences
//          (same ratchet as the slug rule)
//
// CLI usage (run from the repo root; <skill-dir> is this skill's directory):
//   node <skill-dir>/scripts/validate.mjs
//   node <skill-dir>/scripts/validate.mjs --log-dir decisions/log --config decisions/decision-log.json
//   node <skill-dir>/scripts/validate.mjs --quiet          # only failures and the summary
//
// Exit codes (CLI mode):
//   0 on success (warnings allowed), 1 on any error, 2 on usage / IO / config error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_LOG_DIR = "decisions/log";
export const CONFIG_BASENAME = "decision-log.json";
export const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A fully-qualified reference: id PLUS slug, i.e. the filename without `.md`.
export const STEM_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ALLOWED_STATUSES = new Set(["active", "superseded", "reversed"]);
export const ALLOWED_STATUS_MODES = new Set(["stored", "derived"]);
export const REQUIRED_SECTIONS = ["Decision", "Context", "Reasoning", "Source"];

export const DEFAULT_CONFIG = Object.freeze({
  // "stored": `status` is a required field the author maintains (default).
  // "derived": `status` is computed from the supersedes graph and never written.
  statusMode: "stored",
  // true: files under the log dir are never edited; retire with a new entry.
  // Requires statusMode "derived". Enforced in git by scripts/check-append-only.sh.
  appendOnly: false,
  // Optional classification field. null disables the `bucket` check entirely.
  buckets: null,
  // When buckets is set: `bucket` is required for entries dated on/after this
  // date; older entries stay valid without one. null = required for all.
  bucketRequiredFrom: null,
  // Regex (string) the `linear` field must match when non-empty.
  linearPattern: "^[A-Z][A-Z0-9]*-\\d+$",
  // Slug length limit (words) and Decision length limit (sentences).
  maxSlugWords: 6,
  maxDecisionSentences: 2,
  // Length rules bind only entries dated on/after this date. null = all entries.
  ratchetFrom: null,
  // Optional note new-decision.mjs inserts as an HTML comment under the title.
  templateNote: null,
});

function parseArgs(argv) {
  const args = { logDir: DEFAULT_LOG_DIR, configPath: null, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--log-dir") args.logDir = argv[++i];
    else if (a === "--config") args.configPath = argv[++i];
    else if (a === "--quiet" || a === "-q") args.quiet = true;
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
    "Usage: node validate.mjs [--log-dir <path>] [--config <path>] [--quiet]\n" +
      "\n" +
      "Validates every *.md file in the log directory.\n" +
      `Default --log-dir is \`${DEFAULT_LOG_DIR}\` relative to the current working directory.\n` +
      `Default --config is \`${CONFIG_BASENAME}\` next to the log directory, if it exists.`
  );
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Returns an array of error strings; empty when the raw config is valid. */
export function validateConfig(raw) {
  const errors = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return ["config must be a JSON object"];
  }
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULT_CONFIG)) errors.push(`unknown config key \`${key}\``);
  }
  const c = { ...DEFAULT_CONFIG, ...raw };
  if (!ALLOWED_STATUS_MODES.has(c.statusMode)) {
    errors.push(`statusMode must be one of ${[...ALLOWED_STATUS_MODES].join("|")}`);
  }
  if (typeof c.appendOnly !== "boolean") errors.push("appendOnly must be true or false");
  if (c.appendOnly && c.statusMode !== "derived") {
    errors.push("appendOnly: true requires statusMode: \"derived\" (a stored status must be edited to retire an entry)");
  }
  if (c.buckets !== null) {
    if (!Array.isArray(c.buckets) || c.buckets.length === 0 || !c.buckets.every((b) => SLUG_RE.test(b))) {
      errors.push("buckets must be null or a non-empty array of kebab-case strings");
    }
  }
  for (const key of ["bucketRequiredFrom", "ratchetFrom"]) {
    if (c[key] !== null && !DATE_RE.test(c[key])) errors.push(`${key} must be null or YYYY-MM-DD`);
  }
  try {
    new RegExp(c.linearPattern);
  } catch (e) {
    errors.push(`linearPattern is not a valid regex: ${e.message}`);
  }
  for (const key of ["maxSlugWords", "maxDecisionSentences"]) {
    if (!Number.isInteger(c[key]) || c[key] < 1) errors.push(`${key} must be a positive integer`);
  }
  if (c.templateNote !== null && typeof c.templateNote !== "string") {
    errors.push("templateNote must be null or a string");
  }
  return errors;
}

/**
 * Load the config for a log dir. `explicitPath` (from --config) must exist;
 * the default location is optional.
 * Returns { config, path, error } — `error` is a string or null.
 */
export function loadConfig(logDirAbs, explicitPath = null) {
  const candidate = explicitPath
    ? path.resolve(explicitPath)
    : path.join(logDirAbs, "..", CONFIG_BASENAME);
  if (!fs.existsSync(candidate)) {
    return {
      config: { ...DEFAULT_CONFIG },
      path: null,
      error: explicitPath ? `config file not found: ${candidate}` : null,
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
  } catch (e) {
    return { config: { ...DEFAULT_CONFIG }, path: candidate, error: `config parse: ${e.message}` };
  }
  const errors = validateConfig(raw);
  return {
    config: { ...DEFAULT_CONFIG, ...raw },
    path: candidate,
    error: errors.length ? errors.join("; ") : null,
  };
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

/** Rough sentence count: terminal punctuation followed by space/end, plus list bullets. */
export function countSentences(text) {
  if (!text) return 0;
  const isBullet = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const lines = text.split("\n");
  const bullets = lines.filter(isBullet).length;
  const prose = lines
    .filter((l) => !isBullet(l))
    .join(" ")
    .replace(/`[^`]*`/g, "code")
    .replace(/\b(e\.g|i\.e|etc|vs|approx|no|fig|sec|min|ms)\./gi, "$1");
  const terminals = prose.match(/[.!?](?=\s|$)/g);
  return bullets + (terminals ? terminals.length : 0);
}

/**
 * Resolve a `supersedes` reference against the known stems.
 * `ref` may be a bare id (YYYY-MM-DD-NN) or a full stem (id-slug).
 * Returns { ok: true, id, stem } or { ok: false, error }.
 */
export function resolveSupersedes(ref, stems) {
  if (STEM_RE.test(ref)) {
    if (!stems.includes(ref)) return { ok: false, error: `points to ${ref} but no matching file exists in the log dir` };
    return { ok: true, id: ref.slice(0, 13), stem: ref };
  }
  if (ID_RE.test(ref)) {
    const matches = stems.filter((s) => s.startsWith(`${ref}-`));
    if (matches.length === 0) return { ok: false, error: `points to id ${ref} but no matching file exists in the log dir` };
    if (matches.length > 1) {
      return {
        ok: false,
        error:
          `id ${ref} is AMBIGUOUS — ${matches.length} files share it (${matches.join(", ")}). ` +
          `Use the full id-slug reference instead, e.g. \`supersedes: ${matches[0]}\`.`,
      };
    }
    return { ok: true, id: ref, stem: matches[0] };
  }
  return { ok: false, error: `is not a valid id or id-slug reference: ${ref}` };
}

function asList(v) {
  return Array.isArray(v) ? v : [v];
}

function pushFinding(out, file, message, level = "error") {
  out.push({ severity: "Warning", level, file, line: 1, message });
}

// ---------------------------------------------------------------------------
// Per-file validation
// ---------------------------------------------------------------------------

/**
 * Validate a single decision-log file's content against the format rules.
 *
 * `ctx` carries whole-log facts and is optional (standalone use skips graph checks):
 *   config        — resolved config object (defaults when omitted)
 *   stems         — every filename in the log dir without `.md`
 *   supersededIds — Set of ids that some other entry supersedes
 *   entriesById   — Map id → [{ file, status }] (arrays: ids may collide)
 *
 * Returns an array of { level: "error"|"warn", message }.
 */
export function validateContent(filename, content, ctx = {}) {
  const config = ctx.config || DEFAULT_CONFIG;
  const stems = ctx.stems || null;
  const supersededIds = ctx.supersededIds || null;
  const entriesById = ctx.entriesById || null;
  const issues = [];
  const error = (message) => issues.push({ level: "error", message });
  const warn = (message) => issues.push({ level: "warn", message });

  const fnMatch = filename.match(FILENAME_RE);
  if (!fnMatch) {
    error(`filename does not match YYYY-MM-DD-NN-slug.md`);
    return issues;
  }
  const [, fnDate, fnSeq, fnSlug] = fnMatch;
  const fnId = `${fnDate}-${fnSeq}`;
  const ratchetBinds = !config.ratchetFrom || fnDate >= config.ratchetFrom;

  const slugWords = fnSlug.split("-").length;
  if (ratchetBinds && slugWords > config.maxSlugWords) {
    error(
      `filename slug has ${slugWords} words; the limit is ${config.maxSlugWords}. ` +
        `Shorten the slug — the H1 title carries the long form.`
    );
  }

  const fm = parseFrontmatter(content);
  if (!fm.ok) {
    error(`frontmatter parse: ${fm.error}`);
    return issues;
  }
  const { data, body } = fm;

  const required = ["id", "date", "topic", "tags"];
  if (config.statusMode === "stored") required.push("status");
  for (const key of required) {
    if (!(key in data)) error(`frontmatter: missing required field \`${key}\``);
  }

  if (data.id && data.id !== fnId) error(`frontmatter \`id\` (${data.id}) does not match filename id (${fnId})`);
  if (data.id && !ID_RE.test(data.id)) error(`frontmatter \`id\` is not YYYY-MM-DD-NN format: ${data.id}`);
  if (data.date && !DATE_RE.test(data.date)) error(`frontmatter \`date\` is not YYYY-MM-DD format: ${data.date}`);
  if (data.date && data.id && data.id.slice(0, 10) !== data.date) {
    error(`frontmatter \`date\` (${data.date}) does not match date portion of \`id\` (${data.id.slice(0, 10)})`);
  }
  if (data.topic && !SLUG_RE.test(data.topic)) error(`frontmatter \`topic\` is not a kebab-case slug: ${data.topic}`);
  if (data.topic && data.topic !== fnSlug) {
    error(`frontmatter \`topic\` (${data.topic}) does not match filename slug (${fnSlug})`);
  }

  // --- status -------------------------------------------------------------
  const hasStatus = "status" in data && data.status !== null && data.status !== "";
  if (hasStatus && !ALLOWED_STATUSES.has(data.status)) {
    error(`frontmatter \`status\` is not one of ${[...ALLOWED_STATUSES].join("|")}: ${data.status}`);
  } else if (config.statusMode === "stored") {
    if ("status" in data && !hasStatus) error(`frontmatter \`status\` is empty; use one of ${[...ALLOWED_STATUSES].join("|")}`);
    if (hasStatus && supersededIds) {
      if (data.status === "active" && supersededIds.has(fnId)) {
        error(`frontmatter \`status\` says \`active\` but another entry supersedes this one — set \`status: superseded\``);
      }
      if (data.status === "superseded" && !supersededIds.has(fnId)) {
        error(
          `frontmatter \`status\` says \`superseded\` but no entry supersedes this one — ` +
            `add \`supersedes: ${fnId}\` to the successor, or use \`status: reversed\` if there is none`
        );
      }
    }
  } else if (hasStatus && data.status !== "reversed" && supersededIds) {
    // derived mode: a stored status is legacy and must agree with the graph
    const derived = supersededIds.has(fnId) ? "superseded" : "active";
    if (data.status !== derived) {
      error(
        `frontmatter \`status\` says \`${data.status}\` but the supersedes graph derives \`${derived}\`. ` +
          `Status is derived in this repo — delete the line rather than editing it.`
      );
    }
  }

  // --- bucket -------------------------------------------------------------
  if (config.buckets) {
    const hasBucket = "bucket" in data && data.bucket !== null && data.bucket !== "";
    const bucketBinds = !config.bucketRequiredFrom || fnDate >= config.bucketRequiredFrom;
    if (!hasBucket) {
      if (bucketBinds) {
        error(
          `frontmatter: missing required field \`bucket\` (one of ${config.buckets.join("|")})` +
            (config.bucketRequiredFrom ? ` — required for entries dated ${config.bucketRequiredFrom} or later` : "")
        );
      }
    } else if (!config.buckets.includes(data.bucket)) {
      error(`frontmatter \`bucket\` is not one of ${config.buckets.join("|")}: ${data.bucket}`);
    }
  }

  // --- tags / linear ------------------------------------------------------
  if ("tags" in data) {
    if (!Array.isArray(data.tags)) {
      error(`frontmatter \`tags\` must be a YAML list (use \`tags: []\` for empty)`);
    } else {
      for (const t of data.tags) {
        if (!SLUG_RE.test(t)) error(`frontmatter \`tags\` entry is not kebab-case: ${t}`);
      }
    }
  }
  if (data.linear && !new RegExp(config.linearPattern).test(data.linear)) {
    error(`frontmatter \`linear\` does not match ${config.linearPattern}: ${data.linear}`);
  }

  // --- supersedes ---------------------------------------------------------
  if (data.supersedes) {
    for (const ref of asList(data.supersedes)) {
      if (!ID_RE.test(ref) && !STEM_RE.test(ref)) {
        error(`frontmatter \`supersedes\` is not a valid id or id-slug reference: ${ref}`);
        continue;
      }
      if (ref === fnId || ref === `${fnId}-${fnSlug}`) {
        error(`frontmatter \`supersedes\` points at this same entry (${ref})`);
        continue;
      }
      if (!stems) continue;
      const res = resolveSupersedes(ref, stems);
      if (!res.ok) {
        error(`frontmatter \`supersedes\` ${res.error}`);
        continue;
      }
      if (!entriesById) continue;
      // Report a stale target status on THIS entry too: a diff-scoped gate only
      // sees the files the branch changed, and the branch never changes the old one.
      const targets = (entriesById.get(res.id) || []).filter((t) => `${res.id}-${t.slug}` === res.stem);
      for (const target of targets) {
        const stored = target.status;
        if (!stored || stored === "superseded" || stored === "reversed") continue;
        if (config.statusMode === "stored") {
          error(
            `this entry supersedes ${res.stem}, whose file still stores \`status: ${stored}\`. ` +
              `Set \`status: superseded\` in \`${target.file}\`.`
          );
        } else {
          error(
            `this entry supersedes ${res.stem}, whose file still stores \`status: ${stored}\`. ` +
              `Status is derived — delete that line from \`${target.file}\`` +
              (config.appendOnly ? " (the one edit the append-only check permits)." : ".")
          );
        }
      }
    }
  }

  // --- body ---------------------------------------------------------------
  if (!hasH1(body)) error(`body: missing H1 title (first non-blank line must start with \`# \`)`);
  const sections = extractSections(body);
  const sectionNames = sections.map((s) => s.name);
  for (let i = 0; i < REQUIRED_SECTIONS.length; i++) {
    if (sectionNames[i] !== REQUIRED_SECTIONS[i]) {
      error(`body: section #${i + 1} must be \`## ${REQUIRED_SECTIONS[i]}\`, got \`## ${sectionNames[i] ?? "(missing)"}\``);
    }
  }
  for (let i = 0; i < Math.min(sections.length, REQUIRED_SECTIONS.length); i++) {
    const s = sections[i];
    if (s.content === "") error(`body: section \`## ${s.name}\` is empty`);
    else if (/^TODO\b/.test(s.content)) error(`body: section \`## ${s.name}\` is still a TODO stub`);
  }
  const decision = sections.find((s) => s.name === "Decision");
  if (decision && ratchetBinds) {
    const n = countSentences(decision.content);
    if (n > config.maxDecisionSentences) {
      warn(
        `body: \`## Decision\` has about ${n} sentences; keep it to ${config.maxDecisionSentences}. ` +
          `Move background to Context and rationale to Reasoning.`
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Whole-log validation
// ---------------------------------------------------------------------------

/**
 * Precheck-compatible entry point.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the repo root.
 * @param {string[]} opts.allFiles - all repo-relative file paths the precheck knows about (unused; the log dir is read directly).
 * @param {(relPath: string) => string|null} opts.readFile - reader honouring precheck's ignore rules.
 * @param {string} [opts.logDir] - log directory, repo-relative. Defaults to `decisions/log`.
 * @param {string} [opts.configPath] - explicit config path; default is `decision-log.json` next to the log dir.
 * @returns {Array<{severity: 'Warning'|'Blocking', level: 'error'|'warn', file: string, line: number, message: string}>}
 */
export function validateDecisionLog({ repoRoot, allFiles, readFile, logDir = DEFAULT_LOG_DIR, configPath = null }) {
  const findings = [];
  if (!repoRoot) return findings;

  const logDirAbs = path.resolve(repoRoot, logDir);
  if (!fs.existsSync(logDirAbs)) return findings;
  if (!fs.statSync(logDirAbs).isDirectory()) return findings;

  const loaded = loadConfig(logDirAbs, configPath ? path.resolve(repoRoot, configPath) : null);
  if (loaded.error) {
    const rel = loaded.path ? path.relative(repoRoot, loaded.path) : path.posix.join(path.dirname(logDir), CONFIG_BASENAME);
    pushFinding(findings, rel.replaceAll(path.sep, "/"), `config: ${loaded.error}`);
    return findings;
  }
  const config = loaded.config;
  const logDirPosix = logDir.replaceAll(path.sep, "/");

  // Source of truth for "files in the log dir" is the filesystem here, not the
  // caller's allFiles list — precheck may pass us a filtered set.
  const files = fs.readdirSync(logDirAbs).filter((f) => f.endsWith(".md")).sort();

  const read = (filename) => {
    const repoRel = path.posix.join(logDirPosix, filename);
    let content = typeof readFile === "function" ? readFile(repoRel) : null;
    if (content == null) content = fs.readFileSync(path.join(logDirAbs, filename), "utf8");
    return { repoRel, content };
  };

  // First pass: whole-log facts. `stems` resolves supersedes references,
  // `idOwners` catches the collision the filename scheme cannot prevent,
  // `supersededIds` derives every entry's status, `entriesById` lets the
  // superseding entry report a stale target.
  const stems = [];
  const idOwners = new Map();
  const entriesById = new Map();
  const parsed = new Map();
  for (const f of files) {
    const m = f.match(FILENAME_RE);
    if (!m) continue;
    const id = `${m[1]}-${m[2]}`;
    stems.push(f.replace(/\.md$/, ""));
    if (!idOwners.has(id)) idOwners.set(id, []);
    idOwners.get(id).push(f);
    const { repoRel, content } = read(f);
    parsed.set(f, content);
    const fm = parseFrontmatter(content);
    if (!fm.ok) continue;
    if (!entriesById.has(id)) entriesById.set(id, []);
    entriesById.get(id).push({ file: repoRel, slug: m[3], status: fm.data.status || null, supersedes: fm.data.supersedes || null });
  }
  const supersededIds = new Set();
  for (const owners of entriesById.values()) {
    for (const e of owners) {
      if (!e.supersedes) continue;
      for (const ref of asList(e.supersedes)) {
        const res = resolveSupersedes(ref, stems);
        if (res.ok) supersededIds.add(res.id);
      }
    }
  }

  for (const [id, owners] of idOwners) {
    if (owners.length < 2) continue;
    // Same ratchet as the length rules: legacy collisions stay, new ones fail.
    if (config.ratchetFrom && id.slice(0, 10) < config.ratchetFrom) continue;
    for (const f of owners) {
      pushFinding(
        findings,
        path.posix.join(logDirPosix, f),
        `duplicate id ${id}: also used by ${owners.filter((o) => o !== f).join(", ")}. ` +
          `Two sessions or branches allocated the same sequence number. Renumber the later entry.`
      );
    }
  }

  const ctx = { config, stems, supersededIds, entriesById };
  for (const filename of files) {
    const { repoRel, content } = parsed.has(filename) ? { repoRel: path.posix.join(logDirPosix, filename), content: parsed.get(filename) } : read(filename);
    for (const issue of validateContent(filename, content, ctx)) {
      pushFinding(findings, repoRel, issue.message, issue.level);
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

  const loaded = loadConfig(logDirAbs, args.configPath);
  if (loaded.error) {
    console.error(`decision-auto-tracker: ${loaded.error}`);
    process.exit(2);
  }
  const c = loaded.config;
  const configLabel = loaded.path ? path.relative(repoRoot, loaded.path) : "defaults";
  console.log(
    `config: ${configLabel} (statusMode=${c.statusMode}, appendOnly=${c.appendOnly}, ` +
      `buckets=${c.buckets ? c.buckets.length : "off"}, maxSlugWords=${c.maxSlugWords}` +
      `${c.ratchetFrom ? `, ratchetFrom=${c.ratchetFrom}` : ""})`
  );

  const findings = validateDecisionLog({
    repoRoot,
    allFiles: [],
    readFile: () => null,
    logDir: args.logDir,
    configPath: args.configPath,
  });

  const filesScanned = fs.readdirSync(logDirAbs).filter((f) => f.endsWith(".md")).sort();
  if (filesScanned.length === 0) {
    console.log(`decision-auto-tracker: ${args.logDir} is empty — nothing to validate.`);
    process.exit(0);
  }

  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const logDirPosix = args.logDir.replaceAll(path.sep, "/");
  for (const filename of filesScanned) {
    const repoRel = path.posix.join(logDirPosix, filename);
    const items = byFile.get(repoRel) || [];
    const errors = items.filter((i) => i.level === "error");
    const warns = items.filter((i) => i.level === "warn");
    if (items.length === 0) {
      if (!args.quiet) console.log(`✓ ${repoRel}`);
      continue;
    }
    const mark = errors.length ? "✗" : "⚠";
    const out = errors.length ? console.error : console.log;
    out(`${mark} ${repoRel}`);
    for (const i of errors) console.error(`    ${i.message}`);
    for (const i of warns) out(`    warn: ${i.message}`);
  }

  const errorCount = findings.filter((f) => f.level === "error").length;
  const warnCount = findings.length - errorCount;
  if (errorCount > 0) {
    console.error(`\n${errorCount} error(s), ${warnCount} warning(s) across ${filesScanned.length} file(s).`);
    process.exit(1);
  }
  console.log(`\nAll ${filesScanned.length} decision file(s) valid${warnCount ? ` (${warnCount} warning(s))` : ""}.`);
  process.exit(0);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) cliMain();
