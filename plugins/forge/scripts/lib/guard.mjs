// The gate guard: the preToolUse hook of each host. Before a shell command pushes a ticket branch or
// creates a change request, it checks the gates of the ticket with checkAction('ship'): the same check
// as `forge.mjs lint`, so a missing or stale Shippable? approval stops the command, not only a written rule.
// Before an external write of a ticket (a command of a write capability in the trusted config), it answers `ask`,
// so the prompt of the host is the "yes" for this one write (GH-2). In a mode with no prompt, it denies instead.
// One exception: a new change request, when its draft is the one `target: change` file of the approved Shippable? set.
// The approval of that exact set is the yes, so the guard gives no verdict, also in a mode with no prompt.
// The 2 approval commands (`forge.mjs gate-approve` and `forge.mjs trust approve`) get `ask` in each folder and each policy,
// also with `policy.gateGuard: off`: an approval is the yes of the user, so the agent must not give it alone.
// In a mode with no prompt, they are denied, and the user runs them in a terminal.
// It reads the words of the command, so it is a net and not a wall: a script that pushes is not seen.
// A ticket whose README cannot be read stops a push and a new change request too: the gates are unknown (policy.gateGuard sets deny or ask).
// It never stops other work: a folder with no ticket, no wiki, or a config that cannot be read lets the command run.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolve, samePath } from './repo.mjs';
import { listTickets } from './tickets.mjs';
import { approvedDrafts, checkAction, isChangeDraft, regular, within } from './validation.mjs';
import { baseBranchOf, codeBinding, resolveCommit } from './code-bind.mjs';
import { FORGE_VALUE_OPTIONS } from './cli-options.mjs';
import { ticketOfFolder, trustedConfig } from './hook.mjs';

export const GUARD_MODES = ['deny', 'ask', 'off'];
const ENDS = ';|&()`';
const WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec']);
const MOVES = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const MAX_FINDINGS = 5;
const METHOD_OPTIONS = new Set(['-X', '--method']);
// The shells that run the text of a heredoc or a pipe as commands.
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell']);
const HELP = new Set(['--help', '-h']);
// The time budget of one preTool call (the hook limit is 30 s).
const DEADLINE_MS = 20000;
// The capabilities that change something outside the workspace. The core holds the names; the trusted config gives the commands.
export const WRITE_CAPABILITIES = ['tracker.comment', 'tracker.create', 'tracker.transition', 'tracker.link', 'repo.open-change', 'repo.update-change', 'repo.reply', 'ci.trigger'];
// Permission modes in which a host runs a command with no prompt, also after a hook `ask` (GH-2: Claude Code bypassPermissions).
const NO_PROMPT_MODES = new Set(['bypassPermissions']);

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
 * There are 2 exceptions, so that the text that a shell runs stays visible: a line with a shell command (`bash <<EOF`,
 * `cat <<EOF | sh`) keeps the heredoc text as commands, and `<<` in arithmetic (`$((a<<b))`) starts no heredoc.
 * A `#` at the start of a word starts a comment up to the end of the line, as in a shell.
 */
export function shellCommands(line) {
  const text = String(line ?? '');
  const commands = [];
  let words = [];
  let word = null;
  let quote = '';
  let heredocs = [];
  let lineStart = 0; // the index in `text` of the start of the current line
  let lineFirst = 0; // the index in `commands` of the first command of the current line
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
    if (c === '\\' && next !== undefined && (/\s/.test(next) || `'"\\<>#${ENDS}`.includes(next))) {
      if (next !== '\n') word = (word ?? '') + next;
      i++;
      continue;
    }
    if (c === '#' && word === null) {
      const stop = text.indexOf('\n', i);
      i = (stop === -1 ? text.length : stop) - 1;
      continue;
    }
    if (c === '<' && next === '<') {
      endWord();
      if (text[i + 2] === '<') { i += 2; continue; } // `<<<` is a here-string: its word is data on the same line.
      const before = text.slice(lineStart, i);
      const arithmetic = (before.match(/\(\(/g) ?? []).length > (before.match(/\)\)/g) ?? []).length;
      const strip = text[i + 2] === '-';
      const { delimiter, end } = heredocDelimiter(text, i + (strip ? 3 : 2));
      // Only a name is a delimiter, and not in arithmetic. So `$((1<<2))` starts no heredoc, and it cannot hide the commands after it.
      if (!arithmetic && /^[A-Za-z_][A-Za-z0-9_]*$/.test(delimiter)) { heredocs.push({ delimiter, strip }); i = end - 1; }
      else i += 1;
      continue;
    }
    if (c === '\n') {
      endCommand();
      // A shell on this line runs the heredoc text (`bash <<EOF`, `cat <<EOF | sh`), so that text stays as commands.
      const runsText = commands.slice(lineFirst).some((command) => SHELLS.has(toolName(toolWords(command)[0])));
      if (runsText) heredocs = [];
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
      lineStart = pos;
      lineFirst = commands.length;
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

/**
 * The approval action of a forge call, or null. The call is `node <...>/forge.mjs` or a launcher (`forge`, `forge.cmd`).
 * `gate-approve` is an action, except with `--dry-run` or a help word. `trust approve` is an action; `trust` alone is not.
 */
function approveCall(words, cwd) {
  const tool = toolName(words[0]);
  const base = (word) => String(word).split(/[\\/]/).pop().toLowerCase();
  let rest;
  if (tool === 'node') {
    const at = words.findIndex((word, i) => i > 0 && base(word) === 'forge.mjs');
    if (at === -1) return null;
    rest = words.slice(at + 1);
  } else if (['forge.mjs', 'forge', 'forge.cmd'].includes(base(words[0]))) rest = words.slice(1);
  else return null;
  // Plain words and option values: a value option takes the next word, so a quoted --answer is one word.
  const plain = [];
  let answer = '';
  let flags = false;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    const joined = /^(--[a-z-]+)=(.*)$/s.exec(word);
    if (joined && FORGE_VALUE_OPTIONS.has(joined[1])) { if (joined[1] === '--answer') answer = joined[2]; continue; }
    if (FORGE_VALUE_OPTIONS.has(word)) { if (word === '--answer') answer = rest[i + 1] ?? ''; i++; continue; }
    if (word === '--dry-run' || HELP.has(word)) { flags = true; continue; }
    if (!word.startsWith('-')) plain.push(word);
  }
  const [sub, first, second] = plain;
  if (sub === 'gate-approve' && !flags) return { kind: 'approve', cwd, command: 'gate-approve', key: first ?? '', gate: second ?? '', answer };
  if (sub === 'trust' && first === 'approve' && !flags) return { kind: 'approve', cwd, command: 'trust approve', files: plain.slice(2) };
  return null;
}

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
 * The HTTP method that a command names with `-X <method>`, `-X<method>`, `--method <method>`, or `--method=<method>`, in capitals.
 * When a command names more than one, the last one counts, as in the tools that read these options.
 */
function commandMethod(words) {
  let method = null;
  for (let i = 0; i < words.length; i++) {
    if (METHOD_OPTIONS.has(words[i])) {
      const value = words[i + 1];
      method = value && !value.includes('<') ? value.toUpperCase() : null;
      i++;
      continue;
    }
    const joined = /^(?:-X|--method=)(.+)$/.exec(words[i]);
    if (joined) method = joined[1].toUpperCase();
  }
  return method;
}

/** The cells after the name cell of the row of capability `name` in a config text, or null when the row is missing. */
function capabilityCells(text, name) {
  const head = new RegExp(`^\\|\\s*\`${name.replace('.', '\\.')}\`\\s*\\|`);
  const row = String(text ?? '').replace(/\r\n/g, '\n').split('\n').find((line) => head.test(line));
  return row ? row.split(/(?<!\\)\|/).slice(2, -1) : null;
}

/**
 * The commands of capability `name` in a config text: for each code span of the row, the first words up to the
 * first option or placeholder, as { words, method }. `method` is set when the span names an HTTP method option,
 * because then the same first words can also read. A git command is not in the list: `git push` is a ship action.
 * `notes: false` reads only the Command cell.
 */
export function capabilityCommands(text, name, { notes = true } = {}) {
  const cells = capabilityCells(text, name);
  if (!cells) return [];
  const found = [];
  for (const cell of notes ? cells : cells.slice(0, 1)) {
    for (const [, span] of cell.matchAll(/`([^`]+)`/g)) {
      const words = toolWords(shellCommands(span)[0] ?? []);
      const end = words.findIndex((word) => /^[-<[]/.test(word) || word.includes('<'));
      const first = (end === -1 ? words : words.slice(0, end)).map((word, i) => (i === 0 ? toolName(word) : word));
      if (first.length < 2 || first[0] === 'git') continue;
      const method = commandMethod(words);
      found.push(method ? { words: first, method } : { words: first });
    }
  }
  return found;
}

/** The commands that create a change request: the Command cell of the `repo.open-change` row of a repo.md text. */
export function changeCommands(repoText) {
  return capabilityCommands(repoText, 'repo.open-change', { notes: false }).map((command) => command.words);
}

/**
 * The write commands of a config: { capability, words, method } for each command of each write capability.
 * `texts` holds the text of each config file by its kind: { tracker, repo, ci }.
 */
export function writeCommands(texts = {}) {
  return WRITE_CAPABILITIES.flatMap((capability) => capabilityCommands(texts[capability.split('.')[0]], capability)
    .map((command) => ({ capability, ...command })));
}

/**
 * True when the words of a command (from index `from`) have the words `rest` in order, with options between them.
 * An option can have a value or not, so both readings are tried: a match in one of them is a match.
 */
function wordsInOrder(words, rest, from = 1) {
  if (!rest.length) return true;
  const word = words[from];
  if (word === undefined) return false;
  if (word === rest[0]) return wordsInOrder(words, rest.slice(1), from + 1);
  if (!word.startsWith('-')) return false;
  return wordsInOrder(words, rest, from + 1) || (!word.includes('=') && wordsInOrder(words, rest, from + 2));
}

/**
 * True when a command matches a config command: the same tool, then the config words in order, also with options
 * between them (`gh issue -R o/r comment`). A command with a method must name a method other than GET. A help call is no match.
 */
function matches(words, command) {
  if (toolName(words[0]) !== command.words[0] || !wordsInOrder(words, command.words.slice(1))) return false;
  if (words.some((word) => HELP.has(word))) return false;
  if (!command.method) return true;
  const method = commandMethod(words);
  return Boolean(method) && method !== 'GET';
}

/**
 * The branches that a `git push` names: { refs, all, sources, deletes }. The first plain word is the remote, and each other word is a
 * refspec `[+]<source>[:<target>]`. `all` is true for `--all`, `--mirror`, and `--branches`.
 * `sources` lists what the push sends: the source of each refspec, or `HEAD` for a push with no refspec (it is empty for a push of
 * all branches, of tags only, and of a pattern). `deletes` is true when the push only deletes refs (`--delete`, `-d`, or `:<target>`): it sends no code.
 * A push of a ticket branch can run from each folder of the repository, so the folder alone does not show the ticket.
 */
function pushTargets(args) {
  const plain = [];
  let all = false;
  let tags = false;
  let del = false;
  for (let i = 0; i < args.length; i++) {
    if (['--all', '--mirror', '--branches'].includes(args[i])) all = true;
    else if (args[i] === '--tags') tags = true;
    else if (args[i] === '--delete' || args[i] === '-d') del = true;
    else if (PUSH_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith('-')) plain.push(args[i]);
  }
  const specs = plain.slice(1).map((spec) => spec.replace(/^\+/, ''));
  const refs = specs.map((spec) => spec.split(':')[0].replace(/^refs\/heads\//, '')).filter(Boolean);
  const pieces = specs.filter((spec) => !del && spec.split(':')[0]);
  let sources = pieces.map((spec) => spec.split(':')[0]);
  const noSource = all || sources.some((source) => source.includes('*'));
  if (noSource) sources = [];
  else if (!specs.length && !del && !tags) sources = ['HEAD'];
  const deletes = del || (specs.length > 0 && specs.every((spec) => spec.startsWith(':')));
  return { refs, all, sources, deletes };
}

/**
 * The guarded actions of a shell line. Each action has the folder where it runs: `cd` and `git -C` change it.
 * - `approve`: a `forge.mjs gate-approve` or `forge.mjs trust approve` call (not with `--dry-run` or a help word), with its
 *   `command`, and the `key`, `gate`, and `answer` (gate-approve) or the `files` (trust approve).
 * - `push`: each `git push` (not a dry run), with the branches that it names (`refs`, `all`).
 * - `change`: a command that starts with one of the change commands (word lists).
 * - `write`: a command that matches one of the write commands ({ capability, words, method }), with its
 *   `capabilities` and its first `words`. A change command is not also a write action: the change action asks.
 */
export function guardActions(line, cwd, { changes = [], writes = [] } = {}) {
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
    const approval = approveCall(words, folder);
    if (approval) { actions.push(approval); continue; }
    if (tool === 'git') {
      const call = gitCall(words, folder);
      if (call.sub === 'push' && !call.args.some((arg) => arg === '--dry-run' || arg === '-n')) actions.push({ kind: 'push', cwd: call.cwd, ...pushTargets(call.args) });
      continue;
    }
    if (changes.some((first) => matches(words, { words: first }))) { actions.push({ kind: 'change', cwd: folder }); continue; }
    const hits = writes.filter((command) => matches(words, command));
    if (hits.length) {
      const longest = hits.reduce((a, b) => (b.words.length > a.words.length ? b : a));
      actions.push({ kind: 'write', cwd: folder, capabilities: [...new Set(hits.map((hit) => hit.capability))], words: [tool, ...longest.words.slice(1)] });
    }
  }
  return actions;
}

/** The ship actions of a shell line: each push and each change request command (see guardActions). */
export function shipActions(line, cwd, changes = []) {
  return guardActions(line, cwd, { changes });
}

/**
 * The hook input of each host: { cwd, command, mode }, or null when the tool call has no shell command.
 * Claude Code gives `tool_input`. The Copilot CLI format gives `toolArgs`, as an object or as JSON text.
 * `mode` is the permission mode of the session (Claude Code `permission_mode`), or '' when the host gives none.
 */
export function readToolEvent(raw) {
  let event;
  try { event = raw && raw.trim() ? JSON.parse(raw) : null; } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  let input = event.tool_input ?? event.toolArgs;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return null; } }
  const command = input && typeof input === 'object' ? input.command : null;
  if (typeof command !== 'string' || !command.trim()) return null;
  return { cwd: typeof event.cwd === 'string' ? event.cwd : '', command, mode: typeof event.permission_mode === 'string' ? event.permission_mode : '' };
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

function locate(cwd, env) {
  try { return resolve({ cwd, env }); } catch { return null; /* not in a Git repository */ }
}

function configText(where, file) {
  try { return readFileSync(path.join(where.configDir, file), 'utf8'); } catch { return ''; }
}

const LABEL = { push: 'a push', change: 'a new change request' };

/** The draft of the next write of a ticket: the README Sendable? `doc`, when it is an existing `outbox/*.draft.md` file. */
function draftOf(match) {
  if (match.broken) return null;
  const doc = match.ticket.gates.find((gate) => gate.name === 'Sendable?')?.doc;
  if (typeof doc !== 'string' || !/^outbox[\\/].+\.draft\.md$/.test(doc)) return null;
  const file = path.join(path.dirname(match.file), ...doc.split(/[\\/]/));
  try {
    return checkAction(match.ticket, match.file, 'write', { draft: doc }).allowed ? file : null;
  } catch { return null; }
}

/** True when the Shippable? approval covers exactly one `target: change` draft, and the ticket has no draft or open change request yet. */
function changeApproved(match) {
  const dir = path.dirname(match.file);
  const drafts = approvedDrafts(match.ticket, match.file, 'Shippable?').filter((relative) => isChangeDraft(dir, relative));
  return drafts.length === 1 && !(match.ticket.changes ?? []).some((entry) => ['draft', 'open'].includes(entry.state));
}

/** The ask verdict for a write: the reason names the ticket, the command, and the draft. */
function writeVerdict(match, action) {
  const key = match.ticket.key;
  const what = action.kind === 'change' ? 'a new change request (repo.open-change)' : `\`${action.words.join(' ')}\` (${action.capabilities.join(' or ')})`;
  const draft = draftOf(match);
  const text = draft ? `The text is in ${draft}.` : 'No outbox draft is in review for it (the README Sendable? doc).';
  return {
    decision: 'ask', key,
    question: `${key}: this command is an external write: ${what}. ${text}`,
    reason: `Forge gate guard: ${key}: this command is an external write: ${what}. ${text} Allow it only if you read the text and you want this one write now.`,
  };
}

/** The ask verdict for an approval command: the reason names the command and what it approves. */
function approveVerdict(action) {
  const what = action.command === 'gate-approve'
    ? `\`forge.mjs gate-approve\` records the approval of ${action.gate || '(no gate)'} for ${action.key || '(no key)'} with the answer ${JSON.stringify(action.answer)}`
    : `\`forge.mjs trust approve\` trusts the config and rule files ${action.files.length ? action.files.join(', ') : '(no file named)'}`;
  const key = action.key ?? '';
  const question = `this command is an approval: ${what}.`;
  return { decision: 'ask', key, question, reason: `Forge gate guard: ${question} Allow it only if you gave this answer yourself.` };
}

/** The message for a git error of the code check: the time limit and a missing base branch have their own text. */
function gitProblem(error, ticket, baseBranch) {
  if (error.code === 'deadline') return `Forge ran out of time while it read the code of ${ticket.branch} (the hook has a limit of ${DEADLINE_MS / 1000} s). Try again.`;
  if (error.code === 'base-missing') return `base branch ${error.baseBranch ?? baseBranch} not found: set repo.baseBranch.`;
  return `Forge cannot read the code of ${ticket.branch} to compare it with the Shippable? approval: ${error.message} Run \`git fetch\`, then try again.`;
}

/**
 * The message of the code binding check at a push, or '' when the code is the code of the Shippable? approval.
 * The approved manifest holds `code` ({ head, base, patchId, branch }). The branch of the README must be that branch (also when the README
 * branch is empty), the push must send the head of that branch (each source of the refspecs of `action`), and the patch-id of the
 * diff from the merge base must be the same. A clean rebase keeps the patch-id. A git error gives its own message: it is not a mismatch.
 * A push that only deletes refs, and a closed ticket (its work is merged), get no check. `deadline` is the end of the time budget of the call.
 */
function codeMismatch(match, where, config, action, deadline) {
  const ticket = match.ticket;
  if (ticket.phase === 'closed' || action.deletes) return '';
  const gate = ticket.gates.find((item) => item.name === 'Shippable?');
  let code = null;
  try { code = JSON.parse(regular(within(path.dirname(match.file), gate.manifest)).toString('utf8'))?.code; } catch { /* No readable code is the same as no code. */ }
  const bound = code && typeof code === 'object' && code.patchId && code.branch;
  if (!bound) {
    return ticket.branch ? 'The Shippable? approval has no code binding: it was approved before Forge 13.1.0 or without a code binding. Open Shippable? again.' : '';
  }
  if (!ticket.branch) return `the README branch is empty, but the Shippable? approval binds the branch ${code.branch}. Open Shippable? again.`;
  if (code.branch !== ticket.branch) return `The README branch (${ticket.branch}) is not the branch of the Shippable? approval (${code.branch}). Open Shippable? again.`;
  if (!config) return 'the Forge config is not trusted (run `forge.mjs trust`).';
  const baseBranch = baseBranchOf(config, where.repo.path);
  let now;
  try { now = codeBinding({ worktree: ticket.worktree || where.repo.path, branch: ticket.branch, baseBranch, deadline }); }
  catch (error) { return gitProblem(error, ticket, baseBranch); }
  for (const source of action.sources ?? []) {
    let sent = '';
    try { sent = resolveCommit(action.cwd, source, { deadline }); }
    catch (error) { return gitProblem(error, ticket, baseBranch); }
    if (sent !== now.head) return `this push sends ${sent ? sent.slice(0, 12) : `${source} (no commit)`}, not the head of the ticket branch ${ticket.branch} (${now.head.slice(0, 12)}). Push the branch itself.`;
  }
  if (now.patchId !== code.patchId) return `The code changed after the Shippable? approval (patch-id ${now.patchId.slice(0, 12)}, approved ${String(code.patchId).slice(0, 12)}). Review the new code and open Shippable? again.`;
  return '';
}

/** A host that does not show a prompt in this mode runs an `ask` with no "yes", so the guard denies instead. */
function noPrompt(verdict, mode) {
  if (verdict?.decision !== 'ask' || !NO_PROMPT_MODES.has(mode)) return verdict;
  const question = verdict.question ?? `${verdict.key} has no valid approval for this step.`;
  return {
    decision: 'deny', key: verdict.key,
    reason: `Forge gate guard: ${question} This session runs in ${mode} mode, so the host shows the user no prompt for it. Do not run the command in another form. Show the user the text and the exact command, and ask the user to run it in a terminal, or to change the permission mode of the session.`,
  };
}

/**
 * The verdict for one tool call: null to let it run, or { decision, key, reason }.
 * - A push or a new change request needs the ship gates. Without them: `deny` or `ask`, from `policy.gateGuard`
 *   (default `deny`; `off` stops the guard).
 * - A write (one of WRITE_CAPABILITIES) gets `ask`: the prompt of the host is the "yes" for this one write.
 *   A new change request with valid gates gets `ask` too, unless its draft is the one `target: change` file of the approved
 *   Shippable? set and no draft or open change request exists: then it gets no verdict.
 *   In a mode with no prompt (NO_PROMPT_MODES), each `ask` becomes `deny`.
 * - An approval command (`gate-approve`, `trust approve`) gets `ask` in each folder, also with `gateGuard: off`,
 *   and `deny` in a mode with no prompt.
 * - A `deny` wins over an `ask`. Only a trusted config can change the mode or add commands.
 */
export function preTool(event, { env = process.env, deadlineMs = DEADLINE_MS } = {}) {
  if (!event?.command) return null;
  // One time budget for all git calls of the code checks of this call: the hook has a limit of 30 s.
  const deadline = Date.now() + deadlineMs;
  const base = event.cwd || process.cwd();
  const home = locate(base, env);
  const homeConfig = home?.wiki.exists ? trustedConfig(home, env) : null;
  const changes = homeConfig ? changeCommands(configText(home, 'repo.md')) : [];
  const writes = homeConfig ? writeCommands({ tracker: configText(home, 'tracker.md'), repo: configText(home, 'repo.md'), ci: configText(home, 'ci.md') }) : [];
  const verdicts = [];
  // The ticket of a folder, and each ticket whose branch a push names: a push of a ticket branch runs from each folder.
  const ticketsAt = (where, config, action, cwd) => {
    if (!where?.wiki.exists || samePath(where.top, where.wiki.path)) return [];
    try {
      // A ticket with a README that cannot be read stays in the list as a stand-in (broken), after the parsed tickets.
      const all = listTickets(where.wiki.path);
      const tickets = [...all.filter((entry) => entry.ticket), ...all.filter((entry) => !entry.ticket).map((entry) => ({ ...entry, broken: true, ticket: { ...entry.head, gates: [], changes: [] } }))];
      const branch = git(cwd, ['branch', '--show-current']);
      const here = ticketOfFolder(tickets, { here: where.top, branch, inMain: samePath(where.top, where.repo.path), getConfig: () => config });
      const named = action.kind === 'push' ? tickets.filter((entry) => entry.ticket.branch && (action.all || action.refs.includes(entry.ticket.branch))) : [];
      return [...new Set([here, ...named].filter(Boolean))];
    } catch { return []; }
  };
  for (const action of guardActions(event.command, base, { changes, writes })) {
    // An approval needs no ticket, no wiki, and no trusted config, and no gateGuard mode turns it off.
    if (action.kind === 'approve') { verdicts.push(approveVerdict(action)); continue; }
    let where = samePath(action.cwd, base) ? home : locate(action.cwd, env);
    let config = where === home ? homeConfig : (where?.wiki.exists ? trustedConfig(where, env) : null);
    let found = ticketsAt(where, config, action, action.cwd);
    // A write names its target (for example `-R owner/repo`), so a `cd` to another folder does not change it:
    // the ticket of the session folder is the ticket of the write (GH-2 review).
    if (!found.length && action.kind === 'write' && where !== home) {
      where = home;
      config = homeConfig;
      found = ticketsAt(home, homeConfig, action, base);
    }
    if (!found.length) continue;
    const mode = GUARD_MODES.includes(config?.policy?.gateGuard) ? config.policy.gateGuard : 'deny';
    if (mode === 'off') continue;
    for (const match of found) {
      if (match.broken) {
        if (action.kind === 'write') { verdicts.push(writeVerdict(match, action)); continue; }
        const key = match.ticket.key;
        const question = `${key} has a README that Forge cannot read, so the gates for ${LABEL[action.kind]} are unknown. README: ${match.file}. Error: ${match.error}`;
        verdicts.push(mode === 'ask'
          ? { decision: 'ask', key, question, reason: `Forge gate guard: ${question} Allow this command only if you accept the step without the gate check.` }
          : { decision: 'deny', key, reason: `Forge gate guard: ${question} Show the user the error. Repair the README only as the user says, and check it with \`forge.mjs lint\`. Do not run the command in another form.` });
        continue;
      }
      if (action.kind !== 'write') {
        let verdict;
        try { verdict = checkAction(match.ticket, match.file, 'ship'); } catch { continue; }
        if (!verdict.allowed) {
          const messages = [...new Set(verdict.findings.map((item) => item.message))];
          const shown = messages.slice(0, MAX_FINDINGS).join(' ');
          const more = messages.length > MAX_FINDINGS ? ` There are ${messages.length - MAX_FINDINGS} more findings: run \`forge.mjs lint\`.` : '';
          const key = match.ticket.key;
          const question = `${key} has no valid approval for ${LABEL[action.kind]}. ${shown}${more}`;
          verdicts.push(mode === 'ask'
            ? { decision: 'ask', key, question, reason: `Forge gate guard: ${question} Allow this command only if you accept the step without the gate.` }
            : { decision: 'deny', key, reason: `Forge gate guard: ${question} Open the gate as the ticket skill says (Review gates), and wait for the answer of the user. Do not run the command in another form. Tell the user which approval is missing, and offer to open the gate.` });
          continue;
        }
        if (action.kind === 'push') {
          const problem = codeMismatch(match, where, config, action, deadline);
          if (problem) {
            const key = match.ticket.key;
            const question = `${key}: ${problem}`;
            verdicts.push(mode === 'ask'
              ? { decision: 'ask', key, question, reason: `Forge gate guard: ${question} Allow this push only if you accept the step without the code check.` }
              : { decision: 'deny', key, reason: `Forge gate guard: ${question} Do not run the command in another form. Tell the user what is wrong.` });
            continue;
          }
        }
        if (action.kind === 'push' || (action.kind === 'change' && changeApproved(match))) continue;
      }
      verdicts.push(writeVerdict(match, action));
    }
  }
  const verdict = verdicts.find((item) => item.decision === 'deny') ?? verdicts[0] ?? null;
  const final = noPrompt(verdict, event.mode);
  return final && { decision: final.decision, key: final.key, reason: final.reason };
}

/** The hook output of a host for a verdict of preTool. No verdict gives {}, so the normal permission flow continues. */
export function preToolOutput(verdict, host) {
  if (!verdict) return {};
  if (host === 'claude') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } };
  }
  return { permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason };
}
