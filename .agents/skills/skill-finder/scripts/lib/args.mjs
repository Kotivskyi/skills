import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export class UsageError extends Error {}
export class InputError extends Error {}

// spec: { flag: { type: 'string' | 'number' | 'boolean', multiple?: true, default?: value } }
export function parseCli(argv, spec) {
  const values = {};
  for (const [name, option] of Object.entries(spec)) {
    if (option.multiple) values[name] = [];
    else if ('default' in option) values[name] = option.default;
    else values[name] = option.type === 'boolean' ? false : undefined;
  }
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const option = spec[name];
    if (!option) throw new UsageError(`unknown flag --${name}`);
    if (option.type === 'boolean') {
      values[name] = true;
      continue;
    }
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    i += 1;
    let value = raw;
    if (option.type === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value)) throw new UsageError(`--${name} needs a number, got ${raw}`);
    }
    if (option.multiple) values[name].push(value);
    else values[name] = value;
  }
  return { values, positionals };
}

export function emit(summary) {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

export function isMain(metaUrl) {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === metaUrl;
  } catch {
    return false;
  }
}

export function runMain(main) {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .catch((error) => {
      const known = error instanceof UsageError || error instanceof InputError;
      process.stderr.write(`${known ? error.message : error.stack}\n`);
      process.exitCode = error instanceof InputError ? 2 : 1;
    });
}
