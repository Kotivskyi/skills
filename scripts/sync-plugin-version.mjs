#!/usr/bin/env node
// Keep both skills plugin manifests in step with `package.json`.
//
// `package.json` is the source of truth: the release workflow bumps it on every
// push to `main`. Claude Code reads the version from `.claude-plugin/plugin.json`
// to decide whether an installed copy of the plugin is out of date, so a stale
// value there means installed copies never see an update.
//
// `plugins/shunt/.claude-plugin/plugin.json` carries its own upstream version
// and is deliberately not touched.
//
// Usage (from the repo root):
//   node scripts/sync-plugin-version.mjs           # write the version across
//   node scripts/sync-plugin-version.mjs --check   # verify only, write nothing
//
// Exit codes: 0 in sync (or written), 1 out of sync in --check mode, 2 on IO error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "package.json";
const TARGETS = [
  path.join(".claude-plugin", "plugin.json"),
  path.join("plugins", "engineering", ".claude-plugin", "plugin.json"),
];

function readJson(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  try {
    return { abs, text: fs.readFileSync(abs, "utf8") };
  } catch (err) {
    console.error(`sync-plugin-version: cannot read ${relPath}: ${err.message}`);
    process.exit(2);
  }
}

function parse(relPath, text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`sync-plugin-version: cannot parse ${relPath}: ${err.message}`);
    process.exit(2);
  }
}

const check = process.argv.includes("--check");
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "Usage: node scripts/sync-plugin-version.mjs [--check]\n\n" +
      `Copies the \`version\` from ${SOURCE} into ${TARGETS.join(" and ")}.\n` +
      "--check verifies they agree and writes nothing; exit 1 if they differ."
  );
  process.exit(0);
}

const source = readJson(SOURCE);
const sourceVersion = parse(SOURCE, source.text).version;

if (typeof sourceVersion !== "string" || sourceVersion === "") {
  console.error(`sync-plugin-version: ${SOURCE} has no \`version\` field`);
  process.exit(2);
}

for (const TARGET of TARGETS) {
  const target = readJson(TARGET);
  const targetJson = parse(TARGET, target.text);

  if (targetJson.version === sourceVersion) {
    console.log(`sync-plugin-version: ${TARGET} in sync at ${sourceVersion}`);
    continue;
  }

  if (check) {
    console.error(
      `sync-plugin-version: out of sync — ${SOURCE} is ${sourceVersion}, ` +
        `${TARGET} is ${targetJson.version}.\n` +
        "Run `node scripts/sync-plugin-version.mjs` to fix."
    );
    process.exitCode = 1;
    continue;
  }

  // Rewrite only the version line to preserve key order and formatting.
  const replaced = target.text.replace(
    /^(\s*"version"\s*:\s*")[^"]*(")/m,
    (_m, head, tail) => `${head}${sourceVersion}${tail}`
  );
  if (replaced === target.text) {
    console.error(`sync-plugin-version: cannot set the version in ${TARGET}`);
    process.exit(2);
  }
  fs.writeFileSync(target.abs, replaced);
  console.log(
    `sync-plugin-version: ${TARGET} ${targetJson.version} -> ${sourceVersion}`
  );
}
