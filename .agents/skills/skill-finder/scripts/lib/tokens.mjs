export const STOP_WORDS = new Set(
  `a an the and or but if then else of to in on at for from by with without into onto over under up down out
  is are was were be been being am do does did done have has had it its this that these those there here
  we you i me my our your they them their he she his her not no yes so as can could should would will just
  also please lets let us via per about after before again all any each more most other some such only own
  same too very what which who whom when where why how than now use using`.split(/\s+/)
);

// Command heads that carry no workflow signal on their own.
const NOISE_COMMANDS = new Set([
  'cd', 'echo', 'cat', 'ls', 'head', 'tail', 'wc', 'sleep', 'pwd', 'true', 'false', 'export', 'set', 'source',
  'sed', 'awk', 'grep', 'rg', 'find', 'printf', 'test', 'exit', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'touch',
  'which', 'command', 'time', 'env', 'sudo', 'xargs', 'tee', 'sort', 'uniq'
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function stem(token) {
  return token.length > 3 && token.endsWith('s') && !/(ss|us|is)$/.test(token) ? token.slice(0, -1) : token;
}

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

function toSet(value) {
  return value instanceof Set ? value : new Set(value);
}

function sharedCount(left, right) {
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared;
}

export function jaccard(a, b) {
  const left = toSet(a);
  const right = toSet(b);
  const shared = sharedCount(left, right);
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

// Overlap coefficient: shared tokens over the smaller set.
export function overlap(a, b) {
  const left = toSet(a);
  const right = toSet(b);
  const smaller = Math.min(left.size, right.size);
  return smaller === 0 ? 0 : sharedCount(left, right) / smaller;
}

export function normalizeText(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function round2(value) {
  return Math.round(value * 100) / 100;
}

export function skillTokens(entry) {
  const name = String(entry.name ?? '').replace(/[-_:]/g, ' ');
  return new Set(tokenize(`${name} ${entry.description ?? ''} ${(entry.triggers ?? []).join(' ')}`));
}

export function isLowInformationTitle(title) {
  const text = String(title ?? '').trim();
  return text === '' || /^unknown$/i.test(text) || UUID.test(text);
}

// "first two tokens, when the second token is not a flag or a path".
export function commandPatterns(command) {
  const lines = String(command ?? '').split('\n');
  const heredoc = lines.findIndex((line) => line.includes('<<'));
  const head = (heredoc === -1 ? lines : lines.slice(0, heredoc + 1)).join('\n');
  const patterns = [];
  for (const segment of head.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
    if (tokens.length < 2) continue;
    const [first, second] = tokens;
    if (NOISE_COMMANDS.has(first) || !/^[A-Za-z0-9._/-]+$/.test(first)) continue;
    if (second.startsWith('-') || second.includes('/') || /^[~.]/.test(second)) continue;
    if (!/^[A-Za-z0-9:@_.+-]+$/.test(second)) continue;
    patterns.push(`${first} ${second}`);
  }
  return patterns;
}
