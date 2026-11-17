// The gate guard: the preToolUse hook of each host. Before a shell command pushes a ticket branch or
// creates a change request, it checks the gates of the ticket with checkAction('ship'): the same check
// as `forge.mjs lint`, so a missing or stale Shippable? approval stops the command, not only a written rule.
// It reads the words of the command, so it is a net and not a wall: a script that pushes is not seen.
// It never stops other work: no ticket, no wiki, a read error, or a parse error all let the command run.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolve, samePath } from './repo.mjs';
import { listTickets } from './tickets.mjs';
import { checkAction } from './validation.mjs';
import { ticketOfFolder, trustedConfig } from './hook.mjs';

export const GUARD_MODES = ['deny', 'ask', 'off'];
const ENDS = ';|&()`';
const WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec']);
const MOVES = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const MAX_FINDINGS = 5;

/**
 * The delimiter of a heredoc that starts at `text[start]` (after `<<` or `<<-`): { delimiter, end }.
 * Quotes in the delimiter word group it, and they are not part of it: `'EOF'` and `"EOF"` give `EOF`.
 */
function heredocDelimiter(text, start) {
  let i = start;
  while (text[i] === ' ' || text[i] === '\t') i++;
  let delimiter = '';
  while (i < text.length && !/\s/.test(text[i]) && !ENDS.includes(text[i]) && text[i] !== '<' && text[i] !== '>') {
    const c = text[i];
    if (c === "'" || c === '"') {
      const close = text.indexOf(c, i + 1);
      const stop = close === -1 ? text.length : close;
      delimiter += text.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === '\\' && i + 1 < text.length) { delimiter += text[i + 1]; i += 2; }
    else { delimiter += c; i++; }
  }
  return { delimiter, end: i };
}

/**
 * The commands of one shell line, each as a list of words. Quotes group a word.
 * `&&`, `||`, `;`, `|`, `&`, parentheses, backticks, and new lines end a command.
 * A backslash is an escape only before a space, a quote, or one of these characters, so a Windows path keeps its backslashes.
 * The text of a heredoc (`<<EOF`, `<<'EOF'`, `<<-EOF`) is data, not commands: the lines up to the end line give no command.
 */
export function shellCommands(line) {
  const text = String(line ?? '');
  const commands = [];
  let words = [];
  let word = null;
  let quote = '';
  let heredocs = [];
  const endWord = () => { if (word !== null) { words.push(word); word = null; } };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && next !== undefined && '"\\$`'.includes(next)) { word += next; i++; }
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; word ??= ''; continue; }
    if (c === '\\' && next !== undefined && (/\s/.test(next) || `'"\\${ENDS}`.includes(next))) {
      if (next !== '\n') word = (word ?? '') + next;
      i++;
      continue;
    }
    if (c === '<' && next === '<') {
      endWord();
      if (text[i + 2] === '<') { i += 2; continue; } // `<<<` is a here-string: its word is data on the same line.
      const strip = text[i + 2] === '-';
      const { delimiter, end } = heredocDelimiter(text, i + (strip ? 3 : 2));
      // Only a name is a delimiter. So `$((1<<2))` starts no heredoc, and it cannot hide the commands after it.
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(delimiter)) { heredocs.push({ delimiter, strip }); i = end - 1; }
      else i += 1;
      continue;
    }
    if (c === '\n') {
      endCommand();
      // Skip the text of each heredoc of this line, up to and with its end line.
      let pos = i + 1;
      for (const { delimiter, strip } of heredocs) {
        while (pos < text.length) {
          const stop = text.indexOf('\n', pos);
          const lineEnd = stop === -1 ? text.length : stop;
          const body = text.slice(pos, lineEnd).replace(/\r$/, '');
          pos = lineEnd + 1;
          if ((strip ? body.replace(/^\t+/, '') : body) === delimiter) break;
        }
      }
      heredocs = [];
      i = pos - 1;
      continue;
    }
    if (/\s/.test(c)) { endWord(); continue; }
    if (ENDS.includes(c)) { endCommand(); continue; }
    word = (word ?? '') + c;
  }
  endCommand();
  return commands;
}

/** The words of a command without the variable assignments and the wrappers (sudo, env, ...) before the tool. */
function toolWords(words) {
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || WRAPPERS.has(words[i]))) i++;
  return words.slice(i);
}

const toolName = (word) => String(word ?? '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

/** The subcommand of a git call, its arguments, and the folder that `-C` selects. */
function gitCall(words, cwd) {
  let folder = cwd;
  let i = 1;
  while (i < words.length) {
    const word = words[i];
    if (word === '-C' && words[i + 1] !== undefined) { folder = path.resolve(folder, words[i + 1]); i += 2; }
    else if (GIT_VALUE_OPTIONS.has(word)) i += 2;
    else if (word.startsWith('-')) i += 1;
    else break;
  }
  return { sub: words[i] ?? '', args: words.slice(i + 1), cwd: folder };
}

/**
 * The commands that create a change request, from the `repo.open-change` row of a repo.md text:
 * the first words of each code span of its Command cell, up to the first option or placeholder.
 * A git command is not in the list: `git push` is always a ship action.
 */
export function changeCommands(repoText) {
  const row = String(repoText ?? '').replace(/\r\n/g, '\n').split('\n').find((line) => /^\|\s*`repo\.open-change`\s*\|/.test(line));
  if (!row) return [];
  const cell = row.split(/(?<!\\)\|/)[2] ?? '';
  const found = [];
  for (const [, span] of cell.matchAll(/`([^`]+)`/g)) {
    const words = toolWords(shellCommands(span)[0] ?? []);
    const end = words.findIndex((word) => /^[-<[]/.test(word) || word.includes('<'));
    const first = (end === -1 ? words : words.slice(0, end)).map((word, i) => (i === 0 ? toolName(word) : word));
    if (first.length >= 2 && first[0] !== 'git') found.push(first);
  }
  return found;
}

/**
 * The branches that a `git push` names: { refs, all }. The first plain word is the remote, and each other word is a
 * refspec `[+]<source>[:<target>]`. `all` is true for `--all`, `--mirror`, and `--branches`.
 * A push of a ticket branch can run from each folder of the repository, so the folder alone does not show the ticket.
 */
function pushTargets(args) {
  const plain = [];
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (['--all', '--mirror', '--branches'].includes(args[i])) all = true;
    else if (PUSH_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith('-')) plain.push(args[i]);
  }
  const refs = plain.slice(1).map((spec) => spec.replace(/^\+/, '').split(':')[0].replace(/^refs\/heads\//, '')).filter(Boolean);
  return { refs, all };
}

/**
 * The ship actions of a shell line: each `git push` (not a dry run) and each command that starts with
 * one of the change commands. Each action has the folder where it runs: `cd` and `git -C` change it.
 * A push also has the branches that it names (`refs`, `all`).
 */
export function shipActions(line, cwd, changes = []) {
  const actions = [];
  let folder = cwd;
  for (const raw of shellCommands(line)) {
    const words = toolWords(raw);
    if (!words.length) continue;
    const tool = toolName(words[0]);
    if (MOVES.has(tool)) {
      const target = words.slice(1).find((word) => !word.startsWith('-'));
      if (target) folder = path.resolve(folder, target);
      continue;
    }
    if (tool === 'git') {
      const call = gitCall(words, folder);
      if (call.sub === 'push' && !call.args.some((arg) => arg === '--dry-run' || arg === '-n')) actions.push({ kind: 'push', cwd: call.cwd, ...pushTargets(call.args) });
      continue;
    }
    if (changes.some((first) => first[0] === tool && first.slice(1).every((word, i) => words[i + 1] === word))) actions.push({ kind: 'change', cwd: folder });
  }
  return actions;
}

/**
 * The hook input of each host: { cwd, command }, or null when the tool call has no shell command.
 * Claude Code and the VS Code format give `tool_input`. The Copilot format gives `toolArgs`, as an object or as JSON text.
 */
export function readToolEvent(raw) {
  let event;
  try { event = raw && raw.trim() ? JSON.parse(raw) : null; } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  let input = event.tool_input ?? event.toolArgs;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return null; } }
  const command = input && typeof input === 'object' ? input.command : null;
  if (typeof command !== 'string' || !command.trim()) return null;
  return { cwd: typeof event.cwd === 'string' ? event.cwd : '', command };
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

function locate(cwd, env) {
  try { return resolve({ cwd, env }); } catch { return null; /* not in a Git repository */ }
}

function repoText(where) {
  try { return readFileSync(path.join(where.configDir, 'repo.md'), 'utf8'); } catch { return ''; }
}

const LABEL = { push: 'a push', change: 'a new change request' };

/**
 * The verdict for one tool call: null to let it run, or { decision, key, reason }.
 * decision is `deny` or `ask`, from `policy.gateGuard` (default `deny`; `off` stops the guard).
 * Only a trusted config can change the mode or add change commands.
 */
export function preTool(event, { env = process.env } = {}) {
  if (!event?.command) return null;
  const base = event.cwd || process.cwd();
  const home = locate(base, env);
  const homeConfig = home?.wiki.exists ? trustedConfig(home, env) : null;
  const changes = homeConfig ? changeCommands(repoText(home)) : [];
  for (const action of shipActions(event.command, base, changes)) {
    const where = samePath(action.cwd, base) ? home : locate(action.cwd, env);
    if (!where?.wiki.exists || samePath(where.top, where.wiki.path)) continue;
    const config = where === home ? homeConfig : trustedConfig(where, env);
    const mode = GUARD_MODES.includes(config?.policy?.gateGuard) ? config.policy.gateGuard : 'deny';
    if (mode === 'off') continue;
    // The ticket of the folder, and each ticket whose branch the push names: a push of a ticket branch runs from each folder.
    let found = [];
    try {
      const tickets = listTickets(where.wiki.path).filter((entry) => entry.ticket);
      const branch = git(action.cwd, ['branch', '--show-current']);
      const here = ticketOfFolder(tickets, { here: where.top, branch, inMain: samePath(where.top, where.repo.path), getConfig: () => config });
      const named = action.kind === 'push' ? tickets.filter((entry) => entry.ticket.branch && (action.all || action.refs.includes(entry.ticket.branch))) : [];
      found = [...new Set([here, ...named].filter(Boolean))];
    } catch { continue; }
    for (const match of found) {
      let verdict;
      try { verdict = checkAction(match.ticket, match.file, 'ship'); } catch { continue; }
      if (verdict.allowed) continue;
      const messages = [...new Set(verdict.findings.map((item) => item.message))];
      const shown = messages.slice(0, MAX_FINDINGS).join(' ');
      const more = messages.length > MAX_FINDINGS ? ` There are ${messages.length - MAX_FINDINGS} more findings: run \`forge.mjs lint\`.` : '';
      const key = match.ticket.key;
      const reason = mode === 'ask'
        ? `Forge gate guard: ${key} has no valid approval for ${LABEL[action.kind]}. ${shown}${more} Allow this command only if you accept the step without the gate.`
        : `Forge gate guard: ${key} has no valid approval for ${LABEL[action.kind]}. ${shown}${more} Open the gate as the ticket skill says (Review gates), and wait for the answer of the user. Do not run the command in another form. Tell the user which approval is missing, and offer to open the gate.`;
      return { decision: mode, key, reason };
    }
  }
  return null;
}

/** The hook output of a host for a verdict of preTool. No verdict gives {}, so the normal permission flow continues. */
export function preToolOutput(verdict, host) {
  if (!verdict) return {};
  if (host === 'claude') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } };
  }
  return { permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason };
}
