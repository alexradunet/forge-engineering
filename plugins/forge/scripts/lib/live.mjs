// The live state: what each agent session does now, made from the live events (live-event.mjs).
// The live server (live-serve.mjs) keeps one state in memory and gives its summary to the pages.
// This file reads no file and starts no process. reduce() changes the state that it gets.
// The reporters are separate processes, so the events of one session can come in another order than they happened:
// each tool call has its id, and a state change that is older than the last one is ignored.
import { AGENT_TOOLS } from './live-event.mjs';

export const MAX_SESSIONS = 50;
export const MAX_ITEMS = 200;
export const MAX_AGENTS = 40;
/** A session that works without an event for this time gets the mark `quiet`. */
export const QUIET_MS = 10 * 60 * 1000;
/** An ended session goes away after this time. */
export const ENDED_MS = 30 * 60 * 1000;
/** A session without an event goes away after this time. */
export const GONE_MS = 6 * 60 * 60 * 1000;
// The notification types that mean "the session waits for the user".
const NEEDS = ['permission_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog'];
// The notification types that mean "the user gave the answer".
const ANSWERED = ['elicitation_complete', 'elicitation_response'];
const KEY_TITLE = /^([A-Za-z][A-Za-z0-9]*-\d+) - /;

const isAgentTool = (name) => AGENT_TOOLS.includes(String(name).toLowerCase());

export function createLive() {
  return { sessions: new Map(), count: 0 };
}

function setState(session, name, ts) {
  if (ts < session.stateTs) return false;
  if (session.state !== name) { session.state = name; session.since = ts; }
  session.stateTs = ts;
  return true;
}

function openSession(state, event) {
  let session = state.sessions.get(event.session);
  if (!session) {
    session = {
      id: event.session, sid: `s${++state.count}`, host: event.host, cwd: event.cwd, title: '',
      state: 'idle', since: event.ts, stateTs: 0, seen: event.ts,
      note: '', tools: new Map(), agents: new Map(), stops: new Map(), waits: [], auto: 0,
    };
    state.sessions.set(event.session, session);
    if (state.sessions.size > MAX_SESSIONS) dropSession(state, session);
  }
  session.seen = Math.max(session.seen, event.ts);
  if (event.cwd && !event.agent) session.cwd = event.cwd;
  if (event.title) session.title = event.title;
  return session;
}

// Too many sessions: the ended session with the oldest event goes first, then the session with the oldest event.
function dropSession(state, keep) {
  const others = [...state.sessions.values()].filter((item) => item !== keep);
  const pool = others.some((item) => item.state === 'ended') ? others.filter((item) => item.state === 'ended') : others;
  pool.sort((a, b) => a.seen - b.seen);
  if (pool[0]) state.sessions.delete(pool[0].id);
}

function openAgent(session, id, type, ts) {
  let agent = session.agents.get(id);
  if (!agent) {
    agent = { id, type: type ?? '', state: 'running', start: ts, end: 0, parent: '', call: '' };
    session.agents.set(id, agent);
    guess(session, agent);
    // The stop event of this subagent came before its first event.
    const stop = session.stops.get(id);
    if (stop && stop.ts >= ts) { agent.state = 'done'; agent.end = stop.ts; }
    session.stops.delete(id);
    if (session.agents.size > MAX_AGENTS) {
      const old = [...session.agents.values()].find((item) => item.state === 'done' && item !== agent);
      if (old) dropAgent(session, old);
    }
  }
  if (type && !agent.type) { agent.type = type; if (!agent.call) guess(session, agent); }
  return agent;
}

function dropAgent(session, agent) {
  session.agents.delete(agent.id);
  for (const item of [...session.tools.values()]) {
    if (item.owner === agent.id || item.id === agent.call) session.tools.delete(item.id);
  }
}

// The start event of a subagent does not name the call that made it. The oldest open call of the same type is the first guess.
function guess(session, agent) {
  const calls = [...session.tools.values()].filter((item) => isAgentTool(item.name) && !item.child && item.owner !== agent.id)
    .sort((a, b) => a.start - b.start);
  const same = (item) => !item.sub || !agent.type || item.sub === agent.type;
  const call = calls.find((item) => item.state === 'running' && same(item)) ?? calls.find(same);
  if (!call) return;
  call.child = agent.id;
  agent.call = call.id;
  agent.parent = call.owner;
}

// The result of an Agent call names its subagent: this corrects a wrong guess, and it exchanges the two pairs when it must.
function pair(session, call, agentId, ts) {
  const agent = openAgent(session, agentId, call.sub, ts);
  if (call.child === agentId) return;
  const other = agent.call ? session.tools.get(agent.call) : null;
  const old = call.child ? session.agents.get(call.child) : null;
  if (other) other.child = '';
  if (old) { old.call = ''; old.parent = ''; }
  call.child = agentId;
  agent.call = call.id;
  agent.parent = call.owner;
  if (other && old) { other.child = old.id; old.call = other.id; old.parent = other.owner; }
}

function openTool(session, event) {
  const { tool } = event;
  const owner = event.agent?.id ?? '';
  let item = tool.id ? session.tools.get(tool.id) : null;
  // An end event without an id closes the oldest open call of the same tool and the same agent.
  if (!item && !tool.id && event.event === 'tool-end') {
    item = [...session.tools.values()].find((one) => one.state === 'running' && one.name === tool.name && one.owner === owner) ?? null;
  }
  if (!item) {
    const id = tool.id || `auto-${++session.auto}`;
    item = { id, name: tool.name, label: tool.label, sub: tool.sub ?? '', owner, state: 'running', start: event.ts, end: 0, ms: 0, child: '' };
    session.tools.set(id, item);
    if (session.tools.size > MAX_ITEMS) {
      const old = [...session.tools.values()].find((one) => one.state !== 'running' && one !== item);
      if (old) session.tools.delete(old.id);
    }
  }
  if (!item.name) item.name = tool.name;
  if (!item.label) item.label = tool.label;
  if (!item.sub && tool.sub) item.sub = tool.sub;
  return item;
}

function closeOpen(session, ts, owner) {
  for (const item of session.tools.values()) {
    if (item.state === 'running' && item.start <= ts && (owner === undefined || item.owner === owner)) { item.state = 'done'; item.end = ts; item.ms = Math.max(0, ts - item.start); }
  }
}

/** Puts one checked live event (checkEvent in live-event.mjs) into the state. */
export function reduce(state, event) {
  const session = openSession(state, event);
  const { ts } = event;
  // A stop event makes no subagent: Claude Code also sends it for internal agents that the page must not show.
  const agent = !event.agent ? null
    : event.event === 'agent-stop' ? session.agents.get(event.agent.id) ?? null
      : openAgent(session, event.agent.id, event.agent.type, ts);
  if (agent && event.agent.parent && !agent.parent) agent.parent = event.agent.parent;

  if (event.event === 'session-start') {
    if (session.state === 'ended') setState(session, 'idle', ts);
  } else if (event.event === 'prompt') {
    if (!setState(session, 'working', ts)) return;
    // A new prompt starts a new list: the finished subagents and the finished calls of the turn before go away.
    // The call of a subagent that still runs stays, because it holds the place of the subagent in the tree.
    for (const item of [...session.agents.values()]) if (item.state === 'done') session.agents.delete(item.id);
    for (const item of [...session.tools.values()]) {
      if (item.child && !session.agents.has(item.child)) item.child = '';
      if (item.state !== 'running' && !item.child) session.tools.delete(item.id);
    }
    session.stops.clear();
    session.note = '';
    session.waits = [];
  } else if (event.event === 'tool-start') {
    const item = openTool(session, event);
    item.start = Math.min(item.start, ts);
    // Only a call of the main agent shows that the session works: a subagent in the background can run while the session is idle or waits.
    if (!event.agent && session.state !== 'ended' && setState(session, 'working', ts)) session.note = '';
  } else if (event.event === 'tool-end') {
    const item = openTool(session, event);
    item.state = event.tool.ok === false ? 'failed' : 'done';
    item.end = ts;
    item.ms = event.tool.ms ?? Math.max(0, ts - item.start);
    if (event.tool.child) pair(session, item, event.tool.child, ts);
    // A call that was open when the session started to wait has its answer now.
    if (session.state === 'needs-you' && session.waits.includes(item.id) && setState(session, 'working', ts)) session.note = '';
  } else if (event.event === 'notify') {
    if (NEEDS.includes(event.kind)) {
      if (setState(session, 'needs-you', ts)) {
        session.note = event.text ?? '';
        session.waits = [...session.tools.values()].filter((item) => item.state === 'running').map((item) => item.id);
      }
    } else if (event.kind === 'idle_prompt') setState(session, 'idle', ts);
    else if (ANSWERED.includes(event.kind) && session.state === 'needs-you' && setState(session, 'working', ts)) session.note = '';
  } else if (event.event === 'agent-start') {
    // A start after the stop is a subagent that continues. A start before the stop is an old event.
    if (agent && ts >= agent.end) { agent.state = 'running'; agent.end = 0; }
  } else if (event.event === 'agent-stop') {
    if (agent) {
      agent.state = 'done';
      agent.end = ts;
      closeOpen(session, ts, agent.id);
    } else if (event.agent) {
      // The subagent is not known. Keep the stop in a short list, in case its start event comes later.
      session.stops.set(event.agent.id, { ts });
      if (session.stops.size > MAX_AGENTS) session.stops.delete(session.stops.keys().next().value);
    }
  } else if (event.event === 'stop') {
    if (!setState(session, 'idle', ts)) return;
    session.note = event.kind === 'failed' ? 'The turn stopped with an error.' : '';
    closeOpen(session, ts, '');
  } else if (event.event === 'session-end') {
    if (!setState(session, 'ended', ts)) return;
    closeOpen(session, ts);
    for (const item of session.agents.values()) if (item.state === 'running') { item.state = 'done'; item.end = ts; }
  }
}

/** Removes the sessions that ended long ago or that sent no event for a long time. True when a session went away. */
export function prune(state, now = Date.now()) {
  let changed = false;
  for (const session of [...state.sessions.values()]) {
    const age = now - session.seen;
    if (age > GONE_MS || (session.state === 'ended' && age > ENDED_MS)) { state.sessions.delete(session.id); changed = true; }
  }
  return changed;
}

const norm = (folder) => String(folder ?? '').replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * The folder of the ticket of a session, or ''. `tickets` are board items: { key, folder, worktree }.
 * The ticket key at the start of the session title comes first, then the session folder inside the ticket worktree.
 */
export function ticketOfSession(session, tickets) {
  const key = KEY_TITLE.exec(session.title)?.[1].toLowerCase();
  const byKey = key ? tickets.find((item) => String(item.key).toLowerCase() === key) : null;
  if (byKey) return byKey.folder;
  const cwd = norm(session.cwd);
  if (!cwd) return '';
  const inside = tickets.filter((item) => norm(item.worktree) && (cwd === norm(item.worktree) || cwd.startsWith(`${norm(item.worktree)}/`)));
  // The longest worktree path is the nearest one.
  inside.sort((a, b) => norm(b.worktree).length - norm(a.worktree).length);
  return inside[0]?.folder ?? '';
}

/** The short record of each session for the pages, the oldest session first. */
export function summary(state, tickets = [], now = Date.now()) {
  return [...state.sessions.values()].map((session) => {
    const running = [...session.tools.values()].filter((item) => item.state === 'running' && !isAgentTool(item.name)).sort((a, b) => b.start - a.start)[0];
    const out = {
      id: session.sid, host: session.host, title: session.title, dir: norm(session.cwd).split('/').pop() ?? '',
      ticket: ticketOfSession(session, tickets), state: session.state, since: session.since, seen: session.seen,
      agents: [...session.agents.values()].filter((item) => item.state === 'running').length,
    };
    if (running && session.state !== 'ended') out.now = { name: running.name, label: running.label, start: running.start };
    if (session.note) out.note = session.note;
    if (session.state === 'working' && now - session.seen > QUIET_MS) out.quiet = true;
    return out;
  });
}

