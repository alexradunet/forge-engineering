// The live event: the small record that a session hook sends to the live server (forge.mjs live).
// The reporter (live-hook.mjs) makes it from a hook payload with normalize(), and the server checks it again with checkEvent().
// It holds only what the pages show: short text, no tool result, and no file content.
// Only a prompt (the label of a session) and a notice (the note of a session) carry text. A stop sends no text, because no page shows it.
// This file imports only own-turn.mjs, which has no import, so the reporter starts fast.
import { ownTurn } from './own-turn.mjs';

export const EVENT_VERSION = 1;
export const EVENTS = ['session-start', 'prompt', 'tool-start', 'tool-end', 'notify', 'agent-start', 'agent-stop', 'stop', 'session-end'];
export const LIVE_HOSTS = ['claude', 'copilot-cli'];
/** The name of the state file of the live server in the forge data folder. */
// Until Forge 8.3 one server ran for a user, with this state file. A server start removes the file.
export const LIVE_FILE = 'live.json';
/** The folder of the state files in the forge data folder: one file for the live server of each repository. */
export const LIVE_DIR = 'live';

/**
 * The live server for a session, from the state of each server that runs: the server with the longest root folder
 * that holds the folder of the session. A session outside of each root has no server, so it sends no event.
 */
export function pickServer(states, cwd, win = false) {
  const norm = (value) => { const text = String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, ''); return win ? text.toLowerCase() : text; };
  const here = norm(cwd);
  let best = null;
  let size = 0;
  if (!here) return null;
  for (const state of states) {
    for (const root of Array.isArray(state?.roots) ? state.roots : []) {
      const folder = norm(root);
      if (folder && (here === folder || here.startsWith(folder + '/')) && folder.length > size) { best = state; size = folder.length; }
    }
  }
  return best;
}
/** The kind of a prompt event for a turn that Claude Code started by itself. */
export const OWN_KIND = 'own-turn';
export const MAX_EVENT = 16 * 1024;
const LIMIT = { session: 128, cwd: 1024, title: 200, agentId: 128, agentType: 120, toolId: 128, toolName: 80, label: 160, text: 1000, kind: 40 };

// The hook event names of Claude Code (PascalCase) and of the Copilot hosts (camelCase).
const NAMES = {
  SessionStart: 'session-start', sessionStart: 'session-start',
  UserPromptSubmit: 'prompt', userPromptSubmitted: 'prompt',
  PreToolUse: 'tool-start', preToolUse: 'tool-start',
  PostToolUse: 'tool-end', postToolUse: 'tool-end',
  PostToolUseFailure: 'tool-end', postToolUseFailure: 'tool-end',
  Notification: 'notify', notification: 'notify',
  SubagentStart: 'agent-start', subagentStart: 'agent-start',
  SubagentStop: 'agent-stop', subagentStop: 'agent-stop',
  Stop: 'stop', StopFailure: 'stop', agentStop: 'stop',
  SessionEnd: 'session-end', sessionEnd: 'session-end',
};
const FAILED = ['PostToolUseFailure', 'postToolUseFailure', 'StopFailure'];
const SHELL_TOOLS = ['bash', 'powershell'];
const FILE_TOOLS = ['read', 'edit', 'write', 'multiedit', 'notebookedit', 'view', 'create'];
/** The tools that start a subagent. */
export const AGENT_TOOLS = ['agent', 'task'];

const str = (value) => (typeof value === 'string' ? value : '');
const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

/** One line of plain text: no control character, single spaces, at most max characters. */
export function cleanText(value, max) {
  const text = str(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 4).trim()} ...` : text;
}

/** The text with a mask on each value that follows a secret word: token, secret, password, authorization, bearer, api-key. */
export function maskSecrets(text) {
  return str(text)
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/((?:token|secret|passw(?:or)?d|pwd|authorization|api[-_]?key|access[-_]?key)[A-Za-z0-9_-]*["']?\s*[:=]\s*["']?)(?!\*\*\*)[^\s"'&;|]+/gi, '$1***')
    .replace(/(--?(?:token|secret|password|api[-_]?key)\s+)(?!\*\*\*)[^\s"';|]+/gi, '$1***');
}

// A path inside the session folder shows as a relative path. Another path shows its last two names only.
function shortPath(file, cwd) {
  const full = str(file).replace(/\\/g, '/');
  const base = str(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!full) return '';
  if (base && full.startsWith(`${base}/`)) return cleanText(full.slice(base.length + 1), LIMIT.label);
  const names = full.split('/').filter(Boolean);
  return cleanText(names.length > 2 ? `.../${names.slice(-2).join('/')}` : full, LIMIT.label);
}

function urlHost(url) {
  try { return cleanText(new URL(str(url)).host, LIMIT.label); } catch { return ''; }
}

/** The short text that the page shows for a tool call. A tool that this list does not name gets no text. */
export function toolLabel(name, input, cwd = '') {
  const tool = str(name).toLowerCase();
  const arg = record(input) ?? {};
  if (SHELL_TOOLS.includes(tool)) return cleanText(maskSecrets(cleanText(arg.command, 400)), 80);
  if (FILE_TOOLS.includes(tool)) return shortPath(str(arg.file_path) || str(arg.path) || str(arg.notebook_path), cwd);
  if (tool === 'grep' || tool === 'glob') return cleanText(arg.pattern, 120);
  if (AGENT_TOOLS.includes(tool)) return cleanText(arg.description, 120);
  if (tool === 'skill') return cleanText(arg.skill, 80);
  if (tool === 'websearch') return cleanText(arg.query, 120);
  if (tool === 'webfetch') return urlHost(arg.url);
  return '';
}

function toolInput(payload) {
  const direct = record(payload.tool_input) ?? record(payload.toolInput);
  if (direct) return direct;
  // The Copilot hosts give the tool arguments as JSON text.
  try { return record(JSON.parse(str(payload.toolArgs))) ?? {}; } catch { return {}; }
}

/**
 * The live event of one hook payload, or null when the payload gives none.
 * `name` is the hook event name for a host whose payload does not hold it (the Copilot hosts).
 */
export function normalize(name, payload, host, now = Date.now()) {
  const p = record(payload);
  if (!p) return null;
  const hookName = str(p.hook_event_name) || str(name);
  const event = Object.hasOwn(NAMES, hookName) ? NAMES[hookName] : '';
  const session = cleanText(str(p.session_id) || str(p.sessionId), LIMIT.session);
  if (!event || !session) return null;
  const out = { v: EVENT_VERSION, host: LIVE_HOSTS.includes(host) ? host : 'claude', event, ts: now, session, cwd: str(p.cwd).slice(0, LIMIT.cwd) };
  const title = cleanText(str(p.session_title) || str(p.sessionTitle), LIMIT.title);
  if (title) out.title = title;
  const agentId = cleanText(str(p.agent_id) || str(p.agentId), LIMIT.agentId);
  if (agentId) {
    out.agent = { id: agentId, type: cleanText(str(p.agent_type) || str(p.agentType), LIMIT.agentType) };
    const parent = cleanText(str(p.parentAgentId), LIMIT.agentId);
    if (parent) out.agent.parent = parent;
  }
  if (event === 'tool-start' || event === 'tool-end') {
    const toolName = cleanText(str(p.tool_name) || str(p.toolName), LIMIT.toolName);
    const input = toolInput(p);
    out.tool = { id: cleanText(str(p.tool_use_id) || str(p.toolUseId) || str(p.toolCallId), LIMIT.toolId), name: toolName, label: toolLabel(toolName, input, out.cwd) };
    if (AGENT_TOOLS.includes(toolName.toLowerCase())) {
      const sub = cleanText(str(input.subagent_type) || str(input.agent_type), LIMIT.agentType);
      if (sub) out.tool.sub = sub;
    }
    if (event === 'tool-end') {
      out.tool.ok = !FAILED.includes(hookName);
      const ms = Number(p.duration_ms ?? p.durationMs);
      if (Number.isFinite(ms) && ms >= 0) out.tool.ms = Math.round(ms);
      // Of the tool result, only the id of the new subagent goes on: it joins the Agent call to its subagent.
      const child = cleanText(str(record(p.tool_response)?.agentId) || str(record(p.toolResult)?.agentId), LIMIT.agentId);
      if (child && AGENT_TOOLS.includes(toolName.toLowerCase())) out.tool.child = child;
    }
  } else if (event === 'prompt') {
    // A turn that Claude Code started by itself (a report of a subagent) still starts the work, but its text is not the prompt of the user.
    if (ownTurn(p.prompt)) out.kind = OWN_KIND;
    else out.text = cleanText(maskSecrets(cleanText(p.prompt, 4000)), LIMIT.text);
  } else if (event === 'notify') {
    out.kind = cleanText(str(p.notification_type) || str(p.notificationType), LIMIT.kind);
    out.text = cleanText(p.message, LIMIT.text);
  } else if (event === 'agent-stop' || event === 'stop') {
    if (FAILED.includes(hookName)) out.kind = 'failed';
  } else if (event === 'session-start') {
    out.kind = cleanText(p.source, LIMIT.kind);
  } else if (event === 'session-end') {
    out.kind = cleanText(p.reason, LIMIT.kind);
  }
  return out;
}

/** The event of a POST body with each value checked and cut again, or null when the shape is wrong. Unknown fields go away. */
export function checkEvent(body) {
  const b = record(body);
  if (!b || b.v !== EVENT_VERSION || !EVENTS.includes(b.event) || !LIVE_HOSTS.includes(b.host)) return null;
  if (typeof b.ts !== 'number' || !Number.isFinite(b.ts) || b.ts < 0) return null;
  const session = cleanText(b.session, LIMIT.session);
  if (!session || typeof b.session !== 'string') return null;
  for (const name of ['cwd', 'title', 'text', 'kind']) if (b[name] !== undefined && typeof b[name] !== 'string') return null;
  const out = { v: EVENT_VERSION, host: b.host, event: b.event, ts: Math.round(b.ts), session, cwd: cleanText(b.cwd, LIMIT.cwd) };
  if (b.title) out.title = cleanText(b.title, LIMIT.title);
  if (b.text) out.text = cleanText(b.text, LIMIT.text);
  if (b.kind) out.kind = cleanText(b.kind, LIMIT.kind);
  if (b.agent !== undefined) {
    const agent = record(b.agent);
    if (!agent || typeof agent.id !== 'string' || !cleanText(agent.id, LIMIT.agentId)) return null;
    out.agent = { id: cleanText(agent.id, LIMIT.agentId), type: cleanText(agent.type, LIMIT.agentType) };
    if (str(agent.parent)) out.agent.parent = cleanText(agent.parent, LIMIT.agentId);
  }
  if (b.tool !== undefined) {
    const tool = record(b.tool);
    if (!tool || typeof tool.name !== 'string') return null;
    out.tool = { id: cleanText(tool.id, LIMIT.toolId), name: cleanText(tool.name, LIMIT.toolName), label: cleanText(tool.label, LIMIT.label) };
    if (str(tool.sub)) out.tool.sub = cleanText(tool.sub, LIMIT.agentType);
    if (typeof tool.ok === 'boolean') out.tool.ok = tool.ok;
    if (typeof tool.ms === 'number' && Number.isFinite(tool.ms) && tool.ms >= 0) out.tool.ms = Math.round(tool.ms);
    if (str(tool.child)) out.tool.child = cleanText(tool.child, LIMIT.agentId);
  }
  if ((out.event === 'tool-start' || out.event === 'tool-end') && !out.tool) return null;
  return out;
}
