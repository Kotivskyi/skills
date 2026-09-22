import { createReadStream, existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { InputError } from './args.mjs';

// Streams a file line by line. Memory stays flat on very long lines.
export async function* readLines(file) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n += 1;
    yield { line, n };
  }
}

export async function readJsonlRecords(file) {
  if (!existsSync(file)) throw new InputError(`missing file: ${file}`);
  const rows = [];
  for await (const { line, n } of readLines(file)) {
    if (!line.trim()) continue;
    try {
      rows.push({ line: n, value: JSON.parse(line), error: null });
    } catch (error) {
      rows.push({ line: n, value: null, error: error.message });
    }
  }
  return rows;
}

export async function readJsonl(file) {
  const rows = await readJsonlRecords(file);
  const bad = rows.find((row) => row.error);
  if (bad) throw new InputError(`${file}:${bad.line}: ${bad.error}`);
  return rows.map((row) => row.value);
}

export async function writeJsonl(file, values) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''));
  await rename(tmp, file);
}

export async function appendJsonl(file, values) {
  if (!values.length) return;
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

export async function existingIds(file) {
  if (!existsSync(file)) return new Set();
  const rows = await readJsonlRecords(file);
  return new Set(rows.filter((row) => row.value?.id).map((row) => row.value.id));
}

export async function readJson(file) {
  if (!existsSync(file)) throw new InputError(`missing file: ${file}`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new InputError(`unreadable JSON ${file}: ${error.message}`);
  }
}

export async function readOptionalJson(file) {
  return existsSync(file) ? readJson(file) : null;
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
