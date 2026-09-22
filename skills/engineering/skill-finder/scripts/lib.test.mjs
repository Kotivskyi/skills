import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli, UsageError } from './lib/args.mjs';
import { redact, countsToList } from './lib/redact.mjs';
import { tokenize, jaccard, overlap, commandPatterns, isLowInformationTitle, normalizeText } from './lib/tokens.mjs';
import { encodeProjectPath, inWindow, utcDays, timeRange, digestPath } from './lib/paths.mjs';
import { capDigest, truncate, DIGEST_CAP } from './lib/digest.mjs';

test('parseCli reads strings, numbers, booleans, defaults, and repeated flags', () => {
  const { values, positionals } = parseCli(
    ['file.jsonl', '--out', 'x', '--max', '5', '--strict', '--root', 'a', '--root', 'b'],
    {
      out: { type: 'string' },
      max: { type: 'number' },
      strict: { type: 'boolean' },
      root: { type: 'string', multiple: true },
      mode: { type: 'string', default: 'auto' }
    }
  );
  assert.deepEqual(positionals, ['file.jsonl']);
  assert.equal(values.out, 'x');
  assert.equal(values.max, 5);
  assert.equal(values.strict, true);
  assert.deepEqual(values.root, ['a', 'b']);
  assert.equal(values.mode, 'auto');
});

test('parseCli rejects unknown flags, missing values, and bad numbers', () => {
  assert.throws(() => parseCli(['--nope'], {}), UsageError);
  assert.throws(() => parseCli(['--out'], { out: { type: 'string' } }), UsageError);
  assert.throws(() => parseCli(['--max', 'abc'], { max: { type: 'number' } }), UsageError);
});

test('redact removes secrets and counts each kind', () => {
  const counts = new Map();
  const text = [
    'OPENAI_API_KEY=abc123',
    'key sk-test-fixture-123',
    'Authorization: Bearer abc.def-123',
    'see https://internal.example.com/x',
    'mail me@example.com',
    'sha 0123456789abcdef0123456789abcdef01234567',
    'tok aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z'
  ].join('\n');
  const out = redact(text, counts);
  for (const secret of [
    'abc123',
    'sk-test-fixture-123',
    'abc.def-123',
    'internal.example.com',
    'me@example.com',
    '0123456789abcdef0123456789abcdef01234567',
    'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z'
  ]) {
    assert.equal(out.includes(secret), false, secret);
  }
  assert.deepEqual(countsToList(counts), [
    { kind: 'api_key', count: 1 },
    { kind: 'authorization', count: 1 },
    { kind: 'email', count: 1 },
    { kind: 'env_secret', count: 1 },
    { kind: 'long_token', count: 2 },
    { kind: 'private_url', count: 1 }
  ]);
});

test('redact keeps paths, uuids, and slugs', () => {
  const counts = new Map();
  const text = '/Users/Me/Workspace2/very-long-project-name/src/index.ts 03e7c691-22f4-42fd-9919-480a352267a3 2026-09-22-skill-finder-design-long-name';
  assert.equal(redact(text, counts), text);
  assert.equal(counts.size, 0);
});

test('tokenize drops stop words and strips a plural s', () => {
  assert.deepEqual(tokenize('Write the HTTP request files for devices'), ['write', 'http', 'request', 'file', 'device']);
  assert.deepEqual(tokenize('status class analysis'), ['status', 'class', 'analysis']);
  assert.equal(normalizeText('  Hello,  World! '), 'hello world');
});

test('jaccard and overlap', () => {
  assert.equal(jaccard(['a1', 'b1'], ['a1', 'b1', 'c1', 'd1']), 0.5);
  assert.equal(overlap(['a1', 'b1'], ['a1', 'b1', 'c1', 'd1']), 1);
  assert.equal(overlap(new Set(), ['a1']), 0);
  assert.equal(jaccard([], []), 0);
});

test('commandPatterns keeps two-token commands and skips flags, paths, and noise', () => {
  assert.deepEqual(commandPatterns('pnpm test --filter sim && git status'), ['pnpm test', 'git status']);
  assert.deepEqual(commandPatterns('git -C /repo log'), []);
  assert.deepEqual(commandPatterns('cat README.md | grep foo'), []);
  assert.deepEqual(commandPatterns('FOO=1 ./scripts/deploy-sim.sh staging'), ['./scripts/deploy-sim.sh staging']);
  assert.deepEqual(commandPatterns('cat <<EOF > x\nhello world\nEOF'), []);
});

test('isLowInformationTitle flags empty, Unknown, and uuid titles', () => {
  assert.equal(isLowInformationTitle(''), true);
  assert.equal(isLowInformationTitle('Unknown'), true);
  assert.equal(isLowInformationTitle('03e7c691-22f4-42fd-9919-480a352267a3'), true);
  assert.equal(isLowInformationTitle('Deploy sim runner'), false);
});

test('encodeProjectPath replaces every non-alphanumeric character', () => {
  assert.equal(encodeProjectPath('/Users/me.name/work/my_app'), '-Users-me-name-work-my-app');
});

test('inWindow treats a date-only until as the end of that day', () => {
  assert.equal(inWindow('2026-09-02T23:00:00.000Z', { until: '2026-09-02' }), true);
  assert.equal(inWindow('2026-09-03T00:00:01.000Z', { until: '2026-09-02' }), false);
  assert.equal(inWindow('2026-08-31T10:00:00.000Z', { since: '2026-09-01' }), false);
  assert.equal(inWindow(null, {}), true);
});

test('utcDays and timeRange ignore bad timestamps', () => {
  const ts = ['2026-09-02T01:00:00.000Z', '2026-09-01T23:00:00.000Z', 'bad'];
  assert.deepEqual(utcDays(ts), ['2026-09-01', '2026-09-02']);
  assert.deepEqual(timeRange(ts), { startedAt: '2026-09-01T23:00:00.000Z', endedAt: '2026-09-02T01:00:00.000Z' });
  assert.deepEqual(timeRange([]), { startedAt: null, endedAt: null });
});

test('digestPath is source-prefixed and file-safe', () => {
  assert.equal(digestPath('claude-sessions:abc-123'), 'digests/claude-sessions__abc-123.md');
  assert.equal(digestPath('openspec-archive:2026-09-01-a b'), 'digests/openspec-archive__2026-09-01-a_b.md');
});

test('capDigest keeps the head and the tail within the cap', () => {
  const text = `HEAD${'x'.repeat(40000)}TAIL`;
  const capped = capDigest(text);
  assert.ok(Buffer.byteLength(capped) <= DIGEST_CAP);
  assert.ok(capped.startsWith('HEAD'));
  assert.ok(capped.endsWith('TAIL'));
  assert.match(capped, /\[\.\.\. digest cut/);
  assert.equal(capDigest('short'), 'short');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});
