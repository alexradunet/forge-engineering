// The session list (<forge>/raw/sessions.jsonl) and the harness table: what a hook writes, how the lines fold into records,
// and which sessions a page gets with the command that continues them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HARNESSES, harness, resumeArgv, resumeText, sessionIdOk } from '../plugins/forge/scripts/lib/harness.mjs';
import { HOSTS } from '../plugins/forge/scripts/lib/hook.mjs';
import { createLive, reduce } from '../plugins/forge/scripts/lib/live.mjs';
import { KEEP_MS, MAX_BYTES, MAX_OTHER, MAX_TICKET, OTHER_MS, compact, pastSessions, readSessions, recordEnd, recordLabel, recordStart, sessionsFile } from '../plugins/forge/scripts/lib/sessions.mjs';

const A = '11111111-2222-4333-8444-555555555555';
const B = '99999999-2222-4333-8444-555555555555';
const DAY = 24 * 60 * 60 * 1000;

function raw(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-sessions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'raw');
}
const lines = (dir) => readFileSync(sessionsFile(dir), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

test('the harness table has the terminal harnesses, and a session id never reads as an option', () => {
  assert.deepEqual(HARNESSES.map((row) => row.id), ['claude', 'copilot-cli']);
  for (const row of HARNESSES) assert.ok(HOSTS.includes(row.id), `${row.id} is a host of the hooks`);
  assert.equal(harness('vscode'), null, 'the VS Code Agents window has no terminal session');
  assert.equal(harness('pi'), null);
  assert.deepEqual(resumeArgv('claude', A), ['claude', '--resume', A]);
  assert.deepEqual(resumeArgv('copilot-cli', 'abc_1-x'), ['copilot', '--resume=abc_1-x']);
  // A planted line of the session list cannot add an option or a second command.
  for (const id of ['--dangerously-skip-permissions', '-p', 'abc', `${A} --x`, `${A};id`, '', undefined, 7]) assert.equal(resumeArgv('claude', id), null, String(id));
  for (const id of ['--allow-all', '-x', 'a b', 'a;b', 'a$(id)', '../x', '', 'x'.repeat(129)]) assert.equal(sessionIdOk('copilot-cli', id), false, id);
  assert.equal(resumeArgv('vscode', A), null);
  assert.equal(resumeText('claude', A, '/code/app'), `cd "/code/app"; claude --resume ${A}`);
  assert.equal(resumeText('copilot-cli', 'cp-1', 'C:\\code\\my app'), 'cd "C:\\code\\my app"; copilot --resume=cp-1');
  assert.equal(resumeText('claude', A), `claude --resume ${A}`);
  for (const folder of ['/code/a"b', '/code/$HOME', '/code/a`id`']) assert.equal(resumeText('claude', A, folder), `claude --resume ${A}`, 'a folder that a shell reads gives no cd part');
  assert.equal(resumeText('claude', 'abc', '/code/app'), '');
});

test('a hook writes one small line for each fact, and only for a session of a terminal harness', (t) => {
  const dir = raw(t);
  assert.equal(recordStart(dir, { host: 'vscode', id: A, cwd: '/code/app' }, 1000), false);
  assert.equal(recordStart(dir, { host: 'claude', id: 'S1', cwd: '/code/app' }, 1000), false);
  assert.equal(recordStart('', { host: 'claude', id: A, cwd: '/code/app' }, 1000), false);
  assert.equal(recordEnd(dir, { host: 'claude', id: '-x' }, 1000), false);
  assert.equal(recordLabel(dir, { host: 'claude', id: A, text: '   ' }, 1000), false);
  assert.ok(!existsSync(dir), 'nothing was written');

  assert.equal(recordStart(dir, { host: 'claude', id: A, cwd: '/code/app', title: ' APP-9 - ▶️ - Fix retry\n', prompt: 'curl -H "Authorization: Bearer abcdefgh1234" x', source: 'startup' }, 1000), true);
  assert.equal(recordLabel(dir, { host: 'claude', id: A, text: 'First prompt' }, 1500), true);
  assert.equal(recordEnd(dir, { host: 'claude', id: A, cwd: '/code/app', reason: 'prompt_input_exit' }, 2000), true);
  assert.deepEqual(lines(dir), [
    { v: 1, e: 'start', host: 'claude', id: A, cwd: '/code/app', ts: 1000, title: 'APP-9 - ▶️ - Fix retry', label: 'curl -H "Authorization: *** ***" x', source: 'startup' },
    { v: 1, e: 'label', host: 'claude', id: A, label: 'First prompt', ts: 1500 },
    { v: 1, e: 'end', host: 'claude', id: A, cwd: '/code/app', ts: 2000, reason: 'prompt_input_exit' },
  ]);
  if (process.platform !== 'win32') assert.equal(statSync(sessionsFile(dir)).mode & 0o777, 0o600);
  assert.ok(lines(dir).every((line) => JSON.stringify(line).length < 4096), 'a line is small, so two hooks can append at the same time');
  recordStart(dir, { host: 'copilot-cli', id: 'cp-1', cwd: '/code/app', prompt: 'x'.repeat(400) }, 3000);
  assert.ok(lines(dir).at(-1).label.length <= 120);
});

test('the lines fold into one record for each session: a start after the end opens it again', (t) => {
  const dir = raw(t);
  assert.equal(readSessions(dir).size, 0, 'no file is an empty list');
  recordStart(dir, { host: 'claude', id: A, cwd: '/code/app', source: 'startup' }, 1000);
  recordLabel(dir, { host: 'claude', id: A, text: 'First prompt' }, 1100);
  recordLabel(dir, { host: 'claude', id: A, text: 'Second prompt' }, 1200);
  assert.deepEqual(readSessions(dir).get(A), { host: 'claude', id: A, cwd: '/code/app', title: '', label: 'First prompt', start: 1000, end: 0, reason: '' });
  // The folder of the end hook can be another one (the agent changed the folder of its shell): the session keeps the folder of its start.
  recordEnd(dir, { host: 'claude', id: A, cwd: '/code/app.forge/raw/tickets/app-9', reason: 'other' }, 2000);
  assert.deepEqual([readSessions(dir).get(A).end, readSessions(dir).get(A).reason, readSessions(dir).get(A).cwd], [2000, 'other', '/code/app']);
  // An event that the reporter sent before the end can come after it: it does not open the session again.
  recordStart(dir, { host: 'claude', id: A, cwd: '/code/app.worktrees/app-9', title: 'APP-9 - ▶️ - Fix retry', source: 'title' }, 1900);
  assert.deepEqual([readSessions(dir).get(A).end, readSessions(dir).get(A).title, readSessions(dir).get(A).cwd], [2000, 'APP-9 - ▶️ - Fix retry', '/code/app']);
  // A resume in another folder (the ticket worktree) is the new folder of the session. A compaction is not.
  recordStart(dir, { host: 'claude', id: A, cwd: '/code/app.worktrees/app-9', source: 'resume' }, 3000);
  assert.deepEqual([readSessions(dir).get(A).end, readSessions(dir).get(A).reason, readSessions(dir).get(A).start, readSessions(dir).get(A).cwd], [0, '', 3000, '/code/app.worktrees/app-9']);
  recordStart(dir, { host: 'claude', id: A, cwd: '/code/app.worktrees/app-9/src', source: 'compact' }, 3500);
  assert.equal(readSessions(dir).get(A).cwd, '/code/app.worktrees/app-9');
  // An end without a start line (a session that started before this plugin version) is still a record.
  recordEnd(dir, { host: 'copilot-cli', id: 'cp-1', cwd: '/code/app', reason: 'user_exit' }, 4000);
  assert.deepEqual(readSessions(dir).get('cp-1'), { host: 'copilot-cli', id: 'cp-1', cwd: '/code/app', title: '', label: '', start: 4000, end: 4000, reason: 'user_exit' });

  // A line that is cut, of another version, of an unknown host, with a bad id, or of another host than the record changes nothing.
  const before = JSON.stringify([...readSessions(dir)]);
  appendFileSync(sessionsFile(dir), [
    '{"v":1,"e":"start","host":"claude","id":"', 'not json', '[1]', 'null',
    JSON.stringify({ v: 2, e: 'start', host: 'claude', id: B, cwd: '/x', ts: 5000 }),
    JSON.stringify({ v: 1, e: 'start', host: 'vscode', id: B, cwd: '/x', ts: 5000 }),
    JSON.stringify({ v: 1, e: 'start', host: 'claude', id: '--resume', cwd: '/x', ts: 5000 }),
    JSON.stringify({ v: 1, e: 'run', host: 'claude', id: B, cwd: '/x', ts: 5000 }),
    JSON.stringify({ v: 1, e: 'start', host: 'claude', id: B, cwd: '/x', ts: 'now' }),
    JSON.stringify({ v: 1, e: 'label', host: 'claude', id: B, label: 'no record', ts: 5000 }),
    JSON.stringify({ v: 1, e: 'end', host: 'copilot-cli', id: A, cwd: '/x', ts: 5000 }),
    '',
  ].join('\n'));
  assert.equal(JSON.stringify([...readSessions(dir)]), before);
});

test('a large file is written again with the records of the last 30 days', (t) => {
  const dir = raw(t);
  const now = 100 * DAY;
  recordStart(dir, { host: 'claude', id: A, cwd: '/code/app', title: 'Old' }, now - KEEP_MS - DAY);
  recordEnd(dir, { host: 'claude', id: A, cwd: '/code/app', reason: 'other' }, now - KEEP_MS - 1000);
  recordStart(dir, { host: 'claude', id: B, cwd: '/code/app', title: 'New', prompt: 'A prompt' }, now - DAY);
  recordEnd(dir, { host: 'claude', id: B, cwd: '/code/app', reason: 'logout' }, now - 1000);
  compact(dir, now);
  assert.deepEqual(lines(dir), [
    { v: 1, e: 'start', host: 'claude', id: B, cwd: '/code/app', ts: now - DAY, title: 'New', label: 'A prompt' },
    { v: 1, e: 'end', host: 'claude', id: B, cwd: '/code/app', ts: now - 1000, reason: 'logout' },
  ]);
  // The next start of a session does it when the file is above the limit.
  writeFileSync(sessionsFile(dir), `${readFileSync(sessionsFile(dir), 'utf8')}${`${' '.repeat(1023)}\n`.repeat(Math.ceil(MAX_BYTES / 1024) + 1)}`);
  recordStart(dir, { host: 'copilot-cli', id: 'cp-1', cwd: '/code/app' }, now);
  assert.equal(lines(dir).length, 3);
  assert.ok(statSync(sessionsFile(dir)).size < 1024);
  assert.deepEqual([...readSessions(dir).keys()], [B, 'cp-1']);
});

test('a page gets the sessions that are not live, the newest first, with the ticket and the command', (t) => {
  const dir = raw(t);
  const now = 100 * DAY;
  const tickets = [{ key: 'APP-9', folder: 'app-9', worktree: '/code/app.worktrees/app-9' }];
  recordStart(dir, { host: 'claude', id: A, cwd: '/code/app.worktrees/app-9/src', prompt: 'Fix the retry' }, now - 5000);
  recordEnd(dir, { host: 'claude', id: A, cwd: '/code/app.worktrees/app-9/src', reason: 'prompt_input_exit' }, now - 4000);
  recordStart(dir, { host: 'copilot-cli', id: 'cp-1', cwd: '/code/app', title: 'APP-9 - ▶️ - Fix retry' }, now - 3000);
  recordStart(dir, { host: 'copilot-cli', id: 'cp-2', cwd: 'C:\\code\\app' }, now - 2000);
  assert.deepEqual(pastSessions(readSessions(dir), createLive(), tickets, now), [
    { id: 'cp-2', host: 'copilot-cli', name: 'Copilot CLI', label: 'app', dir: 'app', ticket: '', state: 'open', at: now - 2000, command: 'cd "C:\\code\\app"; copilot --resume=cp-2' },
    { id: 'cp-1', host: 'copilot-cli', name: 'Copilot CLI', label: 'APP-9 - ▶️ - Fix retry', dir: 'app', ticket: 'app-9', state: 'open', at: now - 3000, command: 'cd "/code/app"; copilot --resume=cp-1' },
    { id: A, host: 'claude', name: 'Claude Code', label: 'Fix the retry', dir: 'src', ticket: 'app-9', state: 'closed', at: now - 4000, command: `cd "/code/app.worktrees/app-9/src"; claude --resume ${A}` },
  ]);

  // A session that the live server holds shows as a live session. After its end it is a closed row, also when the end hook wrote no line.
  const live = createLive();
  const event = (name, session, ts, extra = {}) => reduce(live, { v: 1, host: 'copilot-cli', event: name, ts, session, cwd: '/code/app', ...extra });
  event('prompt', 'cp-1', now - 2500);
  assert.deepEqual(pastSessions(readSessions(dir), live, tickets, now).map((item) => item.id), ['cp-2', A]);
  event('session-end', 'cp-1', now - 1000);
  assert.deepEqual(pastSessions(readSessions(dir), live, tickets, now).map((item) => [item.id, item.state, item.at]), [['cp-1', 'closed', now - 1000], ['cp-2', 'open', now - 2000], [A, 'closed', now - 4000]]);

  // /clear starts a new session in the place of the old one: the old one does not show.
  recordEnd(dir, { host: 'copilot-cli', id: 'cp-2', cwd: '/code/app', reason: 'clear' }, now - 500);
  assert.ok(!pastSessions(readSessions(dir), createLive(), tickets, now).some((item) => item.id === 'cp-2'));
});

test('a session without a ticket shows for 7 days, a session of a ticket for 30 days, and each list has a limit', (t) => {
  const dir = raw(t);
  const now = 100 * DAY;
  const tickets = [{ key: 'APP-9', folder: 'app-9', worktree: '/code/app.worktrees/app-9' }];
  const hex = (n) => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
  recordStart(dir, { host: 'claude', id: hex(1), cwd: '/code/app' }, now - OTHER_MS - 1000);
  recordStart(dir, { host: 'claude', id: hex(2), cwd: '/code/app' }, now - OTHER_MS + 1000);
  recordStart(dir, { host: 'claude', id: hex(3), cwd: '/code/app.worktrees/app-9' }, now - OTHER_MS - 1000);
  recordStart(dir, { host: 'claude', id: hex(4), cwd: '/code/app.worktrees/app-9' }, now - KEEP_MS - 1000);
  assert.deepEqual(pastSessions(readSessions(dir), null, tickets, now).map((item) => item.id), [hex(2), hex(3)]);
  for (let n = 10; n < 10 + MAX_OTHER + 5; n++) recordStart(dir, { host: 'claude', id: hex(n), cwd: '/code/app' }, now - n);
  for (let n = 50; n < 50 + MAX_TICKET + 5; n++) recordStart(dir, { host: 'claude', id: hex(n), cwd: '/code/app.worktrees/app-9' }, now - n);
  const shown = pastSessions(readSessions(dir), null, tickets, now);
  assert.equal(shown.filter((item) => !item.ticket).length, MAX_OTHER);
  assert.equal(shown.filter((item) => item.ticket === 'app-9').length, MAX_TICKET);
  assert.equal(shown[0].id, hex(10), 'the newest first');
});
