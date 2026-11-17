import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { changeCommands, preTool, preToolOutput, readToolEvent, shellCommands, shipActions } from '../plugins/forge/scripts/lib/guard.mjs';
import { sha256 } from '../plugins/forge/scripts/lib/validation.mjs';
import { status as trustStatus, approve } from '../plugins/forge/scripts/lib/trust.mjs';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { seed } from '../plugins/forge/scripts/lib/setup.mjs';
import { setValues } from '../plugins/forge/scripts/lib/config-write.mjs';
import { hookArgs } from '../plugins/forge/scripts/forge.mjs';

// The gate guard is the preToolUse hook: a push or a new change request in a ticket worktree
// needs the gates of checkAction('ship'). All other commands, folders, and failures let the tool run.
const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const templates = path.join(path.dirname(path.dirname(cli)), 'templates', 'config');
const repoTemplate = readFileSync(path.join(templates, 'repo.md'), 'utf8');
const env = { ...process.env, FORGE_WIKI_ROOT: '', FORGE_DATA_DIR: mkdtempSync(path.join(os.tmpdir(), 'forge-guard-data-')) };
const GATES = [['Scoped?', 'story.md'], ['Planned?', 'plan.md'], ['Shippable?', 'review.md']];

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** A repository with a ticket worktree, and a wiki with one full-v3 ticket. `approved` lists the approved gates. */
function setup(t, { approved = [], workflow = 'full-v3' } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(app, 'a.txt'), 'a\n');
  git(app, 'add', 'a.txt');
  git(app, 'commit', '-q', '-m', 'init');
  const worktree = path.join(`${app}.worktrees`, 'app-7-doc-import');
  git(app, 'worktree', 'add', '-q', '-b', 'users/a/APP-7-doc-import', worktree);
  const dir = path.join(root, 'app.wiki', 'raw', 'tickets', 'app-7');
  mkdirSync(path.join(dir, 'approvals'), { recursive: true });
  const gates = [];
  for (const [name, doc] of GATES) {
    writeFileSync(path.join(dir, doc), `# ${doc}\n\nText of ${name}\n`);
    if (!approved.includes(name)) { gates.push(`  - { name: ${name}, doc: ${doc}, need: required, status: todo }`); continue; }
    const manifest = `approvals/${name.replace('?', '').toLowerCase()}-001.json`;
    const bytes = JSON.stringify({ version: 1, gate: name, documents: [{ path: doc, sha256: sha256(readFileSync(path.join(dir, doc))) }] });
    writeFileSync(path.join(dir, manifest), bytes);
    gates.push(`  - { name: ${name}, doc: ${doc}, need: required, status: approved, date: 2026-11-17, manifest: ${manifest}, hash: ${sha256(bytes)} }`);
  }
  for (const name of ['Sendable?', 'Learned?']) gates.push(`  - { name: ${name}, need: required, status: todo }`);
  const readme = path.join(dir, 'README.md');
  writeFileSync(readme, [
    '---', 'type: ticket', 'key: APP-7', 'title: Doc import error telemetry', 'short: Doc import error telemetry',
    `workflow: ${workflow}`, 'phase: start', 'state: active', 'next: Continue', 'branch: "users/a/APP-7-doc-import"',
    `worktree: "${worktree.replaceAll('\\', '/')}"`, 'changes: []', 'people: []', 'gates:', ...gates, 'updated: 2026-11-17', '---',
    '# APP-7', '', '## Now', '', '- State: ▶️ active', '',
  ].join('\n'));
  return { root, app, worktree, dir, readme, wiki: path.join(root, 'app.wiki') };
}

const run = (cwd, command) => preTool({ cwd, command }, { env });

/** Seeds the config, sets values, and approves the config files, as the user does in setup. */
function trustConfig(s, values = []) {
  const where = resolve({ cwd: s.app, env });
  const { configDir } = seed(where, templates);
  if (values.length) setValues(configDir, values);
  approve(where, trustStatus(where, { env }).files.filter((f) => f.rel.startsWith('config/')).map((f) => `${f.rel}=${f.sha.slice(0, 12)}`), { env });
}

test('shellCommands splits a line into commands and keeps quoted words and Windows paths', () => {
  assert.deepEqual(shellCommands('git  push -u origin "my branch" && echo done'), [['git', 'push', '-u', 'origin', 'my branch'], ['echo', 'done']]);
  assert.deepEqual(shellCommands("git commit -m 'fix; then push'\ngit status | cat"), [['git', 'commit', '-m', 'fix; then push'], ['git', 'status'], ['cat']]);
  assert.deepEqual(shellCommands('cd C:\\dev\\app; git push'), [['cd', 'C:\\dev\\app'], ['git', 'push']]);
  assert.deepEqual(shellCommands('cd "C:\\Program Files\\app" && git push'), [['cd', 'C:\\Program Files\\app'], ['git', 'push']]);
  assert.deepEqual(shellCommands('cd my\\ folder'), [['cd', 'my folder']]);
  assert.deepEqual(shellCommands('echo "say \\"hi\\"" \'\''), [['echo', 'say "hi"', '']]);
  assert.deepEqual(shellCommands(''), []);
  assert.deepEqual(shellCommands(null), []);
});

test('changeCommands reads the change request command of the repo.open-change row, without the git push', () => {
  assert.deepEqual(changeCommands(repoTemplate), [['gh', 'pr', 'create']]);
  assert.deepEqual(changeCommands('| `repo.open-change` | `az.exe repos pr create --title "<t>"` | n |'), [['az', 'repos', 'pr', 'create']]);
  assert.deepEqual(changeCommands('| `repo.open-change` | manual | The user opens the request in the web UI. |'), []);
  assert.deepEqual(changeCommands('| `repo.update-change` | `gh pr edit <n>` | n |'), []);
  assert.deepEqual(changeCommands(''), []);
});

test('shipActions finds each push and each change request command, with its folder', () => {
  const changes = [['gh', 'pr', 'create']];
  const base = path.resolve('/base');
  const kinds = (line) => shipActions(line, base, changes).map((action) => action.kind);
  for (const line of ['git push', 'git push -u origin users/a/APP-7', 'FOO=1 git push', 'sudo git push --force', 'git -c a=b push', 'echo start && git push 2>&1 | tail -3', 'echo $(git push)', '/usr/bin/git push', 'git.exe push']) {
    assert.deepEqual(kinds(line), ['push'], line);
  }
  for (const line of ['git stash push', 'git push --dry-run', 'git push -n origin x', 'git commit -m "push later"', 'echo "git push"', 'git status', 'gh pr view 3', 'gh pr list', 'npm run push', 'git log --grep push']) {
    assert.deepEqual(kinds(line), [], line);
  }
  assert.deepEqual(kinds('gh pr create -R a/b -t "T" -F body.md --draft'), ['change']);
  assert.deepEqual(kinds('git push -u origin x && gh pr create -t T'), ['push', 'change']);
  assert.deepEqual(shipActions('gh pr create -t T', base, []), [], 'Without a trusted config there is no change command.');
  assert.deepEqual(shipActions('git -C ../wt push', base, []), [{ kind: 'push', cwd: path.resolve(base, '../wt') }]);
  assert.deepEqual(shipActions('cd sub/dir && git push; cd .. && gh pr create', base, changes), [
    { kind: 'push', cwd: path.resolve(base, 'sub/dir') }, { kind: 'change', cwd: path.resolve(base, 'sub') },
  ]);
});

test('readToolEvent reads the command of each host format and ignores a tool call without a command', () => {
  assert.deepEqual(readToolEvent('{"cwd":"/x","tool_name":"Bash","tool_input":{"command":"git push"}}'), { cwd: '/x', command: 'git push' });
  assert.deepEqual(readToolEvent('{"cwd":"/x","toolName":"bash","toolArgs":"{\\"command\\":\\"git push\\"}"}'), { cwd: '/x', command: 'git push' });
  assert.deepEqual(readToolEvent('{"toolName":"powershell","toolArgs":{"command":"git push"}}'), { cwd: '', command: 'git push' });
  for (const raw of ['', '{bad', '[1]', '{"tool_name":"Edit","tool_input":{"file_path":"a"}}', '{"toolName":"bash","toolArgs":"not json"}', '{"tool_input":{"command":"  "}}']) {
    assert.equal(readToolEvent(raw), null, raw);
  }
});

test('a push in a ticket worktree is denied until Scoped?, Planned?, and Shippable? have a valid approval', (t) => {
  const none = setup(t);
  const verdict = run(none.worktree, 'git push -u origin users/a/APP-7-doc-import');
  assert.equal(verdict.decision, 'deny');
  assert.equal(verdict.key, 'APP-7');
  assert.match(verdict.reason, /^Forge gate guard: APP-7 has no valid approval for a push\. Scoped\? is not approved\. Planned\? is not approved\. Shippable\? is not approved\./);
  assert.match(verdict.reason, /wait for the answer of the user\. Do not run the command in another form\./);

  const partly = setup(t, { approved: ['Scoped?', 'Planned?'] });
  assert.match(run(partly.worktree, 'git push').reason, /a push\. Shippable\? is not approved\. Open the gate/);

  const all = setup(t, { approved: ['Scoped?', 'Planned?', 'Shippable?'] });
  assert.equal(run(all.worktree, 'git push'), null, 'All three approvals let the push run.');
  writeFileSync(path.join(all.dir, 'review.md'), '# review.md\n\nChanged after the approval.\n');
  const stale = run(all.worktree, 'git push');
  assert.equal(stale.decision, 'deny');
  assert.match(stale.reason, /Shippable\?: review\.md changed after review\./);
});

test('the guard finds the ticket from the folder of the command, and it ignores all other work', (t) => {
  const s = setup(t);
  assert.equal(run(s.app, `cd "${s.worktree}" && git push`).decision, 'deny', 'cd selects the worktree.');
  assert.equal(run(s.app, `git -C "${s.worktree}" push`).decision, 'deny', 'git -C selects the worktree.');
  assert.equal(run(os.tmpdir(), `git -C "${s.worktree}" push`).decision, 'deny', 'A session outside the repository.');
  const sub = path.join(s.worktree, 'src');
  mkdirSync(sub);
  assert.equal(run(sub, 'git push').decision, 'deny', 'A subfolder of the worktree.');
  for (const command of ['git status', 'git stash push', 'git push --dry-run', 'npm test', 'git commit -m "push"']) {
    assert.equal(run(s.worktree, command), null, command);
  }
  assert.equal(run(s.app, 'git push'), null, 'The main checkout on the base branch has no ticket.');
  assert.equal(run(s.wiki, 'git push'), null, 'The wiki is not a ticket worktree.');
  assert.equal(run(os.tmpdir(), 'git push'), null, 'A folder outside a repository.');
  assert.equal(run(s.worktree, 'gh pr create -t T'), null, 'Without a trusted config, only git push is a ship action.');
  assert.equal(preTool(null, { env }), null);
  rmSync(path.join(s.root, 'app.wiki'), { recursive: true, force: true });
  assert.equal(run(s.worktree, 'git push'), null, 'No wiki, no ticket.');
});

test('a ticket README that cannot be read does not stop the command', (t) => {
  const s = setup(t);
  writeFileSync(s.readme, 'no frontmatter\n');
  assert.equal(run(s.worktree, 'git push'), null);
});

test('an older ticket keeps the gates of its own workflow', (t) => {
  const s = setup(t, { workflow: 'full-v2' });
  const verdict = run(s.worktree, 'git push');
  assert.equal(verdict.decision, 'deny');
  assert.match(verdict.reason, /Scoped\? is not approved\./);
});

test('a trusted config adds the change request command, and policy.gateGuard selects deny, ask, or off', (t) => {
  const s = setup(t);
  trustConfig(s);
  const change = run(s.worktree, 'gh pr create -R a/b -t "APP-7 T" -F body.md --draft');
  assert.equal(change.decision, 'deny');
  assert.match(change.reason, /no valid approval for a new change request\./);
  assert.equal(run(s.worktree, 'gh pr view 3'), null);

  const asks = setup(t);
  trustConfig(asks, ['policy.gateGuard=ask']);
  const ask = run(asks.worktree, 'git push');
  assert.equal(ask.decision, 'ask');
  assert.match(ask.reason, /Allow this command only if you accept the step without the gate\./);

  const off = setup(t);
  trustConfig(off, ['policy.gateGuard=off']);
  assert.equal(run(off.worktree, 'git push'), null);
  // A changed policy file is not trusted until the user approves it, so it cannot turn the guard off.
  const changed = setup(t);
  trustConfig(changed);
  setValues(path.join(changed.wiki, 'forge', 'config'), ['policy.gateGuard=off']);
  assert.equal(run(changed.worktree, 'git push').decision, 'deny');
});

test('each host gets its own output format, and no verdict gives an empty object', () => {
  const verdict = { decision: 'deny', key: 'APP-7', reason: 'Forge gate guard: text.' };
  assert.deepEqual(preToolOutput(null, 'claude'), {});
  assert.deepEqual(preToolOutput(verdict, 'claude'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Forge gate guard: text.' } });
  for (const host of ['vscode', 'copilot-cli']) {
    assert.deepEqual(preToolOutput(verdict, host), { permissionDecision: 'deny', permissionDecisionReason: 'Forge gate guard: text.' });
  }
  assert.equal(hookArgs(['hook', 'pre-tool', '--host', 'claude'], {}).host, 'claude');
  assert.equal(hookArgs(['hook', 'pre-tool'], { AI_AGENT: 'github_copilot_vscode_agent' }).host, 'vscode');
  assert.equal(hookArgs(['hook', 'pre-tool'], {}).host, 'copilot-cli');
  assert.equal(hookArgs(['hook', 'pre-tool', '--part', '1'], {}), null);
});

test('forge.mjs hook pre-tool always exits 0 with JSON', (t) => {
  const s = setup(t);
  const call = (input, ...args) => spawnSync(process.execPath, [cli, 'hook', 'pre-tool', ...args], { input, encoding: 'utf8', env: { ...env, CLAUDECODE: '', AI_AGENT: '' } });
  const claude = call(JSON.stringify({ cwd: s.worktree, tool_name: 'Bash', tool_input: { command: 'git push' } }), '--host', 'claude');
  assert.equal(claude.status, 0, claude.stderr);
  assert.equal(JSON.parse(claude.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const copilot = call(JSON.stringify({ cwd: s.worktree, toolName: 'bash', toolArgs: JSON.stringify({ command: 'git push' }) }));
  assert.equal(copilot.status, 0, copilot.stderr);
  assert.equal(JSON.parse(copilot.stdout).permissionDecision, 'deny');
  assert.match(JSON.parse(copilot.stdout).permissionDecisionReason, /^Forge gate guard: APP-7/);
  for (const input of ['{bad', '', JSON.stringify({ cwd: s.worktree, tool_name: 'Bash', tool_input: { command: 'git status' } })]) {
    const quiet = call(input, '--host', 'claude');
    assert.equal(quiet.status, 0);
    assert.deepEqual(JSON.parse(quiet.stdout), {});
  }
});
