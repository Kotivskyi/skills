#!/usr/bin/env node
// Adapter: Claude Code sessions -> evidence.jsonl + digests/.
// Knowledge for this source: references/sources/claude-sessions.md.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InputError, UsageError, emit, isMain, parseCli, runMain } from './lib/args.mjs';
import { appendJsonl, existingIds, readLines } from './lib/jsonl.mjs';
import { countsToList, redact } from './lib/redact.mjs';
import { commandPatterns } from './lib/tokens.mjs';
import { digestPath, encodeProjectPath, expandHome, inWindow, timeRange, utcDays, validWindowValue, windowBoundMs } from './lib/paths.mjs';
import { capDigest, truncate, writeDigest } from './lib/digest.mjs';

export const SOURCE = 'claude-sessions';

// `type` is not always the first key, so use a substring check, never a prefix check.
const KEEP_TYPES = ['"type":"user"', '"type":"assistant"', '"type":"ai-title"', '"type":"custom-title"'];
const SKIP_PREFIX = /^\s*<(local-command-caveat|local-command-stdout|local-command-stderr|bash-input|bash-stdout|bash-stderr|task-notification)/;
const CORRECTION_PATTERNS = [
  /^\s*(no|nope)\b/i,
  /\bnot that\b/i,
  /\binstead\b/i,
  /\byou forgot\b/i,
  /\bshould have\b/i,
  /\bthat'?s (wrong|not (right|what i))/i,
  /\bi (said|told you|asked you)\b/i
];
const REPEATED_PATTERNS = [/\b(always|never|remember|you need to|make sure)\b/i, /\bfirst\b[\s\S]{0,200}\bthen\b/i];
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export function cleanUserText(raw) {
  const source = String(raw ?? '');
  if (SKIP_PREFIX.test(source)) return { skip: true, command: null, text: '' };
  let text = source;
  let command = null;
  const name = source.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/);
  if (name) {
    command = name[1].startsWith('/') ? name[1] : `/${name[1]}`;
    const args = source.match(/<command-args>([\s\S]*?)<\/command-args>/);
    text = args ? args[1] : '';
  }
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (/^\[Request interrupted/.test(text)) text = '';
  return { skip: false, command, text };
}

export function isCorrection(text) {
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isRepeatedInstruction(text) {
  return text.length >= 80 && REPEATED_PATTERNS.some((pattern) => pattern.test(text));
}

// Only text a human typed. Skill bodies (isMeta), task notifications, and tool results are not intents.
function humanText(record) {
  if (record.isMeta) return null;
  const kind = record.origin?.kind;
  if (kind && kind !== 'human') return null;
  const content = record.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((block) => block?.type === 'tool_result')) return null;
  const texts = content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text);
  return texts.length ? texts.join('\n') : null;
}

export function newState() {
  return {
    timestamps: [],
    project: null,
    aiTitle: null,
    customTitle: null,
    intents: [],
    corrections: [],
    repeated: [],
    commands: new Map(),
    skills: new Map(),
    tools: {},
    patterns: new Map(),
    artifacts: new Set(),
    messageIds: new Set(),
    toolCalls: 0,
    sidechainToolCalls: 0,
    userMessages: 0,
    turns: [],
    turn: null,
    redactions: new Map()
  };
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// Collapses repeated one-liners: "[tool] Read" twice becomes "[tool] Read ×2".
function pushLine(turn, line) {
  if (!turn) return;
  const last = turn.lines[turn.lines.length - 1];
  const match = last?.match(/^(.*?)(?: ×(\d+))?$/);
  if (match && match[1] === line) turn.lines[turn.lines.length - 1] = `${line} ×${Number(match[2] ?? 1) + 1}`;
  else turn.lines.push(line);
}

function handleUser(record, lineNo, file, state) {
  const raw = humanText(record);
  if (raw === null) return;
  const cleaned = cleanUserText(raw);
  if (cleaned.skip) return;
  if (cleaned.command) bump(state.commands, cleaned.command);
  const text = redact(cleaned.text, state.redactions).trim();
  if (!text && !cleaned.command) return;
  state.userMessages += 1;
  state.turn = { user: text || cleaned.command, lines: [], finalText: '' };
  state.turns.push(state.turn);
  if (!text) return;
  const entry = { text: truncate(text, 600), pointer: { file, line: lineNo } };
  const first = state.intents.length === 0;
  state.intents.push(entry);
  if (!first && isCorrection(text)) state.corrections.push(entry);
  if (isRepeatedInstruction(text)) state.repeated.push(entry);
}

function handleAssistant(record, state, sidechain) {
  if (!sidechain) state.messageIds.add(record.message?.id ?? record.uuid);
  const content = Array.isArray(record.message?.content) ? record.message.content : [];
  for (const block of content) {
    if (block?.type === 'text' && !sidechain && state.turn && block.text?.trim()) state.turn.finalText = block.text;
    if (block?.type !== 'tool_use') continue;
    state.toolCalls += 1;
    if (sidechain) state.sidechainToolCalls += 1;
    state.tools[block.name] = (state.tools[block.name] ?? 0) + 1;
    const input = block.input ?? {};
    if (block.name === 'Skill' && typeof input.skill === 'string') {
      bump(state.skills, `${input.skill}\u0000${sidechain}`);
      if (!sidechain) pushLine(state.turn, `[skill] ${input.skill}`);
    } else if (block.name === 'Bash' && typeof input.command === 'string') {
      for (const pattern of commandPatterns(input.command)) bump(state.patterns, pattern);
      if (!sidechain) pushLine(state.turn, `[tool] Bash: ${truncate(input.command.split('\n')[0], 80)}`);
    } else {
      if (EDIT_TOOLS.has(block.name) && typeof input.file_path === 'string') state.artifacts.add(input.file_path);
      if (!sidechain) pushLine(state.turn, `[tool] ${block.name}`);
    }
  }
}

export async function parseTranscript(file, state, sidechain) {
  for await (const { line, n } of readLines(file)) {
    if (!KEEP_TYPES.some((type) => line.includes(type))) continue;
    // Tool results can be megabytes and are never used, so skip them before JSON.parse.
    if (line.includes('"type":"tool_result"')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type === 'ai-title') {
      if (record.aiTitle) state.aiTitle = record.aiTitle;
      continue;
    }
    if (record.type === 'custom-title') {
      if (record.customTitle) state.customTitle = record.customTitle;
      continue;
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    if (record.timestamp) state.timestamps.push(record.timestamp);
    if (!state.project && record.cwd) state.project = record.cwd;
    if (record.type === 'assistant') handleAssistant(record, state, sidechain);
    else if (!sidechain) handleUser(record, n, file, state);
  }
}

function relativeTo(project, file) {
  return project && file.startsWith(`${project}/`) ? file.slice(project.length + 1) : file;
}

export function buildRecord(sessionId, files, state) {
  const id = `${SOURCE}:${sessionId}`;
  const { startedAt, endedAt } = timeRange(state.timestamps);
  const fallback = state.intents[0] ? truncate(state.intents[0].text.split('\n')[0], 80) : 'Unknown';
  return {
    id,
    source: SOURCE,
    project: state.project,
    startedAt,
    endedAt,
    days: utcDays(state.timestamps),
    title: truncate(redact(state.customTitle || state.aiTitle || fallback, state.redactions), 200),
    intents: state.intents,
    skillsInvoked: [...state.skills]
      .map(([key, count]) => {
        const [name, side] = key.split('\u0000');
        return { name, count, sidechain: side === 'true' };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || Number(a.sidechain) - Number(b.sidechain)),
    commandsUsed: [...state.commands].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    toolsUsed: Object.fromEntries(Object.entries(state.tools).sort(([a], [b]) => a.localeCompare(b))),
    commandPatterns: [...state.patterns]
      .map(([pattern, count]) => ({ pattern: redact(pattern, state.redactions), count }))
      .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)),
    userCorrections: state.corrections,
    repeatedInstructions: state.repeated,
    artifacts: [...state.artifacts].slice(0, 50).map((file) => redact(relativeTo(state.project, file), state.redactions)),
    outcome: 'unknown',
    size: {
      userMessages: state.userMessages,
      assistantMessages: state.messageIds.size,
      toolCalls: state.toolCalls,
      sidechainToolCalls: state.sidechainToolCalls,
      bytes: files.reduce((sum, file) => sum + statSync(file).size, 0)
    },
    digest: digestPath(id),
    summary: null,
    redactions: []
  };
}

export function buildDigest(record, state) {
  const lines = [
    `# ${record.title}`,
    '',
    `- episode: ${record.id}`,
    `- source: ${record.source}`,
    `- project: ${record.project ?? 'unknown'}`,
    `- time: ${record.startedAt ?? '?'} .. ${record.endedAt ?? '?'}`,
    ''
  ];
  state.turns.forEach((turn, index) => {
    lines.push(`## Turn ${index + 1}`, `user: ${turn.user.replace(/\s+/g, ' ')}`);
    for (const line of turn.lines) lines.push(redact(line, state.redactions));
    if (turn.finalText) {
      lines.push(`assistant: ${truncate(redact(turn.finalText, state.redactions).replace(/\s+/g, ' ').trim(), 300)}`);
    }
    lines.push('');
  });
  // Second pass with a throwaway counter: nothing unredacted leaves this function.
  return capDigest(redact(lines.join('\n')));
}

function listSidechains(sessionDir) {
  const dir = path.join(sessionDir, 'subagents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^agent-.*\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

async function main(argv) {
  const { values } = parseCli(argv, {
    out: { type: 'string' },
    since: { type: 'string' },
    until: { type: 'string' },
    'max-episodes': { type: 'number' },
    project: { type: 'string' },
    store: { type: 'string', multiple: true },
    session: { type: 'string' },
    home: { type: 'string' }
  });
  if (!values.out) throw new UsageError('--out <run-dir> is required');
  for (const flag of ['since', 'until']) {
    if (values[flag] && !validWindowValue(values[flag])) throw new UsageError(`--${flag} needs an ISO date, got ${values[flag]}`);
  }
  const home = values.home ?? os.homedir();
  const stores = values.store.length
    ? values.store.map((store) => path.resolve(expandHome(store, home)))
    : [path.join(home, '.claude', 'projects', encodeProjectPath(values.project ?? process.cwd()))];
  for (const store of stores) {
    if (!existsSync(store) || !statSync(store).isDirectory()) throw new InputError(`claude-sessions: store not found or unreadable: ${store}`);
  }

  const runDir = path.resolve(values.out);
  await mkdir(path.join(runDir, 'digests'), { recursive: true });
  const evidenceFile = path.join(runDir, 'evidence.jsonl');
  const seen = await existingIds(evidenceFile);
  const sinceMs = windowBoundMs(values.since, false);
  let skipped = 0;
  let bytes = 0;
  const parsed = [];

  for (const store of stores) {
    for (const name of readdirSync(store).filter((file) => file.endsWith('.jsonl')).sort()) {
      const sessionId = name.slice(0, -'.jsonl'.length);
      if (values.session && sessionId !== values.session) continue;
      const file = path.join(store, name);
      const id = `${SOURCE}:${sessionId}`;
      if (seen.has(id)) {
        skipped += 1;
        continue;
      }
      // A session cannot start after its file was last written.
      if (sinceMs !== null && statSync(file).mtimeMs < sinceMs) {
        skipped += 1;
        continue;
      }
      const sidechains = listSidechains(path.join(store, sessionId));
      const state = newState();
      await parseTranscript(file, state, false);
      for (const sidechain of sidechains) await parseTranscript(sidechain, state, true);
      const record = buildRecord(sessionId, [file, ...sidechains], state);
      bytes += record.size.bytes;
      if (!state.timestamps.length || !inWindow(record.startedAt, values)) {
        skipped += 1;
        continue;
      }
      seen.add(id);
      parsed.push({ record, state });
    }
  }

  parsed.sort((a, b) => String(b.record.startedAt).localeCompare(String(a.record.startedAt)));
  const limit = values['max-episodes'];
  const kept = limit ? parsed.slice(0, limit) : parsed;
  skipped += parsed.length - kept.length;
  for (const { record, state } of kept) {
    await writeDigest(runDir, record.digest, buildDigest(record, state));
    record.redactions = countsToList(state.redactions);
  }
  kept.sort((a, b) => String(a.record.startedAt).localeCompare(String(b.record.startedAt)));
  await appendJsonl(evidenceFile, kept.map(({ record }) => record));
  emit({ source: SOURCE, episodes: kept.length, skipped, bytes });
}

if (isMain(import.meta.url)) runMain(main);
