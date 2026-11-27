// The gate guard: the preToolUse hook of each host. Before a shell command pushes a ticket branch,
// it checks the gates of the ticket with checkAction('ship'): the same check
// as `forge.mjs lint`, so a missing or stale Shippable? approval stops the command, not only a written rule.
// The approval command `forge.mjs gate-approve` gets `ask` in each folder and each mode of the guard,
// also with FORGE_GATE_GUARD=off: an approval is the yes of the user, so the agent must not give it alone.
// In a mode with no prompt, they are denied, and the user runs them in a terminal.
// It reads the words of the command, so it is a net and not a wall: a script that pushes is not seen.
// A ticket whose README cannot be read stops a push too: the gates are unknown (FORGE_GATE_GUARD and policy.gateGuard set deny or ask).
// It never stops other work: a folder with no ticket, no wiki, or a config that cannot be read lets the command run.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { resolve, samePath } from './repo.mjs';
import { isForgeLayout } from './layout.mjs';
import { listTickets } from './tickets.mjs';
import { checkAction, regular, within } from './validation.mjs';
import { baseBranchOf, codeBinding, resolveCommit } from './code-bind.mjs';
import { FORGE_VALUE_OPTIONS } from './cli-options.mjs';
import { safeConfig, ticketOfFolder } from './hook.mjs';

export const GUARD_MODES = ['deny', 'ask', 'off'];

/**
 * The mode of the guard. FORGE_GATE_GUARD (deny, ask, off) wins. Else the wiki value: only `ask` counts, and any other value
 * (also `off` since 14.1.0) acts as `deny`.
 */
export function guardMode(config, env = process.env) {
  const fromEnv = String(env.FORGE_GATE_GUARD ?? '').trim().toLowerCase();
  if (GUARD_MODES.includes(fromEnv)) return fromEnv;
  return config?.policy?.gateGuard === 'ask' ? 'ask' : 'deny';
}
const ENDS = ';|&()`';
// The wrappers that start another command, with their options that take a value (the next word).
const WRAPPERS = new Map([
  ['sudo', new Set(['-u', '-g', '-C', '-D', '--user', '--group', '--chdir'])],
  ['env', new Set(['-u', '-C', '--unset', '--chdir'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['timeout', new Set(['-s', '-k', '--signal', '--kill-after'])],
  ['stdbuf', new Set(['-i', '-o', '-e', '--input', '--output', '--error'])],
  ['command', new Set()],
  ['exec', new Set(['-a'])],
  ['time', new Set(['-f', '-o', '--format', '--output'])],
  ['nohup', new Set()],
]);
// A shell keyword before a command is not the tool. A command that starts with a word of NO_TOOL has no tool.
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '{', '!']);
const NO_TOOL = new Set(['for', 'select', 'case', 'fi', 'done', 'esac', '}']);
// The tools that run JavaScript, and the launchers of forge.
const SCRIPT_TOOLS = new Set(['node', 'bun', 'deno']);
const LAUNCHERS = new Set(['npx', 'forge', 'forge.cmd', 'forge.mjs']);
const EVAL_OPTIONS = new Set(['-e', '--eval', '-p', '--print', '--import', '-r', '--require']);
const APPROVAL_TEXT = /gate-approve|approve\.mjs|approveGate/;
const MOVES = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const MAX_FINDINGS = 5;
// The shells that run the text of a heredoc or a pipe as commands.
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell']);
const HELP = new Set(['--help', '-h']);
// The time budget of one preTool call (the hook limit is 30 s).
const DEADLINE_MS = 20000;
// Permission modes in which a host runs a command with no prompt, also after a hook `ask` (GH-2: Claude Code bypassPermissions).
const NO_PROMPT_MODES = new Set(['bypassPermissions']);

/**
 * The delimiter of a heredoc that starts at `text[start]` (after `<<` or `<<-`): { delimiter, end, quoted }.
 * Quotes in the delimiter word group it, and they are not part of it: `'EOF'` and `"EOF"` give `EOF`.
 * `quoted` is true when a quote or a backslash is in the word: the shell expands nothing in that body.
 */
function heredocDelimiter(text, start) {
  let i = start;
  while (text[i] === ' ' || text[i] === '\t') i++;
  let delimiter = '';
  let quoted = false;
  while (i < text.length && !/\s/.test(text[i]) && !ENDS.includes(text[i]) && text[i] !== '<' && text[i] !== '>') {
    const c = text[i];
    if (c === "'" || c === '"') {
      const close = text.indexOf(c, i + 1);
      const stop = close === -1 ? text.length : close;
      delimiter += text.slice(i + 1, stop);
      quoted = true;
      i = stop + 1;
    } else if (c === '\\' && i + 1 < text.length) { delimiter += text[i + 1]; quoted = true; i += 2; }
    else { delimiter += c; i++; }
  }
  return { delimiter, end: i, quoted };
}

/** The index of the `)` that closes the `(` at `text[open]`, or -1. Quotes and escapes inside are skipped. */
function matchParen(text, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '\\') i++;
    else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The substitution that starts at `text[i]`: `$( )` or a pair of backticks. It gives { inner, end } (the text inside, and the index of
 * the last character), or null. A substitution with no end runs to the end of the text, as a shell reads it.
 */
function substitutionAt(text, i) {
  if (text[i] === '$' && text[i + 1] === '(') {
    const close = matchParen(text, i + 1);
    return { inner: text.slice(i + 2, close === -1 ? text.length : close), end: close === -1 ? text.length - 1 : close };
  }
  if (text[i] === '`') {
    let close = -1;
    for (let j = i + 1; j < text.length && close === -1; j++) {
      if (text[j] === '\\') j++;
      else if (text[j] === '`') close = j;
    }
    return { inner: text.slice(i + 1, close === -1 ? text.length : close), end: close === -1 ? text.length - 1 : close };
  }
  return null;
}

/** The inner text of each `$( )` and backtick span of a heredoc body. A backslash before `$` or a backtick makes it text. */
function bodySubstitutions(body) {
  const found = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') { i++; continue; }
    const sub = substitutionAt(body, i);
    if (sub) { found.push(sub.inner); i = sub.end; }
  }
  return found;
}

/**
 * The commands of one shell line, each as a list of words. Quotes group a word.
 * `&&`, `||`, `;`, `|`, `&`, parentheses, backticks, and new lines end a command.
 * A backslash is an escape only before a space, a quote, or one of these characters, so a Windows path keeps its backslashes.
 * The text of a heredoc (`<<EOF`, `<<'EOF'`, `<<-EOF`) is data, not commands: the lines up to the end line give no command.
 * There are 2 exceptions, so that the text that a shell runs stays visible: a line with a shell command (`bash <<EOF`,
 * `cat <<EOF | sh`) keeps the heredoc text as commands, and `<<` in arithmetic (`$((a<<b))`) starts no heredoc.
 * A `#` at the start of a word starts a comment up to the end of the line, as in a shell.
 * `$( )` and backticks give commands, also inside double quotes. A heredoc with an unquoted delimiter gives the `$( )` and
 * backtick spans of its body as commands, because the shell runs them. A quoted delimiter keeps the whole body as data.
 */
export function shellCommands(line) {
  return scanShell(line).filter((item) => item.words).map((item) => item.words);
}

/**
 * The items of a shell line, in order: `{ words }` for a command (with `heredoc`, the body text of its heredocs, when it has them,
 * and `prev` and `next`, the operators before and after it: `;`, `&&`, `||`, `|`, `&`, or null for a new line or a group),
 * and `{ open: true }` and `{ close: true }` for each parenthesis or backtick pair, so that a caller can scope a `cd`.
 */
function scanShell(line) {
  const text = String(line ?? '');
  const items = [];
  let words = [];
  let word = null;
  let quote = '';
  let heredocs = [];
  let tick = false; // true between a pair of backticks
  let lineStart = 0; // the index in `text` of the start of the current line
  let lineFirst = 0; // the index in `items` of the first item of the current line
  let lastOp = null; // the operator before the next command
  let lastItem = null; // the command item that the last endCommand call made, to set its `next`
  const endWord = () => { if (word !== null) { words.push(word); word = null; } };
  const inside = (inner) => { items.push({ open: true }, ...scanShell(inner), { close: true }); };
  // The commands of substitutions in quotes wait until their own command is done, so that the command comes first.
  let pending = [];
  const endCommand = () => {
    endWord();
    lastItem = null;
    if (words.length) { lastItem = { words, prev: lastOp }; items.push(lastItem); lastOp = null; }
    words = [];
    for (const inner of pending) inside(inner);
    pending = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && next !== undefined && '"\\$`'.includes(next)) { word += next; i++; }
      else if (quote === '"' && (c === '$' || c === '`') && substitutionAt(text, i)) {
        // The shell runs a substitution inside double quotes. The word keeps its text.
        const sub = substitutionAt(text, i);
        pending.push(sub.inner);
        word += text.slice(i, sub.end + 1);
        i = sub.end;
      }
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
      const { delimiter, end, quoted } = heredocDelimiter(text, i + (strip ? 3 : 2));
      // Only a name is a delimiter, and not in arithmetic. So `$((1<<2))` starts no heredoc, and it cannot hide the commands after it.
      if (!arithmetic && /^[A-Za-z_][A-Za-z0-9_]*$/.test(delimiter)) { heredocs.push({ delimiter, strip, quoted, owner: words }); i = end - 1; }
      else i += 1;
      continue;
    }
    if (c === '\n') {
      endCommand();
      lastOp = null;
      // A shell on this line runs the heredoc text (`bash <<EOF`, `cat <<EOF | sh`), so that text stays as commands.
      const runsText = items.slice(lineFirst).some((item) => item.words && SHELLS.has(toolName(toolWords(item.words)[0])));
      if (runsText) heredocs = [];
      // Skip the text of each heredoc of this line, up to and with its end line.
      let pos = i + 1;
      for (const { delimiter, strip, quoted, owner } of heredocs) {
        const bodyStart = pos;
        let bodyEnd = text.length;
        while (pos < text.length) {
          const stop = text.indexOf('\n', pos);
          const lineEnd = stop === -1 ? text.length : stop;
          const lineBegin = pos;
          const body = text.slice(pos, lineEnd).replace(/\r$/, '');
          pos = lineEnd + 1;
          if ((strip ? body.replace(/^\t+/, '') : body) === delimiter) { bodyEnd = lineBegin; break; }
        }
        const body = text.slice(bodyStart, bodyEnd);
        // The command keeps the body text, for the scan of node and shells. An unquoted body gives its substitutions as commands.
        const command = items.find((item) => item.words === owner);
        if (command) command.heredoc = (command.heredoc ?? '') + body;
        if (!quoted) for (const inner of bodySubstitutions(body)) inside(inner);
      }
      heredocs = [];
      i = pos - 1;
      lineStart = pos;
      lineFirst = items.length;
      continue;
    }
    if (/\s/.test(c)) { endWord(); continue; }
    if (c === '(' || c === ')') { endCommand(); lastOp = null; items.push(c === '(' ? { open: true } : { close: true }); continue; }
    if (c === '`') {
      // An opening backtick stays in the word, as `$` does, so that `cd `pwd`` has a target that is not known.
      if (!tick) word = (word ?? '') + c;
      endCommand();
      lastOp = null;
      items.push(tick ? { close: true } : { open: true });
      tick = !tick;
      continue;
    }
    if (ENDS.includes(c)) {
      endCommand();
      // The operator: `&&` and `||` are one operator, `|&` is a pipe, and `>&`, `<&`, and `&>` are redirections, not a background `&`.
      let op = c;
      if ((c === '&' || c === '|') && next === c) { op = c + c; i++; }
      else if (c === '|' && next === '&') i++;
      else if (c === '&' && (text[i - 1] === '>' || text[i - 1] === '<' || next === '>')) op = ';';
      if (lastItem) lastItem.next = op;
      lastOp = op;
      continue;
    }
    word = (word ?? '') + c;
  }
  endCommand();
  return items;
}

/**
 * The words of a command without the variable assignments, the shell keywords (`if`, `then`, `do`, `!`, ...), and the wrappers
 * with their options (`sudo -u x`, `timeout -s KILL 30`, `nice -n 5`, ...) before the tool. A command that starts with `for`, `case`,
 * `fi`, `done`, or `}` has no tool.
 */
function toolWords(words) {
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || KEYWORDS.has(word)) { i++; continue; }
    const name = toolName(word);
    if (!WRAPPERS.has(name)) break;
    const step = skipWrapper(name, words, i);
    if (step.words) return toolWords(step.words);
    i = step.next;
  }
  return NO_TOOL.has(words[i]) ? [] : words.slice(i);
}

/**
 * The end of a wrapper: { next } is the index of the first word after the wrapper and its options. The options of WRAPPERS take a value;
 * any other option has no value. `--` ends the options, and `timeout` takes one duration word. `env -S <text>` splits its text into a
 * command, so it gives { words }: the words of that text, then the words after it.
 */
function skipWrapper(name, words, from) {
  const values = WRAPPERS.get(name);
  let i = from + 1;
  while (i < words.length) {
    const word = words[i];
    if (word === '--') { i++; break; }
    if (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) { i++; continue; }
    if (!word.startsWith('-') || word === '-') break;
    if (name === 'env' && (word === '-S' || word === '--split-string')) {
      return { words: [...(shellCommands(words[i + 1] ?? '')[0] ?? []), ...words.slice(i + 2)] };
    }
    if (name === 'env' && (word.startsWith('--split-string=') || /^-S./.test(word))) {
      return { words: [...(shellCommands(word.startsWith('--') ? word.slice(15) : word.slice(2))[0] ?? []), ...words.slice(i + 1)] };
    }
    i += values.has(word) ? 2 : 1;
  }
  if (name === 'timeout' && i < words.length) i++;
  return { next: i };
}

const toolName = (word) => String(word ?? '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

/**
 * The approval action of a forge call, or null. The call is `node <...>/forge.mjs` or a launcher (`forge`, `forge.cmd`).
 * `gate-approve` is an action, except with `--dry-run` or a help word.
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
  return null;
}

/**
 * True when a command can run an approval in a form that approveCall does not read (the text scan). It is true when:
 * (a) the tool is node, bun, deno, or npx, and its script word (the first word that is no option) is not known (it has `$` or a backtick),
 *     and a word is `gate-approve`; or the script word is forge.mjs or a launcher of forge, and
 *     `gate-approve` is the subcommand of the call that approveCall reads. For npx the launcher can follow options;
 * (b) the tool is node, bun, or deno, and the value of `-e`, `--eval`, `-p`, `--print`, `--import`, or `-r` names `approve.mjs` or `approveGate`;
 * (c) the tool is a shell with `-c`, and its string names `gate-approve` or `approve.mjs`;
 * (d) the tool is node, bun, deno, or a shell, and the body of its heredoc names one of these.
 * A dry run or a help word is no approval. A plain `node --check .../approve.mjs` or `node --test` is none of these.
 * `grep` and `cat` are other tools, so they give no verdict.
 */
function approvalText(words, heredoc) {
  const tool = toolName(words[0]);
  const rest = words.slice(1);
  if (rest.includes('--dry-run') || rest.some((word) => HELP.has(word))) return false;
  const script = SCRIPT_TOOLS.has(tool);
  if (script || tool === 'npx') {
    const first = rest.find((word) => !word.startsWith('-'));
    if (first !== undefined && /[$`]/.test(first)) {
      if (rest.includes('gate-approve')) return true;
    } else if (first !== undefined) {
      const at = rest.findIndex((word) => LAUNCHERS.has(toolName(word)) || toolName(word) === 'forge.mjs');
      if (at !== -1 && (tool === 'npx' || rest[at] === first) && approveCall(['forge', ...rest.slice(at + 1)], '')) return true;
    }
  }
  if (script) {
    for (let i = 0; i < rest.length; i++) {
      const joined = /^(--[a-z-]+)=(.*)$/s.exec(rest[i]);
      const value = joined && EVAL_OPTIONS.has(joined[1]) ? joined[2] : EVAL_OPTIONS.has(rest[i]) ? rest[i + 1] : null;
      if (value !== null && value !== undefined && /approve\.mjs|approveGate/.test(value)) return true;
    }
  }
  if (SHELLS.has(tool)) {
    const at = rest.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
    if (at !== -1 && rest.slice(at + 1).some((word) => APPROVAL_TEXT.test(word))) return true;
  }
  return (script || SHELLS.has(tool)) && typeof heredoc === 'string' && APPROVAL_TEXT.test(heredoc);
}

/** The home folder for `~`: HOME, else USERPROFILE, else the home of the user. */
function homeFolder(env) {
  return env?.HOME || env?.USERPROFILE || os.homedir();
}

/**
 * The folder that a `cd` or `git -C` target selects from `base`, or null when it cannot be known: a target with `$` or a backtick,
 * `~user`, or `-`. A relative target from an unknown folder is unknown. `~` and `~/x` use the home folder.
 */
function moveTo(base, target, env) {
  if (/[$`]/.test(target) || target === '-' || /^~[^/\\]/.test(target)) return null;
  if (target === '~' || target.startsWith('~/') || target.startsWith('~\\')) return path.resolve(homeFolder(env), target.slice(2));
  if (base === null) return path.isAbsolute(target) ? path.resolve(target) : null;
  return path.resolve(base, target);
}

/** The subcommand of a git call, its arguments, and the folder that `-C` selects (null when it is unknown). */
function gitCall(words, cwd, env) {
  let folder = cwd;
  let i = 1;
  while (i < words.length) {
    const word = words[i];
    if (word === '-C' && words[i + 1] !== undefined) { folder = moveTo(folder, words[i + 1], env); i += 2; }
    else if (GIT_VALUE_OPTIONS.has(word)) i += 2;
    else if (word.startsWith('-')) i += 1;
    else break;
  }
  return { sub: words[i] ?? '', args: words.slice(i + 1), cwd: folder };
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
 * - `approve`: a `forge.mjs gate-approve` call (not with `--dry-run` or a help word), with its
 *   `command`, and the `key`, `gate`, and `answer`. A command that approveCall
 *   does not read, but that the text scan finds (approvalText), is an `approve` action with `scan: true`.
 * - `push`: each `git push` (not a dry run), with the branches that it names (`refs`, `all`).
 * A `cd` inside parentheses, `$( )`, or backticks does not change the folder after them. A `cd` in a pipeline (`cd x | cmd`) or before `&`
 * runs in another shell and does not move the folder. A `cd` after `&&` or `||`, or before `||`, may not run: the next commands have two
 * possible folders (before and after), and a push gets an action for each. When a `cd` or `git -C` target cannot be known,
 * the action has `unknown: true` and the session folder `cwd`, so that preTool uses the ticket of the session folder.
 * `env` gives the home folder for `~` (HOME, USERPROFILE).
 */
export function guardActions(line, cwd, { env = process.env } = {}) {
  const actions = [];
  let folders = [cwd]; // the possible folders of the next command (null when a folder is unknown)
  const saved = [];
  const here = (known = folders[0]) => ({ cwd: known ?? cwd, ...(known === null ? { unknown: true } : {}) });
  const unique = (list) => [...new Set(list)];
  for (const item of scanShell(line)) {
    if (item.open) { saved.push(folders); continue; }
    if (item.close) { if (saved.length) folders = saved.pop(); continue; }
    const words = toolWords(item.words);
    if (!words.length) continue;
    const tool = toolName(words[0]);
    if (MOVES.has(tool)) {
      // A cd in a pipeline or before `&` runs in another shell.
      if (item.next === '|' || item.next === '&' || item.prev === '|') continue;
      const target = words.slice(1).find((word) => word === '-' || !word.startsWith('-'));
      const moved = folders.map((from) => (target ? moveTo(from, target, env) : tool === 'cd' ? homeFolder(env) : from));
      const conditional = item.prev === '&&' || item.prev === '||' || item.next === '||';
      folders = unique(conditional ? [...folders, ...moved] : moved);
      continue;
    }
    const approval = approveCall(words, folders[0] ?? cwd);
    if (approval) { actions.push({ ...approval, ...here() }); continue; }
    if (approvalText(words, item.heredoc)) { actions.push({ kind: 'approve', ...here(), command: 'approve text', scan: true, key: '', gate: '', answer: '', files: [] }); continue; }
    if (tool === 'git') {
      const calls = unique(folders.map((from) => gitCall(words, from, env)).map((call) => JSON.stringify(call))).map((text) => JSON.parse(text));
      for (const call of calls) {
        if (call.sub === 'push' && !call.args.some((arg) => arg === '--dry-run' || arg === '-n')) actions.push({ kind: 'push', ...here(call.cwd), ...pushTargets(call.args) });
      }
      continue;
    }
  }
  return actions;
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

/** The place of a folder: { where } or { error } (not in a Git repository, a wiki that does not match, a binding that cannot be read). */
function tryLocate(cwd, env) {
  try { return { where: resolve({ cwd, env }) }; } catch (error) { return { where: null, error }; }
}

/**
 * The problem of a push that Forge cannot place: a Git work tree where resolve fails, or a folder that is its own wiki and not a Forge layout.
 * It is '' when the push can go on. A wiki-mismatch keeps its own text.
 */
function unplaced(folder, { where, error }) {
  if (where) {
    return samePath(where.top, where.wiki.path) && !isForgeLayout(where.wiki.path) ? 'Forge cannot find the wiki of this work tree: the folder is its own wiki.' : '';
  }
  if (!error || git(folder, ['rev-parse', '--is-inside-work-tree']) !== 'true') return '';
  return error.code === 'wiki-mismatch' ? error.message : `Forge cannot find the wiki of this work tree: ${error.message}`;
}

const LABEL = { push: 'a push' };

/** The ask verdict for an approval command: the reason names the command and what it approves. */
function approveVerdict(action) {
  if (action.scan) {
    const question = 'this command can run a Forge approval in a form that the guard cannot read: it names gate-approve or approve.mjs.';
    return { decision: 'ask', key: '', question, reason: `Forge gate guard: ${question} Allow it only if you gave this answer yourself.` };
  }
  const what = `\`forge.mjs gate-approve\` records the approval of ${action.gate || '(no gate)'} for ${action.key || '(no key)'} with the answer ${JSON.stringify(action.answer)}`;
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
  if (!config) return 'the Forge config cannot be read (run `forge.mjs doctor`).';
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
 * - A push needs the ship gates. Without them: `deny` or `ask`, from guardMode (FORGE_GATE_GUARD, then `policy.gateGuard`;
 *   default `deny`; only FORGE_GATE_GUARD=off stops the guard).
 * - An approval command (`gate-approve`) gets `ask` in each folder, also with the guard off,
 *   and `deny` in a mode with no prompt.
 * - A `deny` wins over an `ask`.
 */
export function preTool(event, { env = process.env, deadlineMs = DEADLINE_MS } = {}) {
  if (!event?.command) return null;
  // One time budget for all git calls of the code checks of this call: the hook has a limit of 30 s.
  const deadline = Date.now() + deadlineMs;
  const base = event.cwd || process.cwd();
  const homeTry = tryLocate(base, env);
  const home = homeTry.where;
  const homeConfig = home?.wiki.exists ? safeConfig(home, env) : null;
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
  for (const action of guardActions(event.command, base, { env })) {
    // An approval needs no ticket, no wiki, and no readable config, and no guard mode turns it off.
    if (action.kind === 'approve') { verdicts.push(approveVerdict(action)); continue; }
    const placed = samePath(action.cwd, base) ? homeTry : tryLocate(action.cwd, env);
    let where = placed.where;
    if (action.kind === 'push') {
      const problem = unplaced(action.cwd, placed);
      if (problem) {
        const text = placed.error?.code === 'wiki-mismatch' ? problem : `${problem} A forge/repo.json file in a code folder is not a wiki binding: a wiki is the folder wiki/ of a <name>.forge folder.`;
        verdicts.push({ decision: 'deny', key: '', reason: `Forge gate guard: ${text} Do not run the command in another form. Tell the user what is wrong.` });
        continue;
      }
    }
    let config = where === home ? homeConfig : (where?.wiki.exists ? safeConfig(where, env) : null);
    let found = ticketsAt(where, config, action, action.cwd);
    // A push in a folder that Forge cannot know (`cd $X`) or that is no Git work tree (`cd ~/nowhere`)
    // uses the ticket of the session folder too. A push in another real repository keeps its folder.
    const lost = action.kind === 'push' && (action.unknown || !where);
    if (!found.length && lost && where !== home) {
      where = home;
      config = homeConfig;
      found = ticketsAt(home, homeConfig, action, base);
    }
    if (!found.length) continue;
    const mode = guardMode(config, env);
    if (mode === 'off') continue;
    for (const match of found) {
      if (match.broken) {
        const key = match.ticket.key;
        const question = `${key} has a README that Forge cannot read, so the gates for ${LABEL[action.kind]} are unknown. README: ${match.file}. Error: ${match.error}`;
        verdicts.push(mode === 'ask'
          ? { decision: 'ask', key, question, reason: `Forge gate guard: ${question} Allow this command only if you accept the step without the gate check.` }
          : { decision: 'deny', key, reason: `Forge gate guard: ${question} Show the user the error. Repair the README only as the user says, and check it with \`forge.mjs lint\`. Do not run the command in another form.` });
        continue;
      }
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
