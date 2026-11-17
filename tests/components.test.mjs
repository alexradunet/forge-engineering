// The board skill and the automation templates follow the agent plugin formats.
// VS Code ignores an invalid automation template without an error, so these tests catch it here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(root, 'plugins', 'forge');
const automationDir = path.join(plugin, 'automations');

// Reads flat "key: value" frontmatter with one level of nested maps. Enough for these files.
function frontmatter(file) {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(match, `${path.basename(file)} needs frontmatter`);
  const data = {};
  let parent = null;
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const entry = /^(\s*)([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    assert.ok(entry, `${path.basename(file)}: cannot read "${line}"`);
    const [, indent, key, raw] = entry;
    const value = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (indent) {
      assert.ok(parent, `${path.basename(file)}: "${key}" has no parent`);
      data[parent][key] = value;
    } else if (raw === '') {
      data[key] = {};
      parent = key;
    } else {
      data[key] = value;
      parent = null;
    }
  }
  return { data, body: match[2] };
}

const NAMES = { month: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], dow: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] };
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: NAMES.month, base: 1 },
  { name: 'day of week', min: 0, max: 7, names: NAMES.dow, base: 0 },
];

// The five-field syntax of the automation docs: *, lists, ascending ranges, and steps on * or a range.
function cronProblems(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return [`needs 5 fields, has ${parts.length}`];
  const problems = [];
  const number = (field, token) => {
    const index = field.names?.indexOf(token.toUpperCase()) ?? -1;
    const value = index >= 0 ? index + field.base : /^\d+$/.test(token) ? Number(token) : NaN;
    return value >= field.min && value <= field.max ? value : NaN;
  };
  parts.forEach((part, i) => {
    const field = FIELDS[i];
    for (const item of part.split(',')) {
      const [range, step, extra] = item.split('/');
      if (extra !== undefined || (step !== undefined && !/^[1-9]\d*$/.test(step))) { problems.push(`${field.name}: bad step "${item}"`); continue; }
      if (range === '*') continue;
      const [low, high, more] = range.split('-');
      if (more !== undefined) { problems.push(`${field.name}: bad range "${item}"`); continue; }
      if (high === undefined) {
        if (step !== undefined) problems.push(`${field.name}: a step needs * or a range, not "${item}"`);
        else if (Number.isNaN(number(field, low))) problems.push(`${field.name}: bad value "${item}"`);
        continue;
      }
      const a = number(field, low);
      const b = number(field, high);
      if (Number.isNaN(a) || Number.isNaN(b) || a > b) problems.push(`${field.name}: bad range "${item}"`);
    }
  });
  return problems;
}

test('the cron check accepts the documented examples and refuses unsupported forms', () => {
  for (const ok of ['0 9,17 * * MON-FRI', '0 9 1 * *', '*/30 * * * *', '0-59/15 * * * *', '30 10 * * 5', '0 9 * JAN-DEC 0-7']) {
    assert.deepEqual(cronProblems(ok), [], ok);
  }
  for (const bad of ['0 9 * *', '0 0 9 * * *', '5/15 * * * *', '@daily', '0 25 * * *', '0 9 * * FRI-MON', '0 9 * * MON-FRI-SAT', '*/0 * * * *']) {
    assert.notDeepEqual(cronProblems(bad), [], bad);
  }
});

test('each automation template has the documented frontmatter and a cron schedule in local time', () => {
  const files = readdirSync(automationDir).filter((name) => !name.startsWith('.'));
  assert.deepEqual(files.sort(), ['forge-daily-recap.automation.md', 'forge-maintenance.automation.md']);
  const ids = new Set();
  for (const name of files) {
    assert.match(name, /\.automation\.md$/);
    const { data, body } = frontmatter(path.join(automationDir, name));
    assert.equal(data.version, '1', `${name}: version`);
    assert.match(data.id ?? '', /^[a-z0-9.-]{1,64}$/, `${name}: id`);
    assert.ok(!ids.has(data.id), `${name}: the id is not unique`);
    ids.add(data.id);
    assert.ok(data.name?.trim(), `${name}: name`);
    assert.ok(data.description?.trim(), `${name}: description`);
    assert.equal(typeof data.schedule, 'object', `${name}: schedule`);
    assert.equal(data.schedule.kind, 'cron', `${name}: schedule.kind`);
    assert.equal(data.schedule.timeZone, 'local', `${name}: cron templates need timeZone: local`);
    assert.deepEqual(cronProblems(data.schedule.expression ?? ''), [], `${name}: schedule.expression`);
    assert.ok(body.trim().length > 0, `${name}: the body is the prompt`);
    for (const field of ['workspace', 'model', 'permissions', 'enabled']) assert.equal(data[field], undefined, `${name}: templates cannot set ${field}`);
  }
});

test('the automations keep the agreed schedules and their limited write scope', () => {
  const maintenance = frontmatter(path.join(automationDir, 'forge-maintenance.automation.md'));
  assert.equal(maintenance.data.schedule.expression, '0 9,11,13,15,17 * * MON-FRI');
  for (const text of ['Write only `<wiki>/raw/board.md` and `<wiki>/raw/sync/<KEY>.md`', 'Do not use `--fix`', 'Never send a message to a session', 'Ignore the context of the Forge `sessionStart` hook']) {
    assert.ok(maintenance.body.includes(text), `maintenance: ${text}`);
  }
  const recap = frontmatter(path.join(automationDir, 'forge-daily-recap.automation.md'));
  assert.equal(recap.data.schedule.expression, '20 10 * * MON-FRI');
  assert.equal(recap.data.name, 'Prepare my daily');
  assert.ok(recap.body.includes('"⏰ Automation" section'));
  const skill = readFileSync(path.join(plugin, 'skills', 'daily-recap', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('## ⏰ Automation'), 'the daily-recap skill keeps the section that the template names');
});

test('the board skill replaces the Forge Master agent and keeps its limits', () => {
  // 6.6.0 removed the Forge Master agent: VS Code ignored its body, and the board works in any session.
  assert.equal(existsSync(path.join(plugin, 'com.github.copilot', 'agents')), false);
  assert.equal(existsSync(path.join(plugin, 'agents')), false);
  const skill = frontmatter(path.join(plugin, 'skills', 'board', 'SKILL.md'));
  assert.equal(skill.data.name, 'board');
  for (const text of [
    'Run `<F> board --json`',
    'It does not start or resume the ticket.',
    'Do not change the title of this session.',
    'Never approve a gate for the user.',
    "Never answer a session's question",
    'Never archive, delete, or mark a session as done.',
    'No external writes.',
  ]) assert.ok(skill.body.includes(text), `skill: ${text}`);
  const rule = readFileSync(path.join(plugin, 'context', 'forge.md'), 'utf8');
  assert.ok(rule.includes('A board request is the exception'), 'the forge rule names the board exception');
  assert.ok(!/forge[- ]master/i.test(rule), 'the forge rule has no Forge Master text');
  // Click-check 15: the verb `host.board` made "show me the board" read only the sessions list.
  assert.ok(rule.includes('Load the `board` skill before any other tool call'), 'a board request loads the board skill first');
  assert.ok(!/host\.board\b/.test(rule), 'no host verb has the name of the board skill');
  // The VS Code tool detail moved from forge.md to the VS Code host table; forge.md names the host verb.
  assert.ok(rule.includes('start a new independent session (`host.spawn`)'), 'the forge rule keeps ticket sessions independent');
  assert.ok(readFileSync(path.join(plugin, 'hosts', 'vscode.md'), 'utf8').includes('always give `relationship: independent`'), 'the VS Code table keeps ticket sessions out of nested chats');
});

// The VS Code session tools are host specific. A portable Forge text names a host verb (`host.title`),
// and the host table gives the tool. Only the host-specific files can name a session tool:
// the host tables, the com.github.copilot folder, and the automation templates (VS Code
// automations ignore the hook context, so they cannot read the host table).
const VSCODE_TOOLS = /\b(rename_chat|set_workspace|create_session|send_message|list_sessions|get_session_context|delete_session|archive_chat|move_session|isolate_session|readSessionsList|organizeSessionsList|add_artifact_or_reference|listComments|replyToComment|resolveComments|configureAutomation|listAutomations|runAutomation|ask_user)\b/;
const HOST_ONLY = ['hosts', 'com.github.copilot', 'automations'];

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

test('portable plugin text names host verbs, not VS Code session tools', () => {
  const hits = [];
  for (const file of markdownFiles(plugin)) {
    const rel = path.relative(plugin, file);
    if (HOST_ONLY.some((part) => rel === part || rel.startsWith(`${part}${path.sep}`))) continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (VSCODE_TOOLS.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('each host table has one row for each host verb, and the skills name only known verbs', () => {
  // 7.3.0: the session context is short, so forge.md has no verb list. The VS Code table is the reference list.
  const rows = (text) => [...text.matchAll(/^\| `(host\.[a-z]+)` \|/gm)].map((m) => m[1]);
  const verbs = rows(readFileSync(path.join(plugin, 'hosts', 'vscode.md'), 'utf8'));
  assert.ok(verbs.length >= 10, `hosts/vscode.md lists ${verbs.length} verbs`);
  assert.deepEqual(rows(readFileSync(path.join(plugin, 'context', 'forge.md'), 'utf8')), [], 'The verb rows are in the host tables only.');
  for (const host of ['vscode', 'copilot-cli', 'claude']) {
    const table = readFileSync(path.join(plugin, 'hosts', `${host}.md`), 'utf8');
    assert.match(table, /^# Forge host: /, `${host}: the hook finds the table by its heading`);
    assert.deepEqual([...table.matchAll(/^\| `(host\.[a-z]+)` \|/gm)].map((m) => m[1]), verbs, `${host}: rows`);
  }
  const used = new Set(markdownFiles(plugin).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/`(host\.[a-z]+)`/g)].map((m) => m[1])));
  assert.deepEqual([...used].filter((verb) => !verbs.includes(verb)), []);
});
