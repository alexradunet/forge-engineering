// The live view: the event that a session hook sends, and the state that the live server makes from the events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, checkEvent, cleanText, maskSecrets, normalize, toolLabel } from '../plugins/forge/scripts/lib/live-event.mjs';
import { ENDED_MS, GONE_MS, MAX_ITEMS, QUIET_MS, createLive, prune, reduce, summary, ticketOfSession } from '../plugins/forge/scripts/lib/live.mjs';

const char = (code) => String.fromCharCode(code);
const CWD = '/code/app.worktrees/APP-9';
const claude = (name, extra = {}) => ({ hook_event_name: name, session_id: 'S1', cwd: CWD, transcript_path: '/home/u/.claude/x.jsonl', permission_mode: 'default', ...extra });

// One event for the reducer, with the defaults of a Claude Code session.
let clock = 1000;
const ev = (event, extra = {}) => checkEvent({ v: 1, host: 'claude', event, ts: extra.ts ?? (clock += 10), session: 'S1', cwd: CWD, ...extra });
const tool = (id, name, label = '', more = {}) => ({ id, name, label, ...more });
const feed = (state, ...events) => { for (const event of events) { assert.ok(event, 'the event is valid'); reduce(state, event); } return state; };
const one = (state, tickets = []) => summary(state, tickets, clock)[0];
// The calls and the subagents that the reducer keeps for the session S1: summary() shows only the call that runs and the count of subagents.
const calls = (state) => [...state.sessions.get('S1').tools.values()];
const agents = (state) => state.sessions.get('S1').agents;

test('the reporter makes a small event from a Claude Code payload: a short label, and no tool result', () => {
  const start = normalize('', claude('PreToolUse', { tool_name: 'Bash', tool_use_id: 'T1', tool_input: { command: `npm test\n  --   ${'x'.repeat(200)}` } }), 'claude', 5);
  assert.deepEqual(Object.keys(start), ['v', 'host', 'event', 'ts', 'session', 'cwd', 'tool']);
  assert.equal(start.event, 'tool-start');
  assert.equal(start.ts, 5);
  assert.equal(start.tool.id, 'T1');
  assert.ok(start.tool.label.startsWith('npm test -- xxx') && start.tool.label.length <= 80, start.tool.label);

  const secret = normalize('', claude('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer abc.DEF-123456" --token s3cr3tvalue https://x.test?api_key=K9' } }), 'claude');
  assert.doesNotMatch(secret.tool.label, /abc\.DEF|s3cr3tvalue|K9/);
  assert.match(secret.tool.label, /\*\*\*/);

  const file = (path) => normalize('', claude('PreToolUse', { tool_name: 'Read', tool_input: { file_path: path } }), 'claude').tool.label;
  assert.equal(file(`${CWD}/src/a.mjs`), 'src/a.mjs', 'a file of the session folder shows as a relative path');
  assert.equal(file('/home/user/private/notes/b.md'), '.../notes/b.md', 'another file shows only its last two names');

  // The result of a tool never goes on. Only the id of a new subagent does.
  const end = normalize('', claude('PostToolUse', { tool_name: 'Read', tool_use_id: 'T2', tool_input: { file_path: `${CWD}/a` }, tool_response: { content: 'FILE CONTENT', agentId: 'not-an-agent-call' }, duration_ms: 31.4 }), 'claude');
  assert.deepEqual(end.tool, { id: 'T2', name: 'Read', label: 'a', ok: true, ms: 31 });
  assert.doesNotMatch(JSON.stringify(end), /FILE CONTENT|transcript|permission/);
  const agent = normalize('', claude('PostToolUse', { tool_name: 'Agent', tool_use_id: 'T3', tool_input: { description: 'Review the diff', subagent_type: 'reviewer', prompt: 'LONG PROMPT' }, tool_response: { agentId: 'A1', status: 'async_launched', text: 'RESULT' } }), 'claude');
  assert.deepEqual(agent.tool, { id: 'T3', name: 'Agent', label: 'Review the diff', sub: 'reviewer', ok: true, child: 'A1' });
  assert.doesNotMatch(JSON.stringify(agent), /LONG PROMPT|RESULT/);
  assert.equal(normalize('', claude('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'false' } }), 'claude').tool.ok, false);

  // A tool that the list does not name gets no label: its input can hold any data.
  assert.equal(toolLabel('mcp__db__query', { sql: 'select secret' }), '');
  assert.equal(toolLabel('WebFetch', { url: 'https://example.test/path?token=1' }), 'example.test');

  const inside = normalize('', claude('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'checkRequest' }, agent_id: 'A1', agent_type: 'Explore' }), 'claude');
  assert.deepEqual(inside.agent, { id: 'A1', type: 'Explore' });
  assert.equal(inside.tool.label, 'checkRequest');
});

test('the reporter reads each event that the hooks file names, in both payload styles', () => {
  const prompt = normalize('', claude('UserPromptSubmit', { prompt: `run the review\n${'y'.repeat(2000)}`, session_title: 'APP-9 - ▶️ - Fix outbox retry' }), 'claude');
  assert.equal(prompt.event, 'prompt');
  assert.equal(prompt.title, 'APP-9 - ▶️ - Fix outbox retry');
  assert.ok(prompt.text.startsWith('run the review y') && prompt.text.length <= 1000);
  const own = normalize('', claude('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>a1</task-id>\n<result>Done ticket: APP-2</result>' }), 'claude');
  assert.deepEqual([own.event, own.text, own.kind], ['prompt', undefined, 'own-turn'], 'A turn that Claude Code started by itself gives no prompt text.');
  assert.deepEqual([checkEvent(own).kind, checkEvent(own).text], ['own-turn', undefined]);
  assert.equal(normalize('', claude('UserPromptSubmit', { prompt: '  Another Claude session sent a message:\n<agent-message from="x">hi</agent-message>' }), 'claude').text, undefined);
  assert.equal(normalize('', claude('UserPromptSubmit', { prompt: 'see the task-notification text' }), 'claude').text, 'see the task-notification text');
  assert.deepEqual(normalize('', claude('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }), 'claude').kind, 'permission_prompt');
  assert.equal(normalize('', claude('SubagentStop', { agent_id: 'A1', agent_type: 'Explore', last_assistant_message: 'Found 3 files.', agent_transcript_path: '/x/y.jsonl' }), 'claude').text, undefined, 'A stop sends no text: no page shows it.');
  assert.equal(normalize('', claude('Stop', { last_assistant_message: 'The tests pass.' }), 'claude').text, undefined);
  assert.equal(normalize('', claude('StopFailure'), 'claude').kind, 'failed');
  assert.equal(normalize('', claude('SessionStart', { source: 'resume' }), 'claude').kind, 'resume');
  assert.equal(normalize('', claude('SessionEnd', { reason: 'prompt_input_exit' }), 'claude').event, 'session-end');
  const names = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'SessionEnd'];
  const made = new Set(names.map((name) => normalize('', claude(name, { tool_name: 'Bash', agent_id: 'A' }), 'claude').event));
  assert.deepEqual([...made].sort(), [...EVENTS].sort(), 'each kind of live event has a hook event');

  // The Copilot hosts: camelCase, the event name as an argument, and the tool arguments as JSON text.
  const copilot = normalize('postToolUse', { sessionId: 'C1', cwd: 'C:\\code\\app', toolName: 'bash', toolArgs: JSON.stringify({ command: 'git status' }), agentId: 'A2', agentType: 'explore', parentAgentId: 'A1' }, 'copilot-cli');
  assert.deepEqual(copilot.tool, { id: '', name: 'bash', label: 'git status', ok: true });
  assert.deepEqual(copilot.agent, { id: 'A2', type: 'explore', parent: 'A1' });
  assert.equal(copilot.host, 'copilot-cli');

  for (const bad of [null, [], 'text', {}, { hook_event_name: 'PreToolUse' }, claude('PermissionRequest'), claude('MessageDisplay'), claude('__proto__')]) assert.equal(normalize('', bad, 'claude'), null);
});

test('the text of an event is one clean line, and a secret value gets a mask', () => {
  const dirty = `a${char(27)}[31mb\r\nc${char(0x2028)}d${char(0x9b)}e${char(0)}f`;
  assert.equal(cleanText(dirty, 100), 'a [31mb c d e f');
  assert.equal(cleanText('x'.repeat(50), 20).length, 20);
  assert.equal(cleanText(12, 20), '', 'only text is text');
  assert.equal(maskSecrets('export GITHUB_TOKEN=ghp_abc123 && run'), 'export GITHUB_TOKEN=*** && run');
  assert.equal(maskSecrets('mysql --password hunter2 -u root'), 'mysql --password *** -u root');
  assert.equal(maskSecrets('git commit -m "token handling"'), 'git commit -m "token handling"', 'a secret word without a value stays');
});

test('the server checks each event again: wrong shapes are refused, and unknown fields go away', () => {
  const good = { v: 1, host: 'claude', event: 'tool-end', ts: 10.6, session: 'S1', cwd: CWD, tool: { id: 'T1', name: 'Bash', label: 'npm test', ok: true, ms: 4, extra: 'x' }, tool_response: 'SECRET', other: 1 };
  assert.deepEqual(checkEvent(good), { v: 1, host: 'claude', event: 'tool-end', ts: 11, session: 'S1', cwd: CWD, tool: { id: 'T1', name: 'Bash', label: 'npm test', ok: true, ms: 4 } });
  const html = checkEvent({ ...good, title: `<img src=x onerror=alert(1)>${char(10)}second`, text: 'x'.repeat(5000) });
  assert.equal(html.title, '<img src=x onerror=alert(1)> second', 'the text stays text: the page never reads it as HTML');
  assert.equal(html.text.length, 1000);
  for (const bad of [
    null, [], { ...good, v: 2 }, { ...good, host: 'other' }, { ...good, event: 'send' }, { ...good, ts: '10' }, { ...good, ts: Infinity },
    { ...good, session: '' }, { ...good, session: 5 }, { ...good, title: 5 }, { ...good, tool: 'Bash' }, { ...good, tool: { name: 5 } },
    { ...good, tool: undefined }, { ...good, agent: { id: 5 } }, { ...good, agent: [] },
  ]) assert.equal(checkEvent(bad), null, JSON.stringify(bad));
});

test('one turn: the prompt starts the work, a tool shows while it runs, and the stop ends the turn', () => {
  const state = createLive();
  feed(state, ev('session-start'), ev('prompt', { text: 'run the tests', title: 'APP-9 - ▶️ - Fix outbox retry', ts: 2000 }));
  assert.deepEqual([one(state).state, one(state).since, one(state).title], ['working', 2000, 'APP-9 - ▶️ - Fix outbox retry']);
  feed(state, ev('tool-start', { tool: tool('T1', 'Bash', 'npm test'), ts: 2100 }));
  assert.deepEqual(one(state).now, { name: 'Bash', label: 'npm test', start: 2100 });
  feed(state, ev('tool-end', { tool: tool('T1', 'Bash', 'npm test', { ok: true, ms: 4187 }), ts: 6300 }));
  assert.equal(one(state).now, undefined);
  feed(state, ev('stop', { ts: 6400 }));
  assert.deepEqual([one(state).state, one(state).since], ['idle', 6400]);
  assert.deepEqual(calls(state).map((item) => [item.name, item.label, item.state, item.start, item.ms]), [['Bash', 'npm test', 'done', 2100, 4187]]);
  assert.equal(one(state).id, 's1', 'the page gets a short id, not the session id of the host');
  assert.equal(one(state).dir, 'APP-9', 'and only the last name of the session folder');
  assert.doesNotMatch(JSON.stringify(summary(state)), /S1|\/code\//);

  // The next prompt starts a new list.
  feed(state, ev('prompt', { text: 'next', ts: 7000 }));
  assert.deepEqual(calls(state), []);
  feed(state, ev('tool-start', { tool: tool('T2', 'Bash', 'false'), ts: 7100 }), ev('tool-end', { tool: tool('T2', 'Bash', 'false', { ok: false }), ts: 7200 }), ev('stop', { kind: 'failed', ts: 7300 }));
  assert.equal(calls(state)[0].state, 'failed');
  feed(state, ev('session-end', { ts: 7400 }));
  assert.equal(one(state).state, 'ended');
});

test('a turn that Claude Code started by itself makes the session work', () => {
  const state = createLive();
  feed(state, ev('prompt', { text: 'fix the retry', ts: 100 }), ev('stop', { text: 'done', ts: 200 }));
  assert.equal(one(state).state, 'idle');
  feed(state, ev('prompt', { kind: 'own-turn', ts: 300 }));
  assert.equal(one(state).state, 'working');
  feed(state, ev('stop', { ts: 350 }));
  assert.equal(one(state).state, 'idle');
});

test('a permission prompt gives "needs you", and the answer gives "working" again', () => {
  const state = createLive();
  feed(state, ev('prompt', { text: 'push', ts: 100 }), ev('tool-start', { tool: tool('T1', 'Bash', 'git push'), ts: 110 }),
    ev('notify', { kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', ts: 120 }));
  assert.deepEqual([one(state).state, one(state).note, one(state).since], ['needs-you', 'Claude needs your permission to use Bash', 120]);
  // A subagent in the background does not end the wait.
  feed(state, ev('tool-start', { tool: tool('T9', 'Grep', 'x'), agent: { id: 'A1', type: 'Explore' }, ts: 130 }), ev('tool-end', { tool: tool('T9', 'Grep', 'x', { ok: true }), agent: { id: 'A1', type: 'Explore' }, ts: 140 }));
  assert.equal(one(state).state, 'needs-you');
  feed(state, ev('tool-end', { tool: tool('T1', 'Bash', 'git push', { ok: true }), ts: 200 }));
  assert.deepEqual([one(state).state, one(state).note], ['working', undefined]);
  feed(state, ev('notify', { kind: 'idle_prompt', ts: 300 }));
  assert.equal(one(state).state, 'idle');
  feed(state, ev('notify', { kind: 'auth_success', ts: 310 }));
  assert.equal(one(state).state, 'idle', 'another notification changes nothing');
  // A question dialog of an MCP server: the session waits, and the answer of the user ends the wait.
  feed(state, ev('notify', { kind: 'elicitation_url_dialog', text: 'Open the link', ts: 320 }));
  assert.deepEqual([one(state).state, one(state).note], ['needs-you', 'Open the link']);
  feed(state, ev('notify', { kind: 'elicitation_response', ts: 330 }));
  assert.deepEqual([one(state).state, one(state).note], ['working', undefined]);
});

test('events in another order than they happened give the same state', () => {
  const state = createLive();
  // The end of a call comes before its start, and an old tool start comes after the stop.
  feed(state, ev('prompt', { text: 'p', ts: 100 }), ev('tool-end', { tool: tool('T1', 'Read', 'a.md', { ok: true, ms: 20 }), ts: 150 }), ev('tool-start', { tool: tool('T1', 'Read', 'a.md'), ts: 130 }),
    ev('stop', { text: 'done', ts: 300 }), ev('tool-start', { tool: tool('T2', 'Bash', 'ls'), ts: 290 }), ev('prompt', { text: 'old prompt', ts: 50 }));
  assert.equal(one(state).state, 'idle');
  assert.deepEqual(calls(state).map((item) => [item.name, item.state, item.start, item.ms]), [['Read', 'done', 130, 20], ['Bash', 'running', 290, 0]]);
  // An end without an id closes the open call of the same tool.
  const other = createLive();
  feed(other, ev('tool-start', { tool: tool('', 'bash', 'ls'), ts: 10 }), ev('tool-end', { tool: tool('', 'bash', 'ls', { ok: true }), ts: 30 }));
  assert.deepEqual(calls(other).map((item) => [item.state, item.ms]), [['done', 20]]);
});

test('the subagents: a call gets its subagent, the calls of the subagent belong to it, and a wrong pair is corrected', () => {
  const state = createLive();
  const explore = { id: 'A1', type: 'Explore' };
  feed(state, ev('prompt', { text: 'review', ts: 100 }),
    ev('tool-start', { tool: tool('T1', 'Read', 'a.mjs'), ts: 110 }), ev('tool-end', { tool: tool('T1', 'Read', 'a.mjs', { ok: true, ms: 5 }), ts: 115 }),
    ev('tool-start', { tool: tool('T2', 'Agent', 'Find the checks', { sub: 'Explore' }), ts: 120 }),
    ev('agent-start', { agent: explore, ts: 125 }),
    ev('tool-start', { tool: tool('T3', 'Grep', 'checkRequest'), agent: explore, ts: 130 }));
  assert.equal(one(state).agents, 1);
  assert.deepEqual(one(state).now, { name: 'Grep', label: 'checkRequest', start: 130 });
  const session = state.sessions.get('S1');
  assert.deepEqual([agents(state).get('A1').call, agents(state).get('A1').state], ['T2', 'running']);
  assert.deepEqual(calls(state).filter((item) => item.owner === 'A1').map((item) => [item.name, item.state]), [['Grep', 'running']]);
  assert.equal(session.tools.get('T1').owner, '', 'a call of the main agent has no owner');

  feed(state, ev('agent-stop', { agent: explore, text: 'Found 3 checks.', ts: 400 }), ev('tool-end', { tool: tool('T2', 'Agent', 'Find the checks', { sub: 'Explore', ok: true, child: 'A1' }), ts: 410 }));
  assert.deepEqual([agents(state).get('A1').state, agents(state).get('A1').end, session.tools.get('T3').state], ['done', 400, 'done'], 'the stop of a subagent closes its open calls');
  assert.equal(one(state).agents, 0);

  // Two calls of one type at the same time: the first guess can be wrong, and the result of each call names its subagent.
  const two = createLive();
  feed(two, ev('prompt', { text: 'p', ts: 100 }),
    ev('tool-start', { tool: tool('C1', 'Agent', 'first', { sub: 'Explore' }), ts: 110 }), ev('tool-start', { tool: tool('C2', 'Agent', 'second', { sub: 'Explore' }), ts: 111 }),
    ev('agent-start', { agent: { id: 'B2', type: 'Explore' }, ts: 120 }), ev('agent-start', { agent: { id: 'B1', type: 'Explore' }, ts: 121 }),
    ev('tool-start', { tool: tool('X', 'Read', 'for-second'), agent: { id: 'B2', type: 'Explore' }, ts: 130 }));
  assert.deepEqual(['B2', 'B1'].map((id) => agents(two).get(id).call), ['C1', 'C2'], 'the guess: the oldest open call');
  feed(two, ev('tool-end', { tool: tool('C2', 'Agent', 'second', { sub: 'Explore', ok: true, child: 'B2' }), ts: 140 }));
  assert.deepEqual(['B2', 'B1'].map((id) => [agents(two).get(id).call, agents(two).get(id).state]), [['C2', 'running'], ['C1', 'running']], 'a background call ends at once, and its subagent works on');
});

test('the subagents: nested subagents, internal agents, a stop before the start, and a subagent across two prompts', () => {
  const state = createLive();
  const outer = { id: 'A1', type: 'general-purpose' };
  const inner = { id: 'A2', type: 'Explore' };
  feed(state, ev('prompt', { text: 'p', ts: 100 }), ev('tool-start', { tool: tool('T1', 'Agent', 'outer', { sub: 'general-purpose' }), ts: 110 }), ev('agent-start', { agent: outer, ts: 111 }),
    ev('tool-start', { tool: tool('T2', 'Agent', 'inner', { sub: 'Explore' }), agent: outer, ts: 120 }), ev('agent-start', { agent: inner, ts: 121 }),
    ev('tool-start', { tool: tool('T3', 'Glob', '**/*.mjs'), agent: inner, ts: 130 }));
  assert.deepEqual([agents(state).get('A1').call, agents(state).get('A2').call, agents(state).get('A2').parent, calls(state).find((item) => item.id === 'T3').owner], ['T1', 'T2', 'A1', 'A2']);
  assert.equal(one(state).agents, 2);

  // Claude Code also sends a stop event for internal agents. They make no subagent.
  feed(state, ev('agent-stop', { agent: { id: 'INTERNAL', type: '' }, text: 'suggestion', ts: 140 }));
  assert.equal(agents(state).has('INTERNAL'), false);
  assert.equal(one(state).agents, 2);
  // The stop of a fast subagent can come before its start.
  feed(state, ev('agent-stop', { agent: { id: 'A3', type: 'Explore' }, text: 'fast', ts: 160 }), ev('agent-start', { agent: { id: 'A3', type: 'Explore' }, ts: 150 }));
  assert.equal(one(state).agents, 2, 'the fast subagent is done');
  assert.deepEqual([agents(state).get('A3').state, agents(state).get('A3').end], ['done', 160]);

  // A new prompt keeps the subagents that still run, with their place in the tree.
  feed(state, ev('tool-end', { tool: tool('T1', 'Agent', 'outer', { sub: 'general-purpose', ok: true, child: 'A1' }), ts: 170 }), ev('stop', { ts: 180 }), ev('prompt', { text: 'second prompt', ts: 200 }));
  assert.deepEqual([...agents(state).keys()], ['A1', 'A2'], 'the finished subagent goes, and the running ones stay');
  assert.equal(agents(state).get('A2').call, 'T2');
  // A Copilot subagent names its parent.
  const copilot = createLive();
  feed(copilot, ev('tool-start', { host: 'copilot-cli', tool: tool('', 'view', 'a.md'), agent: { id: 'C2', type: 'explore', parent: 'C1' }, ts: 10 }), ev('agent-start', { host: 'copilot-cli', agent: { id: 'C1', type: 'task' }, ts: 5 }));
  assert.deepEqual([agents(copilot).get('C2').parent, agents(copilot).get('C1').type], ['C1', 'task']);
});

test('the limits: a long list drops its oldest calls, and an old session goes away', () => {
  const state = createLive();
  feed(state, ev('prompt', { text: 'p', ts: 100 }));
  for (let index = 0; index < MAX_ITEMS + 25; index++) feed(state, ev('tool-start', { tool: tool(`T${index}`, 'Read', `f${index}`), ts: 200 + index }), ev('tool-end', { tool: tool(`T${index}`, 'Read', `f${index}`, { ok: true }), ts: 201 + index }));
  assert.equal(calls(state).length, MAX_ITEMS);
  assert.equal(calls(state).at(-1).label, `f${MAX_ITEMS + 24}`);

  const last = 201 + MAX_ITEMS + 24;
  assert.equal(summary(state, [], last + QUIET_MS - 1)[0].quiet, undefined);
  assert.equal(summary(state, [], last + QUIET_MS + 1)[0].quiet, true, 'a session that works without an event is quiet');
  assert.equal(prune(state, last + GONE_MS - 1), false);
  feed(state, ev('session-end', { ts: last + 10 }));
  assert.equal(prune(state, last + 10 + ENDED_MS - 1), false);
  assert.equal(prune(state, last + 10 + ENDED_MS + 1), true);
  assert.deepEqual(summary(state), []);

  const many = createLive();
  for (let index = 0; index < 60; index++) feed(many, ev(index === 0 ? 'session-end' : 'prompt', { session: `S${index}`, ts: 1000 + index }));
  assert.equal(many.sessions.size, 50);
  assert.ok(!many.sessions.has('S0') && many.sessions.has('S59'), 'the ended session and the oldest sessions go first');
});

test('a session gets its ticket from the key in its title, or from the worktree of the ticket', () => {
  const tickets = [
    { key: 'APP-9', folder: 'app-9', worktree: '/code/app.worktrees/APP-9' },
    { key: 'APP-10', folder: 'app-10', worktree: '/code/app.worktrees/APP-10' },
    { key: 'APP-11', folder: 'app-11', worktree: '' },
    { key: 'WIN-1', folder: 'win-1', worktree: 'C:\\code\\app.worktrees\\WIN-1\\' },
  ];
  const of = (title, cwd) => ticketOfSession({ title, cwd }, tickets);
  assert.equal(of('app-11 - ▶️ - Port the grid', '/code/app'), 'app-11', 'the key at the start of the title');
  assert.equal(of('APP-11 - ▶️ - Port the grid', '/code/app.worktrees/APP-9'), 'app-11', 'the title comes before the folder');
  assert.equal(of('', '/code/app.worktrees/APP-9/src/lib'), 'app-9');
  assert.equal(of('Some talk about APP-10', '/code/app.worktrees/APP-10'), 'app-10');
  assert.equal(of('', '/code/app.worktrees/APP-100'), '', 'a folder with a longer name is another folder');
  assert.equal(of('', 'C:\\code\\app.worktrees\\WIN-1\\src'), 'win-1');
  assert.equal(of('ZZZ-1 - ▶️ - Not on the board', '/code/app'), '');
  assert.equal(of('', ''), '');
});
