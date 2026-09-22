import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DIGEST_CAP = 24 * 1024;
export const DIGEST_TAIL = 8 * 1024;

export function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Keeps the head and the last 8 KB, marks the cut, and stays within 24 KB.
export function capDigest(text) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= DIGEST_CAP) return text;
  const marker = `\n\n[... digest cut, original ${buffer.length} bytes ...]\n\n`;
  const headBytes = DIGEST_CAP - DIGEST_TAIL - Buffer.byteLength(marker) - 8;
  const head = buffer.subarray(0, headBytes).toString('utf8');
  const tail = buffer.subarray(buffer.length - DIGEST_TAIL).toString('utf8');
  return `${head}${marker}${tail}`;
}

export async function writeDigest(runDir, relPath, text) {
  const file = path.join(runDir, relPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
