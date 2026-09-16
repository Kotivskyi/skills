#!/usr/bin/env node
// new-decision.mjs — create a decision-log entry with the frontmatter already correct.
//
// The frontmatter is the part a hand-written file gets wrong: the id has to match
// the filename, the date has to match the id, the topic has to match the slug, and
// the sequence number has to be the next free one for that day. All four are
// derivable, so this script derives them and leaves the author only the prose.
//
// Behaviour follows the repo's `decision-log.json` (next to the log dir):
//   statusMode "stored"   → writes `status: active`
//   statusMode "derived"  → writes no status line
//   buckets set           → `--bucket` is required (when the ratchet binds) and validated
//   maxSlugWords          → the slug derived from the title must fit; pass --slug otherwise
//   templateNote          → inserted as an HTML comment under the title
//
// Usage (from the repo root; <skill-dir> is this skill's directory):
//   node <skill-dir>/scripts/new-decision.mjs "Title of the decision" \
//       [--bucket <name>] [--tags a,b] [--supersedes <id-or-stem>[,<id-or-stem>]] \
//       [--linear ABC-123] [--date YYYY-MM-DD] [--slug custom-slug] \
//       [--log-dir decisions/log] [--config <path>] [--dry-run]
//
// Exit codes: 0 on success, 2 on a usage error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_LOG_DIR,
  FILENAME_RE,
  ID_RE,
  STEM_RE,
  SLUG_RE,
  DATE_RE,
  loadConfig,
  resolveSupersedes,
} from "./validate.mjs";

function die(msg) {
  console.error(`new-decision: ${msg}`);
  process.exit(2);
}

export function slugify(title) {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!s) die("the title produces an empty slug");
  return s;
}

function parseArgs(argv) {
  const out = { tags: [], supersedes: [], linear: "", logDir: DEFAULT_LOG_DIR, configPath: null };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tags") out.tags = (argv[++i] || "").split(",").map((t) => t.trim()).filter(Boolean);
    else if (a === "--bucket") out.bucket = argv[++i];
    else if (a === "--supersedes") out.supersedes = (argv[++i] || "").split(",").map((t) => t.trim()).filter(Boolean);
    else if (a === "--linear") out.linear = argv[++i] || "";
    else if (a === "--date") out.date = argv[++i];
    else if (a === "--slug") out.slug = argv[++i];
    else if (a === "--log-dir") out.logDir = argv[++i];
    else if (a === "--config") out.configPath = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("-")) die(`unknown option ${a}`);
    else rest.push(a);
  }
  out.title = rest.join(" ").trim();
  return out;
}

function printHelp() {
  console.log(
    'Usage: node new-decision.mjs "Title of the decision" [--bucket <name>] [--tags a,b]\n' +
      "         [--supersedes <id-or-stem>[,<id-or-stem>]] [--linear ABC-123] [--date YYYY-MM-DD]\n" +
      "         [--slug custom-slug] [--log-dir decisions/log] [--config <path>] [--dry-run]\n" +
      "\nWrites <log-dir>/YYYY-MM-DD-NN-slug.md with valid frontmatter and the four required\n" +
      "body sections stubbed. Fill in the prose, then run scripts/validate.mjs."
  );
}

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}
if (!args.title) {
  printHelp();
  die("a title is required");
}

const logDirAbs = path.resolve(process.cwd(), args.logDir);
if (!fs.existsSync(logDirAbs)) die(`${args.logDir} does not exist — run from the repo root (or create the folder first)`);

const loaded = loadConfig(logDirAbs, args.configPath);
if (loaded.error) die(loaded.error);
const config = loaded.config;

const day = args.date || new Date().toISOString().slice(0, 10);
if (!DATE_RE.test(day)) die("--date must be YYYY-MM-DD");

// --- bucket ---------------------------------------------------------------
if (config.buckets) {
  const binds = !config.bucketRequiredFrom || day >= config.bucketRequiredFrom;
  if (!args.bucket && binds) die(`--bucket is required (one of ${config.buckets.join("|")})`);
  if (args.bucket && !config.buckets.includes(args.bucket)) die(`--bucket must be one of ${config.buckets.join("|")}`);
} else if (args.bucket) {
  die("--bucket given but the config defines no buckets (set `buckets` in decision-log.json)");
}

// --- linear / tags --------------------------------------------------------
if (args.linear && !new RegExp(config.linearPattern).test(args.linear)) {
  die(`--linear must match ${config.linearPattern}`);
}
for (const t of args.tags) {
  if (!SLUG_RE.test(t)) die(`tag "${t}" is not kebab-case`);
}

// --- slug -----------------------------------------------------------------
const slug = args.slug ? slugify(args.slug) : slugify(args.title);
const slugWords = slug.split("-").length;
const ratchetBinds = !config.ratchetFrom || day >= config.ratchetFrom;
if (ratchetBinds && slugWords > config.maxSlugWords) {
  die(
    `slug "${slug}" has ${slugWords} words; the limit is ${config.maxSlugWords}. ` +
      `Pass --slug with a 2-${config.maxSlugWords} word gist; the title keeps the long form.`
  );
}

// --- sequence number ------------------------------------------------------
// The next free number for that day. Two sessions or branches can each allocate
// the same number, and git merges both files without a conflict because the slugs
// differ — the validator catches the duplicate id afterwards and asks for a renumber.
const existing = fs.readdirSync(logDirAbs).filter((f) => f.endsWith(".md"));
let seq = 0;
for (const f of existing) {
  const m = f.match(FILENAME_RE);
  if (m && m[1] === day) seq = Math.max(seq, Number(m[2]));
}
seq += 1;
if (seq > 99) die(`more than 99 decisions on ${day}; use --date or a new day`);
const id = `${day}-${String(seq).padStart(2, "0")}`;
const filename = `${id}-${slug}.md`;
const target = path.join(logDirAbs, filename);
if (fs.existsSync(target)) die(`${target} already exists`);

// --- supersedes -----------------------------------------------------------
const stems = existing.filter((f) => FILENAME_RE.test(f)).map((f) => f.replace(/\.md$/, ""));
const resolved = [];
for (const ref of args.supersedes) {
  if (!ID_RE.test(ref) && !STEM_RE.test(ref)) die(`--supersedes "${ref}" is not an id (YYYY-MM-DD-NN) or id-slug`);
  const res = resolveSupersedes(ref, stems);
  if (!res.ok) die(`--supersedes ${res.error}`);
  // Write the stem when the bare id is shared, so the reference stays unambiguous.
  resolved.push(ref === res.stem || stems.filter((s) => s.startsWith(`${res.id}-`)).length > 1 ? res.stem : res.id);
}
const supersedesValue = resolved.length === 0 ? "" : resolved.length === 1 ? resolved[0] : `[${resolved.join(", ")}]`;

// --- body -----------------------------------------------------------------
const titleLine = args.title.charAt(0).toUpperCase() + args.title.slice(1);
const frontmatter = [
  "---",
  `id: ${id}`,
  `date: ${day}`,
  `topic: ${slug}`,
  ...(config.buckets && args.bucket ? [`bucket: ${args.bucket}`] : []),
  ...(config.statusMode === "stored" ? ["status: active"] : []),
  `tags: [${args.tags.join(", ")}]`,
  `linear:${args.linear ? " " + args.linear : ""}`,
  `supersedes:${supersedesValue ? " " + supersedesValue : ""}`,
  "---",
].join("\n");

// The note guides the author while the stubs are being filled in. It is not part
// of the record, so the marker tells the author to delete it with the stubs —
// without that line, half the entries keep it and half do not.
const note = config.templateNote
  ? `\n<!-- DRAFTING NOTE — delete this comment once the sections below are written.\n${config.templateNote.trim()}\n-->\n`
  : "";

const body = `${frontmatter}

# ${titleLine}
${note}
## Decision

TODO one or two sentences. The choice itself, no fluff.

## Context

TODO 2-4 sentences. Why this came up, and what was being discussed.

## Reasoning

TODO 1-3 sentences. Why this option won. If the user made the call with no
rationale, write: User call, no further rationale given.

## Source

TODO a quoted or paraphrased conversation excerpt, plus the date (${day}).
`;

if (args.dryRun) {
  console.log(`# would write ${target}`);
  console.log(body);
  process.exit(0);
}

fs.writeFileSync(target, body);
console.log(path.relative(process.cwd(), target));
if (resolved.length) {
  if (config.statusMode === "stored") {
    console.log(`supersedes ${resolved.join(", ")} — set \`status: superseded\` in each of those files.`);
  } else {
    console.log(`supersedes ${resolved.join(", ")} — do NOT edit those files; status is derived.`);
  }
}
