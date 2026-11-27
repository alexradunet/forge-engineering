// The sessionStart hook gives each session the Forge context: the resolved paths, the ticket part
// (title and Now card) when the session opens on a ticket, the `forge` and `style` rules, and the
// company rules of the wiki (with a notice for a rule page that changed since the last session). Plugin rule files do not load in each session, so the hook
// carries them. It never blocks a session: a part that fails is left out.
// Hosts: `copilot-cli` (the Copilot CLI) gets one additionalContext.
// `claude` (Claude Code) moves an additionalContext value of more than 10,000 characters to a file,
// so the text goes in parts. Each host gets its verb table from <plugin>/hosts/<host>.md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { archiveDir, rawDir } from './layout.mjs';
import { resolve, samePath } from './repo.mjs';
import { ownTurn } from './own-turn.mjs';
import { pluginRoot } from './plugin-root.mjs';
import { refreshShim } from './statusline.mjs';
import { STATE_EMOJI, nowCard, sessionTitle } from './ticket.mjs';
import { LOCAL_PREFIX, NOT_KEYS, listTickets } from './tickets.mjs';

const KEY_TOKEN = /[A-Za-z][A-Za-z0-9]*-\d+/g;
// A new key in a later prompt: a whole word, so "CVE-2024-1234" and "APP-7x" give no key.
const STRICT_KEY = /(?<![A-Za-z0-9-])[A-Z][A-Z0-9]*-\d+(?![A-Za-z0-9]|-\d)/g;
// A user names the ticket at the start of a prompt, and a long text names keys in passing (a report of a subagent,
// a pasted log). A later prompt is searched only in its first characters.
export const PROMPT_HEAD = 600;
const MAX_CONTEXT = 2400;
const MAX_WIKI_RULES = 8000;
const RULE_FILES = ['forge.md', 'style.md'];
const PART_SIZE = 9000;
export const CLAUDE_PARTS = 4;
export const END_MARKER = 'End of Forge context.';
export const HOSTS = ['copilot-cli', 'claude'];
// `copilot` is the old name of `copilot-cli`. The Copilot CLI also sets CLAUDE_PLUGIN_ROOT
// and COPILOT_CLI, so only CLAUDECODE tells the hosts apart.
export const HOST_NAMES = [...HOSTS, 'copilot'];
const STATE_MARKS = Object.values(STATE_EMOJI);

/** The host of the current process from its environment: claude or copilot-cli. */
export function detectHost(env = process.env) {
  if (env.CLAUDECODE === '1') return 'claude';
  return 'copilot-cli';
}

/** A host of HOSTS for a name of HOST_NAMES, or the detected host when name is empty. */
export function resolveHost(name, env = process.env) {
  if (HOSTS.includes(name)) return name;
  // `copilot` never means Claude Code: a Copilot CLI started from a Claude Code terminal also has CLAUDECODE.
  if (name === 'copilot') return 'copilot-cli';
  return detectHost(env);
}

/** True when the current title is a Forge title of the same ticket ("<KEY> - <state emoji> - ..."), or empty. */
function forgeOwnsTitle(current, title) {
  if (!current) return true;
  const [key, mark] = current.split(' - ');
  return key.toUpperCase() === title.split(' - ')[0].toUpperCase() && STATE_MARKS.includes(mark);
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

/** The hook input in either payload style: camelCase (Copilot CLI) or snake_case (Claude Code). */
export function readEvent(raw) {
  let event = {};
  try { event = raw && raw.trim() ? JSON.parse(raw) : {}; } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const text = (value) => typeof value === 'string' ? value : '';
  return {
    cwd: text(event.cwd), source: text(event.source),
    prompt: text(event.initialPrompt) || text(event.initial_prompt) || text(event.prompt),
    title: text(event.session_title) || text(event.sessionTitle),
    session: text(event.session_id) || text(event.sessionId), reason: text(event.reason),
  };
}

const tokens = (text) => [...String(text).matchAll(KEY_TOKEN)].map((match) => match[0]);

function findByKey(tickets, text) {
  for (const token of tokens(text)) {
    const hit = tickets.find((entry) => entry.ticket.key.toLowerCase() === token.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** The config of a wiki, or null when it cannot be read. */
export function safeConfig(where) {
  try { return loadConfig(where.configDir).config; } catch { return null; }
}

// A ticket can record a base branch (for example `branch: main`). A branch match on it
// would select that ticket in every session on the base branch.
// The names are main, master, and the default branch of the remote (origin/HEAD). They do not come from the config.
// A non-default base branch (for example develop) that is checked out in the main checkout can match a ticket that names it.
function baseBranches(cwd) {
  const names = new Set(['main', 'master']);
  const head = git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head) names.add(head.replace(/^[^/]+\//, ''));
  return names;
}

/**
 * The ticket of a folder: by the recorded worktree, then by the recorded branch (not main, master, or the remote default branch),
 * then by a key in the branch name or the folder name. The main checkout matches only by a ticket branch.
 * here is the top folder of the work tree. The parameter getConfig is not used.
 */
export function ticketOfFolder(tickets, { here, branch, inMain, getConfig }) {
  if (!here) return null;
  let match = !inMain ? tickets.find((entry) => entry.ticket.worktree && samePath(entry.ticket.worktree, here)) : null;
  if (!match && branch) {
    const hit = tickets.find((entry) => entry.ticket.branch === branch);
    if (hit && !baseBranches(here).has(branch)) match = hit;
  }
  if (!match && !inMain) match = findByKey(tickets, `${branch} ${path.basename(here)}`);
  return match ?? null;
}

const IGNORE_LINE ='A board request (the `board` skill) ignores this context.';

function placeLine(here, mainPath, recorded) {
  if (!here) return '';
  if (samePath(here, mainPath)) {
    if (recorded) return `This session runs in the main checkout. The ticket worktree is ${recorded}. Confirm with the user, then move the session to that folder (\`host.move\` in the host table). ${IGNORE_LINE}`;
    return `This session runs in the main checkout. Follow "Worktrees" in the ticket skill: create the ticket worktree with \`forge.mjs worktree <KEY> --summary "<goal>" --create\`, confirm with the user, then move the session to the new folder (\`host.move\` in the host table). ${IGNORE_LINE}`;
  }
  return '';
}

/** The `forge` and `style` rules from <plugin>/context, or '' when they cannot be read. `style: false` leaves out the style rule. */
function pluginRules(pluginDir, { style = true } = {}) {
  try {
    return RULE_FILES.filter((name) => style || name !== 'style.md').map((name) => readFileSync(path.join(pluginDir, 'context', name), 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n');
  } catch { return ''; }
}

/** The text of a rule page without frontmatter and comments, or '' when it has only headings. */
export function ruleBody(raw) {
  const text = raw.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---(\n|$)/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  return text.split('\n').some((line) => line.trim() && !/^#{1,6}\s/.test(line)) ? text : '';
}

/** The rule pages of <wiki>/rules/**\/*.md: the paths relative to rules/, with "/", sorted. */
function ruleFiles(where) {
  const root = path.join(where.wiki.path, 'rules');
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}${entry.name}/`);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(`${rel}${entry.name}`);
    }
  };
  walk(root, '');
  return out.sort();
}

/** The company rules of <wiki>/rules/**\/*.md. A change notice (see ruleNotice) comes first. */
function wikiRules(where, notice = []) {
  const dir = path.join(where.wiki.path, 'rules');
  const texts = [];
  for (const name of ruleFiles(where)) {
    const body = ruleBody(readFileSync(path.join(dir, ...name.split('/')), 'utf8'));
    if (body) texts.push(body);
  }
  let text = texts.join('\n\n');
  if (text.length > MAX_WIKI_RULES) text = `${text.slice(0, MAX_WIKI_RULES).trimEnd()}\n[cut: read the files in ${dir}]`;
  const parts = [`# Company rules (${dir})`];
  if (notice.length) parts.push(notice.join('\n'));
  if (text) parts.push(text);
  return parts.length > 1 ? parts.join('\n\n') : '';
}

const SEEN_FILE = 'rules-seen';

function wikiGit(wiki, args) {
  const result = spawnSync('git', ['-C', wiki, ...args], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return result.status === 0 ? (result.stdout ?? '').replace(/\r?\n$/, '') : null;
}

/** The HEAD of the wiki when the wiki is its own git repository, else ''. */
function wikiHead(wiki) {
  const top = wikiGit(wiki, ['rev-parse', '--show-toplevel']);
  if (!top || !samePath(top, wiki)) return '';
  return wikiGit(wiki, ['rev-parse', 'HEAD']) ?? '';
}

/**
 * The notice lines for the rule pages (rules/**\/*.md) of a wiki that is a git repository. <forge>/raw/rules-seen holds the wiki HEAD of the last
 * session end (one line). A page that changed between that commit and the HEAD, or that has an uncommitted change, gets one line.
 * When the commit is not in the history any more, one line says that the history changed. Session start only reads: recordRulesSeen writes at session end.
 * No file yet, not a git repository, or a git error: no line, and the hook does not fail.
 */
export function ruleNotice(where) {
  try {
    const wiki = where?.wiki?.path;
    if (!wiki || !where.wiki.exists) return [];
    const head = wikiHead(wiki);
    if (!head) return [];
    let base = '';
    try { base = readFileSync(path.join(rawDir(wiki), SEEN_FILE), 'utf8').split(/\r?\n/)[0].trim(); } catch { return []; }
    if (!/^[0-9a-f]{7,64}$/.test(base)) return [];
    const tail = 'Tell the user, and show the change when the user asks.';
    if (wikiGit(wiki, ['cat-file', '-e', `${base}^{commit}`]) === null) return ['Forge: the wiki history changed since your last session. Review the rule pages in rules/.'];
    const state = new Map();
    const rule = (name) => /^rules\/.+\.md$/.test(name);
    if (base !== head) {
      for (const row of (wikiGit(wiki, ['diff', '--name-status', '--no-renames', base, head, '--', 'rules']) ?? '').split('\n')) {
        const [code, name] = row.split('\t');
        if (name && rule(name)) state.set(name, code === 'D' ? 'removed' : 'commit');
      }
    }
    for (const row of (wikiGit(wiki, ['status', '--porcelain', '-uall', '--', 'rules']) ?? '').split('\n')) {
      const name = /^(..)\s+(?:.* -> )?"?([^"]+\.md)"?$/.exec(row);
      if (name && rule(name[2])) state.set(name[2], name[1].includes('D') ? 'removed' : 'dirty');
    }
    const out = [];
    for (const [name, kind] of [...state].sort(([a], [b]) => (a < b ? -1 : 1))) {
      let how = 'has an uncommitted change';
      if (kind === 'removed') how = 'was removed';
      else if (kind === 'commit') {
        const [short, author] = (wikiGit(wiki, ['log', '-1', '--format=%h%x09%an', `${base}..${head}`, '--', name]) ?? '').split('\t');
        how = short ? `changed (commit ${short} by ${author})` : 'changed';
      }
      out.push(`Forge: the rule page ${name} ${how} since your last session. ${tail}`);
    }
    return out;
  } catch { return []; }
}

/** Session end: writes the wiki HEAD of the session start (not the HEAD now) to <forge>/raw/rules-seen. No start record, no git repository, or a failure writes nothing. */
export function recordRulesSeen(where, session) {
  try {
    const start = startFile(where, session);
    if (!start) return;
    const head = readFileSync(start, 'utf8').trim();
    if (/^[0-9a-f]{7,64}$/.test(head)) {
      mkdirSync(path.dirname(start), { recursive: true });
      writeFileSync(path.join(rawDir(where.wiki.path), SEEN_FILE), `${head}\n`);
    }
    rmSync(start, { force: true });
  } catch { /* The notice of the next session is then missing or old. */ }
}

/** The file that holds the wiki HEAD that a session saw at its start, or '' when the session has no safe name or no such file. */
function startFile(where, session, { create = false } = {}) {
  const wiki = where?.wiki?.path;
  if (!wiki || !where.wiki.exists || !/^[A-Za-z0-9._-]{1,100}$/.test(session ?? '')) return '';
  const file = path.join(rawDir(wiki), 'rules-start', session);
  return create || existsSync(file) ? file : '';
}

/** Session start: keeps the wiki HEAD that this session saw (the first write wins). The session end writes it to rules-seen. */
export function recordRulesStart(where, session) {
  try {
    const file = startFile(where, session, { create: true });
    if (!file || existsSync(file)) return;
    const head = wikiHead(where.wiki.path);
    if (!head) return;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${head}\n`);
  } catch { /* No start record: the session end writes no seen file. */ }
}

function pathsLine(pluginDir, where) {
  const parts = [`\`<plugin>\` is \`${pluginDir}\`.`];
  if (where) {
    parts.push(`\`<repo>\` is \`${where.repo.path}\`.`);
    if (where.wiki.exists) parts.push(`\`<forge>\` is \`${where.forge.path}\`.`, `\`<wiki>\` is \`${where.wiki.path}\`.`, `\`<config>\` is \`${where.configDir}\`.`);
    else parts.push(`The wiki \`${where.wiki.path}\` does not exist.`);
  }
  return parts.join(' ');
}

/**
 * The verb table of the host: the text of <plugin>/hosts/<host>.md up to the heading after "## Host verbs",
 * and a line that names the file for the other parts (the board page, the feature documentation).
 * Returns '' when the file cannot be read.
 */
export function hostTable(pluginDir, host) {
  const file = path.join(pluginDir, 'hosts', `${host}.md`);
  let text;
  try { text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim(); } catch { return ''; }
  const verbs = text.indexOf('\n## Host verbs');
  const next = verbs === -1 ? -1 : text.indexOf('\n## ', verbs + 1);
  if (next === -1) return text;
  return `${text.slice(0, next).trimEnd()}\n\nMore steps for this host are in \`${file}\`: the feature documentation. Read that file before you advise on a feature of the host.`;
}

/**
 * The file of the closed ticket with this key, or ''. A closed ticket has a summary page in the wiki (tickets/<key>.md,
 * the rule of buildWiki in wiki.mjs), or a folder in the archive. It checks only the files of this key.
 */
function closedFile(wikiPath, key) {
  const names = [...new Set([key.toLowerCase(), key.toUpperCase(), key])];
  const places = [
    ...names.map((name) => path.join(wikiPath, 'tickets', `${name}.md`)),
    ...names.map((name) => path.join(archiveDir(wikiPath), 'tickets', name)),
  ];
  return places.find((file) => existsSync(file)) ?? '';
}

/** Step 1 of the ticket part: the session title of a known ticket. */
function titleLine(host, title) {
  if (host === 'claude') return `1. The Forge hook set the session title to "${title}", unless the session already had a custom title. You cannot see the title, so do not ask the user to rename the session now. In a ticket worktree, the hook corrects the title at the next prompt of the user. At a state change that must show before the next prompt (a 🟡 gate), tell the user to run \`/rename <new title>\`. In the main checkout, always tell the user to run \`/rename <new title>\`.`;
  return `1. In your first answer, tell the user to run \`/rename ${title}\`. The Copilot CLI has no title tool. At a later state change, give the new \`/rename\` command.`;
}

/** Step 1 of the ticket part: the session title of a new ticket. */
function freshTitleLine(host, key, title) {
  if (host === 'claude') return `1. The Forge hook set the session title to "${title}". After the Start interview, tell the user to run \`/rename ${key} - ▶️ - <summary>\`. This \`/rename\` is needed only until the session moves into the ticket worktree.`;
  return `1. After the Start interview, tell the user to run \`/rename ${key} - ▶️ - <summary>\`. The Copilot CLI has no title tool.`;
}

/**
 * The ticket part: the title, Resume or Start, the Now card, and the place line.
 * Returns { lines, key, title }, with lines [] when no ticket matches.
 * promptOnly: match only a key in the prompt, not the folder or the branch.
 */
function ticketPart(event, where, forge, env, { host = 'copilot-cli', promptOnly = false } = {}) {
  const cwd = event.cwd || process.cwd();
  const here = where.top;
  const branch = git(cwd, ['branch', '--show-current']);
  const all = listTickets(where.wiki.path);
  const tickets = all.filter((entry) => entry.ticket);
  const lines = [];
  const inMain = Boolean(here) && samePath(here, where.repo.path);
  let config;
  const getConfig = () => (config === undefined ? (config = safeConfig(where)) : config);
  let match = promptOnly ? null : ticketOfFolder(tickets, { here, branch, inMain, getConfig });
  if (!match) match = findByKey(tickets, event.prompt);

  if (match) {
    const { ticket, file } = match;
    const title = sessionTitle(ticket);
    const card = nowCard(readFileSync(file, 'utf8'));
    lines.push(
      `Forge ticket session: ${ticket.key}, state ${STATE_EMOJI[ticket.state]} ${ticket.state}, phase ${ticket.phase}, workflow ${ticket.workflow}.`,
      `README: ${file}`,
      titleLine(host, title),
      '2. Load the ticket skill and follow Resume.',
    );
    if (card?.text) lines.push('', 'Now card from the README:', card.text);
    else lines.push('', `Next: ${ticket.next}${ticket.waitingOn ? ` · Waiting on: ${ticket.waitingOn}` : ''}`);
    const recorded = ticket.worktree && here && samePath(ticket.worktree, here);
    const place = recorded ? '' : placeLine(here, where.repo.path, ticket.worktree);
    if (place) lines.push('', place.replaceAll('<KEY>', ticket.key));
    return { lines, key: ticket.key, title };
  }
  // A ticket folder whose README cannot be read: the same match rules on its head. It is not a new ticket.
  const broken = all.filter((entry) => !entry.ticket).map((entry) => ({ ...entry, ticket: entry.head }));
  const stuck = (promptOnly ? null : ticketOfFolder(broken, { here, branch, inMain, getConfig })) ?? findByKey(broken, event.prompt);
  if (stuck) {
    return { lines: [`Forge: the ticket folder ${stuck.folder} has a README that Forge cannot read: ${stuck.error} README: ${stuck.file}. Do not start this ticket again. Show the user the error, and repair the README only as the user says.`], key: '', title: '' };
  }
  // The prompt hook runs only before the session has a title, and it takes a key only as a whole word.
  const candidates = promptOnly ? [...String(event.prompt).matchAll(STRICT_KEY)].map((m) => m[0]) : tokens(event.prompt);
  // In the prompt hook a key counts only as the first word, after start, resume, ticket, or work (and an optional `on`), or when the prompt holds a URL.
  const prompt = String(event.prompt);
  const lead = promptOnly ? /^\s*(?:(?:start|resume|ticket|work)\s+(?:on\s+)?)?([A-Z][A-Z0-9]*-\d+)(?![A-Za-z0-9-])/i.exec(prompt)?.[1]?.toUpperCase() : null;
  const hasUrl = /https?:\/\/\S/i.test(prompt);
  const allowed = (token) => !promptOnly || hasUrl || token === lead;
  // A local key L-<n> is a fresh key only when it has a closed page.
  const fresh = candidates.find((token) => /^[A-Z][A-Z0-9]*-\d+$/.test(token) && allowed(token) && !NOT_KEYS.has(token.split('-')[0]) && (token.startsWith(`${LOCAL_PREFIX}-`) ? Boolean(closedFile(where.wiki.path, token)) : true));
  if (!fresh) return { lines: [], key: '', title: '' };
  const closed = closedFile(where.wiki.path, fresh);
  if (closed) return { lines: [`Forge: ${fresh} is a closed ticket. Its summary page is ${closed}. Do not start it again unless the user asks.`], key: '', title: '', closed: true };
  const title = `${fresh} - ▶️ - Start ticket`;
  lines.push(
    `Forge: the ${promptOnly ? '' : 'first '}prompt names ${fresh}, and the wiki has no ticket folder for it yet.`,
    freshTitleLine(host, fresh, title),
    `2. Load the ticket skill and follow Start. Name the worktree and branch with \`${forge} worktree ${fresh} --summary "<goal>"\`.`,
  );
  const place = placeLine(here, where.repo.path, undefined);
  if (place) lines.push('', place.replaceAll('<KEY>', fresh));
  return { lines, key: fresh, title };
}

function ticketText(lines, forge) {
  const text = lines.join('\n').replaceAll('`forge.mjs ', `\`${forge} `);
  return text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT - 20).trimEnd()}\n[cut: read the README]` : text;
}

function locate(event, env) {
  try { return resolve({ cwd: event.cwd || process.cwd(), env }); } catch { return null; /* not in a Git repository */ }
}

/**
 * The full Forge context for one session, without the end marker: { body, title, where }.
 * body is '' when no part can be read. cli is the absolute path of forge.mjs. where is the place of the session (resolve in repo.mjs), or null.
 */
export function buildContext(event, { cli, env = process.env, host = 'copilot-cli' } = {}) {
  if (!event || !cli) return { body: '', title: '' };
  const pluginDir = path.dirname(path.dirname(cli));
  const forge = `node "${cli}"`;
  const where = locate(event, env);

  let ticket = '';
  let title = '';
  try {
    if (where?.wiki.exists) {
      const found = ticketPart(event, where, forge, env, { host });
      ticket = found.lines.length ? ticketText(found.lines, forge) : '';
      title = found.title;
    }
  } catch { ticket = ''; title = ''; }

  // The style rule loads unless the policy says styleRules: false. No wiki or a config that cannot be read keeps it.
  const style = !where?.wiki.exists || safeConfig(where)?.policy?.styleRules !== false;
  const rules = pluginRules(pluginDir, { style });
  let company = '';
  try { if (where?.wiki.exists) company = wikiRules(where, ruleNotice(where)); } catch { company = ''; }
  if (!ticket && !rules && !company) return { body: '', title: '', where };

  const table = hostTable(pluginDir, host);
  const parts = [`# Forge session context\n\n${pathsLine(pluginDir, where)}`];
  if (ticket) parts.push(`# Forge ticket context\n\n${ticket}`);
  if (rules) parts.push(rules);
  if (table) parts.push(table);
  if (company) parts.push(company);
  return { body: parts.join('\n\n'), title, where };
}

/** The full Forge context as one text with the end marker, or '' when no part can be read. */
export function contextText(event, options) {
  const { body } = buildContext(event, options);
  return body ? `${body}\n\n${END_MARKER}` : '';
}

/** Splits text at blank lines (or at line ends in a long paragraph) into parts of at most size characters. */
export function splitParts(text, size = PART_SIZE) {
  const pieces = [];
  for (const paragraph of text.split('\n\n')) {
    let rest = paragraph;
    while (rest.length > size) {
      let cut = rest.lastIndexOf('\n', size);
      if (cut <= 0) cut = size;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, '');
    }
    if (rest) pieces.push(rest);
  }
  // A part ends before a heading when one is in its second half, so a section stays together.
  const parts = [];
  let current = [];
  const length = (list) => list.reduce((sum, piece) => sum + piece.length + 2, -2);
  for (const piece of pieces) {
    if (current.length && length([...current, piece]) > size) {
      let cut = current.length;
      for (let i = current.length - 1; i > 0; i--) {
        if (length(current.slice(0, i)) < size / 2) break;
        if (/^#{1,6} /.test(current[i])) { cut = i; break; }
      }
      parts.push(current.slice(0, cut).join('\n\n'));
      current = current.slice(cut);
      if (current.length && length([...current, piece]) > size) { parts.push(current.join('\n\n')); current = []; }
    }
    current.push(piece);
  }
  if (current.length) parts.push(current.join('\n\n'));
  return parts;
}

/**
 * The numbered Claude Code parts of the body. The last part has the end marker, or a cut note.
 * Each handler builds the body again, so each header has the id of its body: parts with different ids
 * come from different texts.
 */
export function claudeParts(body, forge) {
  const id = createHash('sha256').update(body).digest('hex').slice(0, 8);
  let parts = splitParts(body);
  const complete = parts.length <= CLAUDE_PARTS;
  if (!complete) parts = parts.slice(0, CLAUDE_PARTS);
  return parts.map((text, i) => {
    const last = i === parts.length - 1;
    const tail = !last ? '' : complete ? `\n\n${END_MARKER}` : `\n\n[cut: the Forge context has more than ${CLAUDE_PARTS} parts. Run \`${forge} context\` for the full text.]`;
    return `Forge context part ${i + 1} of ${parts.length}, id ${id}. Claude Code can give the parts in any order: read them in number order. When the ids are not all the same, run \`${forge} context\` and follow its output.\n\n${text}${tail}`;
  });
}

/**
 * The hook result for one session end event: always {}. It writes the rule pages seen (recordRulesSeen).
 */
export function sessionEnd(event, { env = process.env, host = 'copilot-cli' } = {}) {
  try {
    if (!event) return {};
    const where = locate(event, env);
    // The rule pages that this session saw at its start: the next session start compares them with the wiki HEAD.
    if (where?.wiki.exists) recordRulesSeen(where, event.session);
  } catch { /* The notice of the next session is then missing or old. */ }
  return {};
}

/**
 * The hook result for one session start event, or {}.
 * copilot-cli: { additionalContext } with the full context.
 * claude: { hookSpecificOutput } with part `part` of the context; part 1 also sets the session title.
 */
export function sessionStart(event, { cli, env = process.env, host = 'copilot-cli', part = 1 } = {}) {
  const { body, title, where } = buildContext(event, { cli, env, host });
  if (where?.wiki.exists) recordRulesStart(where, event.session);
  // Claude Code part 1: keep the status line shim of the plugin data folder on the current plugin root. It never creates the shim.
  if (host === 'claude' && part === 1 && env.CLAUDE_PLUGIN_DATA) {
    try { refreshShim(env.CLAUDE_PLUGIN_DATA, pluginRoot); } catch { /* The hook never blocks a session. */ }
  }
  if (!body) return {};
  if (host !== 'claude') return { additionalContext: `${body}\n\n${END_MARKER}` };
  const text = claudeParts(body, `node "${cli}"`)[part - 1];
  if (!text) return {};
  const output = { hookEventName: 'SessionStart', additionalContext: text };
  if (part === 1 && title && forgeOwnsTitle(event.title, title)) output.sessionTitle = title;
  return { hookSpecificOutput: output };
}

/**
 * The Claude Code UserPromptSubmit result, or {}. When the prompt names a ticket key and the session
 * has no custom title yet, it gives the ticket part and sets the session title.
 * A turn that Claude Code started by itself (ownTurn) gives {}. A key after the first PROMPT_HEAD characters and a closed ticket give no ticket part.
 */
export function promptSubmit(event, { cli, env = process.env } = {}) {
  if (!event || !cli || ownTurn(event.prompt)) return {};
  const where = locate(event, env);
  if (!where?.wiki.exists) return {};
  const forge = `node "${cli}"`;
  const parts = [];
  let titleOut = '';
  // In a linked worktree of an open ticket, the folder decides: the key path does not run.
  if (where.repo.worktree && where.top) {
    const own = listTickets(where.wiki.path).find((entry) => entry.ticket && entry.ticket.state !== 'done' && entry.ticket.worktree && samePath(entry.ticket.worktree, where.top));
    if (own) {
      const title = sessionTitle(own.ticket);
      if (title !== event.title && forgeOwnsTitle(event.title, title)) return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: title } };
      return {};
    }
  }
  const head = { ...event, prompt: String(event.prompt).slice(0, PROMPT_HEAD) };
  if (!event.title && tokens(head.prompt).length) {
    try {
      const found = ticketPart(head, where, forge, env, { host: 'claude', promptOnly: true });
      if (found.lines.length && !found.closed) { parts.push(`# Forge ticket context\n\n${ticketText(found.lines, forge)}`); titleOut = found.title; }
    } catch { /* No ticket part. */ }
  }
  if (!parts.length) return {};
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: parts.join('\n\n'), ...(titleOut ? { sessionTitle: titleOut } : {}) } };
}
