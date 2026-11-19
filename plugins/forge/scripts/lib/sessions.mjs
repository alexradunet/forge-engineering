// The session list of one repository: <forge>/raw/sessions.jsonl, one JSON line for each fact about an agent session.
// The session hooks write it (forge.mjs hook session-start and session-end), so the list is there when no live server runs.
// The live server reads it and shows the sessions that are not live any more, with the command that continues each one.
// A line is small and complete, so two hooks can append at the same time. A line that does not parse is ignored.
// The file is local data: it holds folder paths and the first words of a prompt, and raw/ is never committed.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { harness, resumeText, sessionIdOk } from './harness.mjs';
import { cleanText, maskSecrets } from './live-event.mjs';
import { ticketOfSession } from './live.mjs';

export const SESSIONS_FILE = 'sessions.jsonl';
export const SESSIONS_VERSION = 1;
/** Above this size, the next session start writes the file again with the records of the last KEEP_MS only. */
export const MAX_BYTES = 256 * 1024;
/** Claude Code keeps a transcript for 30 days, so an older record cannot resume. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** A closed session without a ticket shows on the board for this time. */
export const OTHER_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_OTHER = 10;
export const MAX_TICKET = 10;
const LIMIT = { cwd: 1024, title: 200, label: 120, word: 40 };
// The start sources of Claude Code and of Copilot CLI that mean "a person started the harness in this folder".
const LAUNCH = ['startup', 'new', 'resume', 'fork'];
// A session that ended with one of these reasons has a newer session in its place.
const HIDDEN = ['clear'];

const str = (value) => (typeof value === 'string' ? value : '');
const label = (value) => cleanText(maskSecrets(cleanText(value, 1000)), LIMIT.label);

export function sessionsFile(raw) {
  return path.join(raw, SESSIONS_FILE);
}

function append(raw, line) {
  mkdirSync(raw, { recursive: true });
  appendFileSync(sessionsFile(raw), `${JSON.stringify({ v: SESSIONS_VERSION, ...line })}\n`, { mode: 0o600 });
  return true;
}

/**
 * Records that a session started, continued, or was seen. False when the host has no row in the harness table,
 * or when the id does not have the shape of its session ids: then nothing is written.
 */
export function recordStart(raw, { host, id, cwd = '', title = '', prompt = '', source = '' }, now = Date.now()) {
  if (!raw || !sessionIdOk(host, id)) return false;
  try { if (statSync(sessionsFile(raw)).size > MAX_BYTES) compact(raw, now); } catch { /* No file yet. */ }
  const line = { e: 'start', host, id, cwd: str(cwd).slice(0, LIMIT.cwd), ts: now };
  if (cleanText(title, LIMIT.title)) line.title = cleanText(title, LIMIT.title);
  if (label(prompt)) line.label = label(prompt);
  if (cleanText(source, LIMIT.word)) line.source = cleanText(source, LIMIT.word);
  return append(raw, line);
}

/** Records that a session ended. The line has the host and the folder, so a session whose start has no line can still resume. */
export function recordEnd(raw, { host, id, cwd = '', reason = '' }, now = Date.now()) {
  if (!raw || !sessionIdOk(host, id)) return false;
  const line = { e: 'end', host, id, cwd: str(cwd).slice(0, LIMIT.cwd), ts: now };
  if (cleanText(reason, LIMIT.word)) line.reason = cleanText(reason, LIMIT.word);
  return append(raw, line);
}

/** Records the first words of the first prompt as the label of a session without a title. */
export function recordLabel(raw, { host, id, text }, now = Date.now()) {
  if (!raw || !sessionIdOk(host, id) || !label(text)) return false;
  return append(raw, { e: 'label', host, id, label: label(text), ts: now });
}

function fold(records, line) {
  if (!line || typeof line !== 'object' || line.v !== SESSIONS_VERSION || !sessionIdOk(line.host, line.id)) return;
  const ts = Number.isFinite(line.ts) && line.ts > 0 ? line.ts : 0;
  if (!ts || !['start', 'end', 'label'].includes(line.e)) return;
  let record = records.get(line.id);
  if (!record) {
    if (line.e === 'label') return;
    record = { host: line.host, id: line.id, cwd: '', title: '', label: '', start: ts, end: 0, reason: '' };
    records.set(line.id, record);
  }
  if (record.host !== line.host) return;
  // The folder of a session is the folder of its start, or of its last resume. The folder of a later hook can be another one:
  // an agent can change the folder of its shell, and a session must continue in the folder of its project.
  if (str(line.cwd) && (!record.cwd || (line.e === 'start' && LAUNCH.includes(line.source)))) record.cwd = str(line.cwd).slice(0, LIMIT.cwd);
  if (line.e === 'start') {
    record.start = Math.max(record.start, ts);
    // A start after the end is a session that continues.
    if (ts >= record.end) { record.end = 0; record.reason = ''; }
    if (cleanText(line.title, LIMIT.title)) record.title = cleanText(line.title, LIMIT.title);
    if (!record.label && label(line.label)) record.label = label(line.label);
  } else if (line.e === 'end') {
    if (ts >= record.start) { record.end = ts; record.reason = cleanText(line.reason, LIMIT.word); }
  } else if (!record.label) record.label = label(line.label);
}

/** The records of the file, by session id: { host, id, cwd, title, label, start, end, reason }. `end` is 0 when no end was seen. */
export function readSessions(raw) {
  const records = new Map();
  let text = '';
  try { text = readFileSync(sessionsFile(raw), 'utf8'); } catch { return records; }
  for (const row of text.split('\n')) {
    if (!row.trim()) continue;
    try { fold(records, JSON.parse(row)); } catch { /* A line that another program cut. */ }
  }
  return records;
}

/** Writes the file again with one start line (and one end line) for each record of the last KEEP_MS. */
export function compact(raw, now = Date.now()) {
  const lines = [];
  for (const record of readSessions(raw).values()) {
    if (now - Math.max(record.start, record.end) > KEEP_MS) continue;
    const start = { v: SESSIONS_VERSION, e: 'start', host: record.host, id: record.id, cwd: record.cwd, ts: record.start };
    if (record.title) start.title = record.title;
    if (record.label) start.label = record.label;
    lines.push(JSON.stringify(start));
    if (record.end) lines.push(JSON.stringify({ v: SESSIONS_VERSION, e: 'end', host: record.host, id: record.id, cwd: record.cwd, ts: record.end, ...(record.reason ? { reason: record.reason } : {}) }));
  }
  const file = sessionsFile(raw);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  renameSync(temp, file);
}

const norm = (folder) => String(folder ?? '').replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * The sessions of the list that are not live now, the newest first, for the pages:
 * { id, host, name, label, dir, ticket, state, at, command }.
 * `state` is `closed` (the end was seen) or `open` (no end was seen: the session can still run in a terminal).
 * `live` is the state of live.mjs: a session that it holds and that did not end is not in the result.
 * A session with a ticket stays for KEEP_MS, and at most MAX_TICKET show for one ticket. Another session stays for OTHER_MS, and at most MAX_OTHER show.
 */
export function pastSessions(records, live, tickets = [], now = Date.now()) {
  const out = [];
  for (const record of records.values()) {
    if (HIDDEN.includes(record.reason)) continue;
    const running = live?.sessions.get(record.id);
    if (running && running.state !== 'ended') continue;
    // The live server saw the end, and the end hook wrote no line (it has little time): the session is closed.
    const ended = Boolean(record.end) || Boolean(running);
    const at = record.end || (running ? running.since : record.start);
    const ticket = ticketOfSession({ title: record.title, cwd: record.cwd }, tickets);
    if (now - at > (ticket ? KEEP_MS : OTHER_MS)) continue;
    const dir = norm(record.cwd).split('/').pop() ?? '';
    out.push({
      id: record.id, host: record.host, name: harness(record.host).name, label: record.title || record.label || dir, dir, ticket,
      state: ended ? 'closed' : 'open', at, command: resumeText(record.host, record.id, record.cwd),
    });
  }
  out.sort((a, b) => b.at - a.at);
  const count = new Map();
  return out.filter((item) => {
    const key = item.ticket || '';
    count.set(key, (count.get(key) ?? 0) + 1);
    return count.get(key) <= (key ? MAX_TICKET : MAX_OTHER);
  });
}
