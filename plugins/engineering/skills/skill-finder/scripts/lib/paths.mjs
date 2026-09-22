import os from 'node:os';
import path from 'node:path';

// Claude Code stores ~/.claude/projects/<encoded-cwd>/. Every character that
// is not a letter or a digit becomes "-".
export function encodeProjectPath(projectPath) {
  return path.resolve(projectPath).replace(/[^A-Za-z0-9]/g, '-');
}

export function expandHome(value, home = os.homedir()) {
  if (!value) return value;
  return value === '~' || value.startsWith('~/') ? path.join(home, value.slice(1)) : value;
}

// A date-only bound covers the whole UTC day.
export function windowBoundMs(value, endOfDay) {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function validWindowValue(value) {
  return windowBoundMs(value, false) !== null;
}

export function inWindow(iso, { since, until } = {}) {
  const sinceMs = windowBoundMs(since, false);
  const untilMs = windowBoundMs(until, true);
  if (sinceMs === null && untilMs === null) return true;
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(time)) return false;
  if (sinceMs !== null && time < sinceMs) return false;
  if (untilMs !== null && time > untilMs) return false;
  return true;
}

function validTimes(timestamps) {
  return timestamps.map((value) => Date.parse(value)).filter((ms) => !Number.isNaN(ms));
}

export function utcDays(timestamps) {
  return [...new Set(validTimes(timestamps).map((ms) => new Date(ms).toISOString().slice(0, 10)))].sort();
}

export function timeRange(timestamps) {
  const times = validTimes(timestamps);
  if (!times.length) return { startedAt: null, endedAt: null };
  const min = times.reduce((a, b) => (b < a ? b : a));
  const max = times.reduce((a, b) => (b > a ? b : a));
  return { startedAt: new Date(min).toISOString(), endedAt: new Date(max).toISOString() };
}

export function digestPath(id) {
  const [source, ...rest] = String(id).split(':');
  return `digests/${source}__${rest.join(':').replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
}
