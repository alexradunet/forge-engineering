import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextText, hostTable, HOSTS } from '../plugins/forge/scripts/lib/hook.mjs';

// Context budgets (7.3.0). Each session pays for the session context, and each ticket session pays for the ticket skill.
// Claude Code keeps only the first 5,000 tokens of a skill after a compaction, so SKILL.md of the ticket skill
// stays under that size and the steps of each phase are in phases/, read when the phase starts.
// A change that needs more room moves text to a file that the agent reads at the step, not into these files.
const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const plugin = path.dirname(path.dirname(cli));
const text = (...parts) => readFileSync(path.join(plugin, ...parts), 'utf8').replace(/\r\n/g, '\n');
const env = { ...process.env, FORGE_WIKI_ROOT: '' };

const RULES_BUDGET = 8000;
const HOST_BUDGET = 4200;
const CONTEXT_BUDGET = 12500;
const SKILL_BUDGET = 16000;

test('the session context is a short form: the rules and the verb table of the host stay under their budgets', () => {
  const rules = text('context', 'forge.md').length + text('context', 'style.md').length;
  assert.ok(rules <= RULES_BUDGET, `forge.md and style.md have ${rules} characters. The budget is ${RULES_BUDGET}.`);
  for (const host of HOSTS) {
    const table = hostTable(plugin, host);
    assert.ok(table.length <= HOST_BUDGET, `${host}: the verb table has ${table.length} characters. The budget is ${HOST_BUDGET}.`);
    assert.match(table, /^# Forge host: /);
    assert.match(table, /\| `host\.title` \|/, `${host}: the verb rows are in the context`);
    assert.doesNotMatch(table, /\n## Pages/, `${host}: the steps for the pages stay in the file`);
    assert.ok(table.includes(path.join(plugin, 'hosts', `${host}.md`)), `${host}: the context names the host file`);
    // A folder outside a repository: the paths line, the rules, and the verb table. A ticket part and company rules add to it.
    const context = contextText({ cwd: os.tmpdir(), source: '', prompt: '' }, { cli, env, host });
    assert.ok(context.length <= CONTEXT_BUDGET, `${host}: the context has ${context.length} characters. The budget is ${CONTEXT_BUDGET}.`);
  }
});

test('the text that left the session context is in context/tools.md, and the short form names that file', () => {
  const rule = text('context', 'forge.md');
  const tools = text('context', 'tools.md');
  assert.match(rule, /read `<plugin>\/context\/tools\.md`/);
  for (const heading of ['## Config and capabilities', '## 🛠️ Tool choice: CLI first', '## External writes', '## 🛡️ Gate guard', '## Manual step']) {
    assert.ok(tools.includes(`\n${heading}\n`), `tools.md: ${heading}`);
    assert.ok(!rule.includes(`\n${heading}\n`), `forge.md has no copy of ${heading}`);
  }
  // The rules that apply before a skill loads stay in the short form.
  for (const line of ['Never, with any tool:', 'Merge a change request, or turn on auto-merge', 'Never call a tracker, repository host, or CI tool that the config does not name', 'Get an explicit "yes" for this one write', 'Do not run the command in another form']) {
    assert.ok(rule.includes(line), `forge.md: ${line}`);
  }
});

test('the Memory rule is in forge.md, so styleRules: false keeps it', () => {
  assert.ok(text('context', 'forge.md').includes('\n## 🧠 Memory\n'), 'forge.md: the Memory heading');
  assert.ok(!text('context', 'style.md').includes('## 🧠 Memory'), 'style.md has no Memory section');
});

test('the ticket skill stays whole after a compaction: a short SKILL.md and one file for each part', () => {
  const skill = text('skills', 'ticket', 'SKILL.md');
  assert.ok(skill.length <= SKILL_BUDGET, `SKILL.md has ${skill.length} characters. The budget is ${SKILL_BUDGET}. Move steps to a file in phases/.`);
  const listed = [...skill.matchAll(/^\|[^|]+\| \[phases\/([a-z-]+\.md)\]\(phases\/\1\) \|$/gm)].map((m) => m[1]);
  const files = readdirSync(path.join(plugin, 'skills', 'ticket', 'phases')).filter((name) => name.endsWith('.md'));
  assert.deepEqual([...listed].sort(), [...files].sort(), 'The table "Parts of this skill" lists each file of phases/, one time.');
  assert.match(skill, /Before you do a step, read its file\. Do not do a step from memory\./);
  assert.match(skill, /only until the next compaction of the session\. When you do not see its text, read it again\./);
  for (const name of files) {
    const part = text('skills', 'ticket', 'phases', name);
    assert.match(part, /^# \S/, `${name}: a title`);
    assert.ok(part.includes('[SKILL.md](../SKILL.md)'), `${name}: a link to SKILL.md`);
    assert.match(part, /After a compaction of the session, read this file again/, name);
    assert.doesNotMatch(part, /\]\((templates|legacy)\//, `${name}: a link to a template starts with ../`);
  }
  // The rules that hold in each phase stay in SKILL.md.
  for (const heading of ['## 🕰️ Older tickets', '## ⚙️ Config, words, and policy', '## 🧭 Workflow', '## 🗂️ Folder layout', '## 🔒 Data rules', '## 🚦 Review gates', '## 🔁 Resume']) {
    assert.ok(skill.includes(`\n${heading}\n`), `SKILL.md: ${heading}`);
  }
  assert.match(skill, /Approval comes only from the user/);
  assert.match(skill, /Never merge a change request/);
});

test('each heading that another file names is in one part of the ticket skill', () => {
  const where = {
    'start.md': ['## 🚀 Start', '### 🧭 Research', '### 🧪 Spikes', '### 🎤 Interview', '### 🎯 Scope check'],
    'state.md': ['### 🏷️ Frontmatter', '### 👥 People', '### 🏷️ Session title (info bar)', '### 📌 Session links', '### 📋 Ticket overview'],
    'worktrees.md': ['### 🌳 Worktrees'],
    'gates.md': ['### 🐟 Cold read', '### Procedure for each gate', '### Approval revisions', '### Sendable? for each write', '### ✅ Approval form'],
    'investigate-plan.md': ['## 🔎 Investigate', '### 🛑 Diagnosis stop', '## 📝 Plan'],
    'implement.md': ['## 🛠️ Implement'],
    'evidence.md': ['## 🔬 Evidence Testing', '## 🧑‍🔬 QA handover'],
    'closing.md': ['## ✅ Close'],
  };
  for (const [name, headings] of Object.entries(where)) {
    assert.ok(existsSync(path.join(plugin, 'skills', 'ticket', 'phases', name)), name);
    const part = text('skills', 'ticket', 'phases', name);
    for (const heading of headings) assert.ok(part.includes(`\n${heading}\n`), `${name}: ${heading}`);
  }
});
