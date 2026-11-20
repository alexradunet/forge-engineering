// The board skill follows the agent plugin formats, and the host tables and portable text keep to their rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(root, 'plugins', 'forge');

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
// the host tables and the com.github.copilot folder.
const VSCODE_TOOLS = /\b(rename_chat|set_workspace|create_session|send_message|list_sessions|get_session_context|delete_session|archive_chat|move_session|isolate_session|readSessionsList|organizeSessionsList|add_artifact_or_reference|listComments|replyToComment|resolveComments|configureAutomation|listAutomations|runAutomation|ask_user)\b/;
const HOST_ONLY = ['hosts', 'com.github.copilot'];

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
