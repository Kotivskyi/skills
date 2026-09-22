// The first four rules match the sibling normalizer in agent-self-harness.
const EMAIL_SOURCE = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';

// Non-global, so .test() has no lastIndex state.
export const EMAIL_TEST = new RegExp(EMAIL_SOURCE);

const RULES = [
  { kind: 'env_secret', pattern: /\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^"'\s]+/g, replace: () => '[REDACTED_ENV_SECRET]' },
  { kind: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]+/g, replace: () => '[REDACTED_API_KEY]' },
  { kind: 'authorization', pattern: /\bBearer\s+[A-Za-z0-9._-]+/g, replace: () => 'Bearer [REDACTED]' },
  { kind: 'private_url', pattern: /https?:\/\/(?:private|internal|[^"'\s/]*\.internal)[^"'\s)]+/g, replace: () => '[REDACTED_PRIVATE_URL]' },
  { kind: 'email', pattern: new RegExp(EMAIL_SOURCE, 'g'), replace: () => '[REDACTED_EMAIL]' },
  { kind: 'long_token', pattern: /\b[0-9a-fA-F]{32,}\b/g, replace: () => '[REDACTED_TOKEN]' },
  { kind: 'long_token', pattern: /[A-Za-z0-9+/=_-]{32,}/g, replace: (match) => (looksLikeSecret(match) ? '[REDACTED_TOKEN]' : null) }
];

// A base64-like run is a secret when it mixes cases and digits and is not a path.
export function looksLikeSecret(token) {
  if (/^[~.]?\//.test(token) || /\/[a-z0-9._-]+\//.test(token)) return false;
  return /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

export function redact(text, counts = new Map()) {
  let output = String(text ?? '');
  for (const rule of RULES) {
    output = output.replace(rule.pattern, (match) => {
      const value = rule.replace(match);
      if (value === null) return match;
      counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
      return value;
    });
  }
  return output;
}

export function countsToList(counts) {
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}
