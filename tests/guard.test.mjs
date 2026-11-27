import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { capabilityCommands, changeCommands, guardActions, preTool, preToolOutput, readToolEvent, shellCommands, shipActions, writeCommands } from '../plugins/forge/scripts/lib/guard.mjs';
import { sha256 } from '../plugins/forge/scripts/lib/validation.mjs';
import { status as trustStatus, approve } from '../plugins/forge/scripts/lib/trust.mjs';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { seed } from '../plugins/forge/scripts/lib/setup.mjs';
import { setValues } from '../plugins/forge/scripts/lib/config-write.mjs';
import { hookArgs, parseArgs } from '../plugins/forge/scripts/forge.mjs';
import { FORGE_VALUE_OPTIONS } from '../plugins/forge/scripts/lib/cli-options.mjs';
import { codeBinding } from '../plugins/forge/scripts/lib/code-bind.mjs';

// The gate guard is the preToolUse hook: a push or a new change request in a ticket worktree
// needs the gates of checkAction('ship'). All other commands, folders, and failures let the tool run.
const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const templates = path.join(path.dirname(path.dirname(cli)), 'templates', 'config');
const repoTemplate = readFileSync(path.join(templates, 'repo.md'), 'utf8');
const env = { ...process.env, FORGE_WIKI_ROOT: '', FORGE_DATA_DIR: mkdtempSync(path.join(os.tmpdir(), 'forge-guard-data-')) };
const GATES = [['Planned?', ['story.md', 'plan.md']], ['Shippable?', ['review.md']]];

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** A repository with a ticket worktree, and a wiki with one full-v4 ticket. `approved` lists the approved gates. */
// With Shippable? approved, the branch has one commit and the manifest binds its code (`code: 'none'` leaves the binding out), and the config is trusted with the base branch main.
function setup(t, { approved = [], workflow = 'full-v4', code = 'bound' } = {}) {
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
  let binding = null;
  if (approved.includes('Shippable?')) {
    writeFileSync(path.join(worktree, 'b.txt'), 'change\n');
    git(worktree, 'add', 'b.txt');
    git(worktree, 'commit', '-q', '-m', 'change');
    if (code === 'bound') binding = codeBinding({ worktree, branch: 'users/a/APP-7-doc-import', baseBranch: 'main' });
  }
  const dir = path.join(root, 'app.forge', 'raw', 'tickets', 'app-7');
  mkdirSync(path.join(dir, 'approvals'), { recursive: true });
  mkdirSync(path.join(root, 'app.forge', 'wiki'), { recursive: true });
  const gates = [];
  for (const [name, docs] of GATES) {
    const doc = docs.at(-1);
    for (const item of docs) writeFileSync(path.join(dir, item), `# ${item}\n\nText of ${name}\n`);
    if (!approved.includes(name)) { gates.push(`  - { name: ${name}, doc: ${doc}, need: required, status: todo }`); continue; }
    const manifest = `approvals/${name.replace('?', '').toLowerCase()}-001.json`;
    const bytes = JSON.stringify({ version: 1, gate: name, documents: docs.map((item) => ({ path: item, sha256: sha256(readFileSync(path.join(dir, item))) })), ...(name === 'Shippable?' && binding ? { code: binding } : {}) });
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
  const made = { root, app, worktree, dir, readme, wiki: path.join(root, 'app.forge', 'wiki'), binding };
  if (approved.includes('Shippable?')) trustConfig(made, ['repo.baseBranch=main']);
  return made;
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

test('shellCommands reads the text of a heredoc as data, not as commands', () => {
  // Found in GH-2: a journal entry in a heredoc named a push in backticks, and the guard denied a push.
  assert.deepEqual(shellCommands("cat >> j.md <<'EOF'\nNo rule for `git push`.\ngit push\nEOF\ngit status"), [['cat', '>>', 'j.md'], ['git', 'status']]);
  assert.deepEqual(shellCommands('cat <<EOF > out.md && echo ok\ngit push\nEOF\necho next'), [['cat', '>', 'out.md'], ['echo', 'ok'], ['echo', 'next']]);
  assert.deepEqual(shellCommands('cat <<"END"\ngh pr create\nEND'), [['cat']]);
  assert.deepEqual(shellCommands('cat<<-EOF\n\tgit push\n\tEOF\ngit push'), [['cat'], ['git', 'push']], '<<- ends at a line with leading tabs.');
  assert.deepEqual(shellCommands('cat <<A <<B\ngit push\nA\ngit push\nB\necho done'), [['cat'], ['echo', 'done']], 'Two heredocs on one line.');
  assert.deepEqual(shellCommands('cat <<EOF\r\ngit push\r\nEOF\r\ngit status'), [['cat'], ['git', 'status']], 'CRLF lines.');
  assert.deepEqual(shellCommands('cat <<EOF\ngit push'), [['cat']], 'A heredoc with no end line runs to the end.');
  assert.deepEqual(shellCommands('grep x <<< "git push" && git push'), [['grep', 'x', 'git push'], ['git', 'push']], 'A here-string is one word.');
  assert.deepEqual(shellCommands('echo "a << b" && git push'), [['echo', 'a << b'], ['git', 'push']], 'Quoted << is text.');
  assert.deepEqual(shellCommands('echo $((1<<2))\ngit push').at(-1), ['git', 'push'], 'A shift is not a heredoc, so the push stays visible.');
  // Found by the adversarial review of GH-2: these inputs hid a command that bash runs.
  assert.deepEqual(shellCommands('echo $((a<<b))\ngit push').at(-1), ['git', 'push'], 'A shift with a name operand.');
  assert.deepEqual(shellCommands('echo $(( 1 << n ))\ngit push').at(-1), ['git', 'push']);
  assert.deepEqual(shellCommands('echo \\<<EOF\ngit push').at(-1), ['git', 'push'], 'An escaped < starts no heredoc.');
  assert.deepEqual(shellCommands('echo hi # <<EOF\ngit push'), [['echo', 'hi'], ['git', 'push']], 'A comment starts no heredoc.');
  assert.deepEqual(shellCommands("bash <<'EOF'\ngit push\nEOF"), [['bash'], ['git', 'push'], ['EOF']], 'A shell runs the heredoc text, so it stays as commands.');
  assert.deepEqual(shellCommands('cat <<EOF | sh\ngh issue comment 7\nEOF').slice(0, 3), [['cat'], ['sh'], ['gh', 'issue', 'comment', '7']]);
  assert.deepEqual(shellCommands('echo a#b "#c"'), [['echo', 'a#b', '#c']], 'A # inside a word or in quotes is text.');
});

test('changeCommands reads the change request command of the repo.open-change row, without the git push', () => {
  assert.deepEqual(changeCommands(repoTemplate), [['gh', 'pr', 'create']]);
  assert.deepEqual(changeCommands('| `repo.open-change` | `az.exe repos pr create --title "<t>"` | n |'), [['az', 'repos', 'pr', 'create']]);
  assert.deepEqual(changeCommands('| `repo.open-change` | manual | The user opens the request in the web UI. |'), []);
  assert.deepEqual(changeCommands('| `repo.update-change` | `gh pr edit <n>` | n |'), []);
  assert.deepEqual(changeCommands(''), []);
});

test('writeCommands reads the commands of the 8 write capabilities, also from the Notes cell', () => {
  const texts = Object.fromEntries(['tracker', 'repo', 'ci'].map((kind) => [kind, readFileSync(path.join(templates, `${kind}.md`), 'utf8')]));
  const found = writeCommands(texts).map(({ capability, words, method }) => `${capability}: ${words.join(' ')}${method ? ` (${method})` : ''}`);
  assert.deepEqual(found, [
    'tracker.comment: gh issue comment', 'tracker.create: gh issue create',
    'tracker.transition: gh issue close', 'tracker.transition: gh issue reopen', 'tracker.transition: gh issue edit',
    'tracker.link: gh issue comment',
    'repo.open-change: gh pr create',
    'repo.update-change: gh pr edit', 'repo.update-change: gh pr comment',
    'repo.reply: gh api (POST)',
    'ci.trigger: gh workflow run', 'ci.trigger: gh run rerun',
  ]);
  assert.deepEqual(writeCommands({}), [], 'No config gives no write command.');
  assert.deepEqual(capabilityCommands(texts.tracker, 'tracker.fetch'), [{ words: ['gh', 'issue', 'view'] }], 'A read row gives its commands, but writeCommands does not ask for it.');
  assert.deepEqual(capabilityCommands('| `repo.reply` | `curl --method=PATCH https://h/<id>` | n |', 'repo.reply'), [], 'One word is not a command.');
  assert.deepEqual(capabilityCommands('| `repo.reply` | `az repos pr reply -X POST` | n |', 'repo.reply'), [{ words: ['az', 'repos', 'pr', 'reply'], method: 'POST' }]);
  assert.deepEqual(capabilityCommands('| `tracker.comment` | manual | Paste it in the web UI. |', 'tracker.comment'), []);
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
  assert.deepEqual(shipActions('git -C ../wt push', base, []), [{ kind: 'push', cwd: path.resolve(base, '../wt'), refs: [], all: false, sources: ['HEAD'], deletes: false }]);
  assert.deepEqual(shipActions('cd sub/dir && git push; cd .. && gh pr create', base, changes), [
    { kind: 'push', cwd: path.resolve(base, 'sub/dir'), refs: [], all: false, sources: ['HEAD'], deletes: false }, { kind: 'change', cwd: path.resolve(base, 'sub'), words: ['gh', 'pr', 'create'] },
  ]);
  // A push names its branches: the first plain word is the remote, and each other word is a refspec.
  const targets = (line) => shipActions(line, base, []).map(({ refs, all }) => ({ refs, all }));
  assert.deepEqual(targets('git push -u origin users/a/APP-7 +fix:refs/heads/other refs/heads/x'), [{ refs: ['users/a/APP-7', 'fix', 'x'], all: false }]);
  assert.deepEqual(targets('git push origin :old -o ci.skip HEAD'), [{ refs: ['HEAD'], all: false }]);
  assert.deepEqual(targets('git push --all origin'), [{ refs: [], all: true }]);
  assert.deepEqual(targets('git push --mirror'), [{ refs: [], all: true }]);
  // What a push sends: the source of each refspec, HEAD for no refspec, nothing for a delete, all branches, or a pattern.
  const sent = (line) => shipActions(line, base, []).map(({ sources, deletes }) => ({ sources, deletes }));
  assert.deepEqual(sent('git push'), [{ sources: ['HEAD'], deletes: false }]);
  assert.deepEqual(sent('git push origin HEAD:main +abc123:refs/heads/x'), [{ sources: ['HEAD', 'abc123'], deletes: false }]);
  assert.deepEqual(sent('git push origin --delete old'), [{ sources: [], deletes: true }]);
  assert.deepEqual(sent('git push -d origin old'), [{ sources: [], deletes: true }]);
  assert.deepEqual(sent('git push origin :old'), [{ sources: [], deletes: true }]);
  assert.deepEqual(sent('git push --all'), [{ sources: [], deletes: false }]);
  assert.deepEqual(sent('git push origin refs/heads/*:refs/heads/*'), [{ sources: [], deletes: false }]);
});

test('a push that names a ticket branch is checked from each folder of the repository', (t) => {
  // Found in an eval run of 7.3.0: an agent goes to the main checkout and pushes the ticket branch by its name.
  const s = setup(t);
  const branch = 'users/a/APP-7-doc-import';
  assert.equal(run(s.app, `git push -u origin ${branch}`).decision, 'deny', 'The main checkout, with the branch name.');
  assert.equal(run(os.tmpdir(), `cd "${s.app}" && git push origin +${branch}:refs/heads/copy`).decision, 'deny', 'A refspec with another target name.');
  assert.equal(run(s.app, `git push origin refs/heads/${branch}`).decision, 'deny');
  assert.equal(run(s.app, 'git push --all origin').decision, 'deny', '--all pushes the ticket branch.');
  assert.equal(run(s.app, 'git push origin main'), null, 'A push of another branch from the main checkout is not a ticket step.');
  assert.equal(run(s.app, 'git push'), null);
  const done = setup(t, { approved: ['Planned?', 'Shippable?'] });
  assert.equal(run(done.app, `git push -u origin ${branch}`), null, 'An approved ticket can push from each folder.');
  assert.equal(run(done.app, 'git push --all origin'), null);
});

test('readToolEvent reads the command of each host format and ignores a tool call without a command', () => {
  assert.deepEqual(readToolEvent('{"cwd":"/x","tool_name":"Bash","tool_input":{"command":"git push"}}'), { cwd: '/x', command: 'git push', mode: '' });
  assert.deepEqual(readToolEvent('{"cwd":"/x","permission_mode":"bypassPermissions","tool_name":"Bash","tool_input":{"command":"git push"}}'), { cwd: '/x', command: 'git push', mode: 'bypassPermissions' });
  assert.deepEqual(readToolEvent('{"cwd":"/x","toolName":"bash","toolArgs":"{\\"command\\":\\"git push\\"}"}'), { cwd: '/x', command: 'git push', mode: '' });
  assert.deepEqual(readToolEvent('{"toolName":"powershell","toolArgs":{"command":"git push"}}'), { cwd: '', command: 'git push', mode: '' });
  for (const raw of ['', '{bad', '[1]', '{"tool_name":"Edit","tool_input":{"file_path":"a"}}', '{"toolName":"bash","toolArgs":"not json"}', '{"tool_input":{"command":"  "}}']) {
    assert.equal(readToolEvent(raw), null, raw);
  }
});

test('a push in a ticket worktree is denied until Planned? and Shippable? have a valid approval', (t) => {
  const none = setup(t);
  const verdict = run(none.worktree, 'git push -u origin users/a/APP-7-doc-import');
  assert.equal(verdict.decision, 'deny');
  assert.equal(verdict.key, 'APP-7');
  assert.match(verdict.reason, /^Forge gate guard: APP-7 has no valid approval for a push\. Planned\? is not approved\. Shippable\? is not approved\./);
  assert.match(verdict.reason, /wait for the answer of the user\. Do not run the command in another form\./);

  const partly = setup(t, { approved: ['Planned?'] });
  assert.match(run(partly.worktree, 'git push').reason, /a push\. Shippable\? is not approved\. Open the gate/);

  const all = setup(t, { approved: ['Planned?', 'Shippable?'] });
  assert.equal(run(all.worktree, 'git push'), null, 'Both approvals let the push run.');
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
  assert.equal(run(s.worktree, 'gh pr create -t T')?.decision, 'deny', 'Without a trusted config, the shipped profile config still names the change command (L-2).');
  assert.equal(preTool(null, { env }), null);
  rmSync(path.join(s.root, 'app.forge'), { recursive: true, force: true });
  assert.equal(run(s.worktree, 'git push'), null, 'No wiki, no ticket.');
});

test('a ticket README that cannot be read stops the push, and the reason names the error', (t) => {
  const s = setup(t);
  writeFileSync(s.readme, 'no frontmatter\n');
  const verdict = run(s.worktree, 'git push');
  assert.equal(verdict.decision, 'deny');
  assert.equal(verdict.key, 'APP-7', 'The key falls back to the folder name.');
  assert.match(verdict.reason, /^Forge gate guard: APP-7 has a README that Forge cannot read, so the gates for a push are unknown\. README: .*README\.md\. Error: Ticket README needs frontmatter\. Show the user the error\./);
  assert.match(verdict.reason, /forge\.mjs lint/);
  rmSync(s.readme);
  assert.match(run(s.worktree, 'git push').reason, /Error: README\.md is missing\./);
});

test('an unsupported workflow stops a push by policy.gateGuard, and a broken README of another ticket does not', (t) => {
  const old = setup(t, { workflow: 'full-v2' });
  const deny = run(old.worktree, 'git push');
  assert.equal(deny.decision, 'deny');
  assert.match(deny.reason, /Error: Unsupported ticket workflow: full-v2\. Forge 12 reads only workflow: full-v4\./);
  const v3 = setup(t, { workflow: 'full-v3' });
  const v3deny = run(v3.worktree, 'git push');
  assert.equal(v3deny.decision, 'deny');
  assert.match(v3deny.reason, /Unsupported ticket workflow: full-v3\. Forge 12 reads only workflow: full-v4\. Finish this ticket with Forge 10\.1\./);
  const asks = setup(t, { workflow: 'full-v2' });
  trustConfig(asks, ['policy.gateGuard=ask']);
  const ask = run(asks.worktree, 'git push');
  assert.equal(ask.decision, 'ask');
  assert.match(ask.reason, /Unsupported ticket workflow: full-v2/);
  const off = setup(t, { workflow: 'full-v2' });
  trustConfig(off, ['policy.gateGuard=off']);
  assert.equal(run(off.worktree, 'git push'), null);
  // A broken README of another folder: the push of the valid, approved ticket still runs.
  const done = setup(t, { approved: ['Planned?', 'Shippable?'] });
  const other = path.join(done.dir, '..', 'app-9');
  mkdirSync(other);
  writeFileSync(path.join(other, 'README.md'), '---\nkey: APP-9\nbranch: "users/a/APP-9-other"\nworkflow: full-v2\n---\n');
  assert.equal(run(done.worktree, 'git push -u origin users/a/APP-7-doc-import'), null);
  assert.equal(run(done.worktree, 'git push origin users/a/APP-9-other').decision, 'deny', 'A push that names the broken branch stops.');
});

test('a write for a ticket with a README that cannot be read gets ask, with no exception', (t) => {
  const s = setup(t, { workflow: 'full-v2' });
  trustConfig(s);
  const verdict = run(s.worktree, 'gh issue comment 7 -R a/b -F /tmp/forge-app-7-body.md');
  assert.equal(verdict.decision, 'ask');
  assert.match(verdict.reason, /^Forge gate guard: APP-7: this command is an external write: `gh issue comment`/);
  assert.match(verdict.reason, /No outbox draft is in review for it/);
  assert.equal(run(s.worktree, 'gh pr create -t T').decision, 'deny', 'A new change request is stopped, not only asked.');
});

test('with changeName none, a push of HEAD:main in the ticket worktree needs the gates', (t) => {
  const s = setup(t);
  trustConfig(s, ['repo.changeName=none']);
  const verdict = run(s.worktree, 'git push origin HEAD:main');
  assert.equal(verdict.decision, 'deny');
  assert.match(verdict.reason, /Shippable\? is not approved\./);
  const all = setup(t, { approved: ['Planned?', 'Shippable?'] });
  trustConfig(all, ['repo.changeName=none']);
  assert.equal(run(all.worktree, 'git push origin HEAD:main'), null);
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

test('guardActions finds each write command of the config, and a read with the same first words is not a write', () => {
  const texts = Object.fromEntries(['tracker', 'repo', 'ci'].map((kind) => [kind, readFileSync(path.join(templates, `${kind}.md`), 'utf8')]));
  const writes = writeCommands(texts);
  const changes = changeCommands(texts.repo);
  const base = path.resolve('/base');
  const found = (line) => guardActions(line, base, { changes, writes }).map((action) => (action.kind === 'write' ? `${action.words.join(' ')} [${action.capabilities.join(', ')}]` : action.kind));
  assert.deepEqual(found('gh issue comment 2 -R a/b -F /tmp/body.md'), ['gh issue comment [tracker.comment, tracker.link]']);
  assert.deepEqual(found('gh issue create -R a/b -t T -F /tmp/b.md'), ['gh issue create [tracker.create]']);
  assert.deepEqual(found('gh issue close 2 -R a/b --reason completed'), ['gh issue close [tracker.transition]']);
  assert.deepEqual(found('gh issue edit 2 --add-label x'), ['gh issue edit [tracker.transition]']);
  assert.deepEqual(found('gh pr edit 3 -t T'), ['gh pr edit [repo.update-change]']);
  assert.deepEqual(found('gh pr comment 3 -F b.md'), ['gh pr comment [repo.update-change]']);
  assert.deepEqual(found('gh api -X POST repos/a/b/pulls/3/comments/9/replies -F body=@b.md'), ['gh api [repo.reply]']);
  assert.deepEqual(found('gh api --method=PATCH repos/a/b/issues/2'), ['gh api [repo.reply]'], 'Another write method is also a write.');
  assert.deepEqual(found('gh workflow run ci.yml -r main'), ['gh workflow run [ci.trigger]']);
  assert.deepEqual(found('gh run rerun 77 --failed'), ['gh run rerun [ci.trigger]']);
  assert.deepEqual(found('git push -u origin x && gh pr create -t T'), ['push', 'change'], 'A change command is a change action, not also a write action.');
  // Found by the adversarial review of GH-2.
  assert.deepEqual(found('gh issue -R o/r comment 1 -F b.md'), ['gh issue comment [tracker.comment, tracker.link]'], 'An option before the subcommand.');
  assert.deepEqual(found('gh -R o/r issue comment 1'), ['gh issue comment [tracker.comment, tracker.link]']);
  assert.deepEqual(found('gh --verbose pr comment 3'), ['gh pr comment [repo.update-change]'], 'An option with no value.');
  assert.deepEqual(found('gh pr -R o/r create -t T'), ['change']);
  assert.deepEqual(found('gh api -X GET -X POST repos/x/y'), ['gh api [repo.reply]'], 'The last method counts.');
  assert.deepEqual(found('gh api --method POST --method GET repos/x/y'), []);
  assert.deepEqual(found("bash <<'EOF'\ngh issue comment 7 -F b.md\nEOF"), ['gh issue comment [tracker.comment, tracker.link]']);
  assert.deepEqual(found('gh issue comment --help'), [], 'A help call is no write.');
  assert.deepEqual(found('gh issue view 2 --comments'), []);
  for (const line of ['gh issue view 2', 'gh issue list', 'gh pr view 3', 'gh api repos/a/b/pulls/3', 'gh api -X GET repos/a/b', 'gh api graphql -f query=q', 'gh run view 77', 'echo "gh issue comment 2"', "cat <<'EOF'\ngh issue comment 2\nEOF"]) {
    assert.deepEqual(found(line), [], line);
  }
});

test('a write in a ticket worktree gets ask, and the reason names the ticket, the command, and the draft', (t) => {
  const s = setup(t);
  trustConfig(s);
  const comment = 'gh issue comment 7 -R a/b -F /tmp/forge-app-7-body.md';
  const verdict = run(s.worktree, comment);
  assert.equal(verdict.decision, 'ask');
  assert.equal(verdict.key, 'APP-7');
  assert.match(verdict.reason, /^Forge gate guard: APP-7: this command is an external write: `gh issue comment` \(tracker\.comment or tracker\.link\)\. No outbox draft is in review for it/);
  assert.match(verdict.reason, /Allow it only if you read the text and you want this one write now\.$/);
  // With the draft in the README Sendable? doc, the reason names the draft file.
  mkdirSync(path.join(s.dir, 'outbox'));
  writeFileSync(path.join(s.dir, 'outbox', 'item-comment.draft.md'), '---\nstatus: draft\n---\nText\n');
  writeFileSync(s.readme, readFileSync(s.readme, 'utf8').replace('  - { name: Sendable?, need: required, status: todo }', '  - { name: Sendable?, doc: outbox/item-comment.draft.md, need: required, status: in-review }'));
  assert.ok(run(s.worktree, comment).reason.includes(`The text is in ${path.join(s.dir, 'outbox', 'item-comment.draft.md')}.`));
  for (const command of ['gh issue close 7', 'gh workflow run ci.yml', 'gh api -X POST repos/a/b/pulls/1/comments/2/replies -F body=@b.md']) {
    assert.equal(run(s.worktree, command).decision, 'ask', command);
  }
  for (const command of ['gh issue view 7', 'gh api repos/a/b/pulls/1']) assert.equal(run(s.worktree, command), null, command);
  assert.equal(run(s.app, comment), null, 'The main checkout on the base branch has no ticket, so the written rule applies there.');
  // Found by the adversarial review of GH-2: a cd to another folder does not change the target of a write.
  for (const command of [`cd "${os.tmpdir()}" && ${comment}`, `cd .. && ${comment}`, `cd "${s.app}" && ${comment}`, `pushd "${os.tmpdir()}"; ${comment}`]) {
    assert.equal(run(s.worktree, command)?.decision, 'ask', command);
  }
  assert.equal(run(s.app, `cd "${s.worktree}" && ${comment}`).decision, 'ask', 'A cd into the ticket worktree also asks.');
  const plain = setup(t);
  assert.equal(run(plain.worktree, comment)?.decision, 'ask', 'Without a trusted config the shipped profile config still names the write command (L-2).');
});

test('a new change request asks after its gates pass, and a deny wins over an ask', (t) => {
  const none = setup(t);
  trustConfig(none);
  assert.equal(run(none.worktree, 'gh pr create -t T').decision, 'deny', 'The ship gates come first.');
  assert.equal(run(none.worktree, 'gh issue comment 7 -F b.md && git push').decision, 'deny', 'A write and a push without gates: the deny wins.');
  const done = setup(t, { approved: ['Planned?', 'Shippable?'] });
  trustConfig(done);
  const change = run(done.worktree, 'gh pr create -R a/b -t "APP-7 T" -F b.md');
  assert.equal(change.decision, 'ask');
  assert.match(change.reason, /this command is an external write: a new change request \(repo\.open-change\)\./);
  assert.equal(run(done.worktree, 'git push -u origin users/a/APP-7-doc-import'), null, 'A push gets no ask: it sends commits, not text.');
  const off = setup(t, { approved: ['Planned?', 'Shippable?'] });
  trustConfig(off, ['policy.gateGuard=off']);
  assert.equal(run(off.worktree, 'gh issue comment 7 -F b.md'), null, 'off stops the write check too.');
  const asks = setup(t);
  trustConfig(asks, ['policy.gateGuard=ask']);
  assert.equal(run(asks.worktree, 'gh issue comment 7 -F b.md').decision, 'ask', 'The ask mode changes only the ship verdict.');
});

/** The send text of a draft of the tests, and the same text in a file outside the ticket folder (the body file of the command). */
const SEND_TEXT = 'APP-7 T\n\nThe text that goes out.\n';

/** Puts outbox drafts (name: target) into the Shippable? manifest, and records the new manifest hash in the README. */
function approveDrafts(s, drafts, { listed = Object.keys(drafts) } = {}) {
  mkdirSync(path.join(s.dir, 'outbox'), { recursive: true });
  for (const [name, target] of Object.entries(drafts)) writeFileSync(path.join(s.dir, 'outbox', name), `---\nstatus: draft\ntarget: ${target}\n---\n# Title\n\nWhy now: a reason\n\n<!-- send: start -->\n${SEND_TEXT}<!-- send: end -->\n\n## Why this wording\n\nBecause.\n`);
  writeFileSync(path.join(s.root, 'send-body.md'), SEND_TEXT);
  const documents = ['review.md', ...listed.map((name) => `outbox/${name}`)].map((doc) => ({ path: doc, sha256: sha256(readFileSync(path.join(s.dir, ...doc.split('/')))) }));
  const bytes = JSON.stringify({ version: 1, gate: 'Shippable?', documents, ...(s.binding ? { code: s.binding } : {}) });
  writeFileSync(path.join(s.dir, 'approvals', 'shippable-001.json'), bytes);
  writeFileSync(s.readme, readFileSync(s.readme, 'utf8').replace(/(name: Shippable\?.*hash: )[a-f0-9]{64}/, `$1${sha256(bytes)}`));
}

test('the approval of the Shippable? set that holds the one change draft is the yes for a new change request', (t) => {
  // The body option names the approved draft by its path (L-2: a relative path would resolve from the folder of the command).
  const create = (s) => `gh pr create -R a/b -t "APP-7 T" -F ${path.join(s.root, 'send-body.md')}`;
  const ready = () => {
    const s = setup(t, { approved: ['Planned?', 'Shippable?'] });
    trustConfig(s);
    return s;
  };
  const s = ready();
  approveDrafts(s, { 'pr.draft.md': 'change' });
  assert.equal(run(s.worktree, create(s)), null);
  assert.equal(preTool({ cwd: s.worktree, command: create(s), mode: 'bypassPermissions' }, { env }), null, 'No verdict, also with no prompt.');
  assert.equal(run(s.worktree, 'git push -u origin users/a/APP-7-doc-import'), null);
  for (const command of ['gh issue comment 7 -R a/b -F b.md', 'gh issue close 7', 'gh workflow run ci.yml', 'gh api -X POST repos/a/b/pulls/1/comments/2/replies -F body=@b.md']) {
    assert.equal(run(s.worktree, command).decision, 'ask', `Another write keeps its ask: ${command}`);
  }
  // The draft changes after the approval: the gate is stale.
  writeFileSync(path.join(s.dir, 'outbox', 'pr.draft.md'), '---\nstatus: draft\ntarget: change\n---\n# Title\n\nOther text\n');
  assert.equal(run(s.worktree, create(s)).decision, 'deny');
  // A draft that is not in the manifest is no approval.
  const none = ready();
  assert.equal(run(none.worktree, create(none)).decision, 'ask');
  assert.equal(preTool({ cwd: none.worktree, command: create(none), mode: 'bypassPermissions' }, { env }).decision, 'deny');
  const unlisted = ready();
  approveDrafts(unlisted, { 'pr.draft.md': 'change' }, { listed: [] });
  assert.equal(run(unlisted.worktree, create(unlisted)).decision, 'ask');
  // Two change drafts, a draft of another target, and an existing change request all keep the ask.
  const two = ready();
  approveDrafts(two, { 'pr.draft.md': 'change', 'pr-2.draft.md': 'change' });
  assert.equal(run(two.worktree, create(two)).decision, 'ask');
  const other = ready();
  approveDrafts(other, { 'item-comment.draft.md': 'tracker-comment' });
  assert.equal(run(other.worktree, create(other)).decision, 'ask');
  const open = ready();
  approveDrafts(open, { 'pr.draft.md': 'change' });
  writeFileSync(open.readme, readFileSync(open.readme, 'utf8').replace('changes: []', 'changes:\n  - { url: "https://github.com/a/b/pull/9", state: open }'));
  assert.equal(run(open.worktree, create(open)).decision, 'ask');
  writeFileSync(open.readme, readFileSync(open.readme, 'utf8').replace('state: open }', 'state: merged }'));
  assert.equal(run(open.worktree, create(open)), null, 'A merged change request does not count.');
});

test('in bypassPermissions the host shows no prompt, so each ask becomes a deny', (t) => {
  const s = setup(t);
  trustConfig(s);
  const comment = 'gh issue comment 7 -F b.md';
  const mode = (permission) => preTool({ cwd: s.worktree, command: comment, mode: permission }, { env });
  assert.equal(mode('default').decision, 'ask');
  assert.equal(mode('').decision, 'ask', 'A host that gives no mode keeps the ask.');
  assert.equal(mode('acceptEdits').decision, 'ask');
  const deny = mode('bypassPermissions');
  assert.equal(deny.decision, 'deny');
  assert.match(deny.reason, /^Forge gate guard: APP-7: this command is an external write: `gh issue comment`/);
  assert.match(deny.reason, /This session runs in bypassPermissions mode, so the host shows the user no prompt for it\. Do not run the command in another form\. Show the user the text and the exact command/);
  const asks = setup(t);
  trustConfig(asks, ['policy.gateGuard=ask']);
  const push = preTool({ cwd: asks.worktree, command: 'git push', mode: 'bypassPermissions' }, { env });
  assert.equal(push.decision, 'deny', 'The ask mode of a push also needs a prompt.');
  assert.match(push.reason, /APP-7 has no valid approval for a push\./);
  assert.equal(preTool({ cwd: s.worktree, command: 'gh issue view 7', mode: 'bypassPermissions' }, { env }), null);
});

test('tracker.create is a write: ask in a ticket folder, deny with no prompts, and no verdict for a read of the same tool', (t) => {
  const s = setup(t);
  const where = resolve({ cwd: s.app, env });
  const file = path.join(seed(where, templates).configDir, 'tracker.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^\| `tracker\.create` .*$/m, '| `tracker.create` | `tea issues create --title "<title>" --description "$(cat <body file>)" [--labels <labels>] < /dev/null` | n |'));
  approve(where, trustStatus(where, { env }).files.filter((f) => f.rel.startsWith('config/')).map((f) => `${f.rel}=${f.sha.slice(0, 12)}`), { env });
  const create = 'tea issues create --title "T" --description "$(cat /tmp/b.md)" --labels to-check < /dev/null';
  assert.equal(run(s.worktree, create).decision, 'ask');
  assert.equal(preTool({ cwd: s.worktree, command: create, mode: 'bypassPermissions' }, { env }).decision, 'deny');
  assert.equal(run(s.worktree, 'tea issues list --state open'), null);
  const texts = { tracker: readFileSync(file, 'utf8') };
  assert.deepEqual(guardActions(create, s.app, { changes: [], writes: writeCommands(texts) }).map((action) => action.kind), ['write'], 'The real row: a quoted substitution and a redirect.');
});

test('each host gets its own output format, and no verdict gives an empty object', () => {
  const verdict = { decision: 'deny', key: 'APP-7', reason: 'Forge gate guard: text.' };
  assert.deepEqual(preToolOutput(null, 'claude'), {});
  assert.deepEqual(preToolOutput(verdict, 'claude'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Forge gate guard: text.' } });
  assert.deepEqual(preToolOutput(verdict, 'copilot-cli'), { permissionDecision: 'deny', permissionDecisionReason: 'Forge gate guard: text.' });
  assert.equal(hookArgs(['hook', 'pre-tool', '--host', 'claude'], {}).host, 'claude');
  assert.equal(hookArgs(['hook', 'pre-tool'], {}).host, 'copilot-cli');
  assert.equal(hookArgs(['hook', 'pre-tool'], { CLAUDECODE: '1' }).host, 'copilot-cli', 'A hook without --host is a Copilot CLI hook.');
  assert.equal(hookArgs(['hook', 'pre-tool', '--part', '1'], {}), null);
});

test('forge.mjs hook pre-tool always exits 0 with JSON', (t) => {
  const s = setup(t);
  const call = (input, ...args) => spawnSync(process.execPath, [cli, 'hook', 'pre-tool', ...args], { input, encoding: 'utf8', env: { ...env, CLAUDECODE: '' } });
  const claude = call(JSON.stringify({ cwd: s.worktree, tool_name: 'Bash', tool_input: { command: 'git push' } }), '--host', 'claude');
  assert.equal(claude.status, 0, claude.stderr);
  assert.equal(JSON.parse(claude.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const copilot = call(JSON.stringify({ cwd: s.worktree, toolName: 'bash', toolArgs: JSON.stringify({ command: 'git push' }) }));
  assert.equal(copilot.status, 0, copilot.stderr);
  assert.equal(JSON.parse(copilot.stdout).permissionDecision, 'deny');
  assert.match(JSON.parse(copilot.stdout).permissionDecisionReason, /^Forge gate guard: APP-7/);
  trustConfig(s);
  const write = (permission_mode) => JSON.parse(call(JSON.stringify({ cwd: s.worktree, permission_mode, tool_name: 'Bash', tool_input: { command: 'gh issue comment 7 -F b.md' } }), '--host', 'claude').stdout).hookSpecificOutput.permissionDecision;
  assert.equal(write('default'), 'ask');
  assert.equal(write('bypassPermissions'), 'deny', 'The CLI passes the permission mode to the guard.');
  for (const input of ['{bad', '', JSON.stringify({ cwd: s.worktree, tool_name: 'Bash', tool_input: { command: 'git status' } })]) {
    const quiet = call(input, '--host', 'claude');
    assert.equal(quiet.status, 0);
    assert.deepEqual(JSON.parse(quiet.stdout), {});
  }
});

const APPROVE = () => `node ${cli} gate-approve app-7 planned --answer approve`;

test('guardActions gives an approve action for gate-approve and trust approve, in each launcher form', () => {
  const cwd = '/x';
  const kinds = (line) => guardActions(line, cwd).map((a) => a.kind);
  assert.deepEqual(guardActions('node /p/scripts/forge.mjs gate-approve app-7 planned --answer "approve planned" --method chat', cwd),
    [{ kind: 'approve', cwd, command: 'gate-approve', key: 'app-7', gate: 'planned', answer: 'approve planned' }]);
  assert.deepEqual(guardActions('node /p/forge.mjs --wiki /w trust approve config/repo.md=abcdef123456', cwd),
    [{ kind: 'approve', cwd, command: 'trust approve', files: ['config/repo.md=abcdef123456'] }]);
  assert.deepEqual(kinds('forge gate-approve app-7 planned --answer approve'), ['approve']);
  assert.deepEqual(kinds('/home/a/bin/forge.cmd gate-approve app-7 planned --answer approve'), ['approve']);
  assert.deepEqual(kinds('C:\\forge\\forge.mjs gate-approve app-7 planned --answer approve'), ['approve']);
  assert.deepEqual(kinds('FORGE_X=1 sudo node /p/forge.mjs trust approve a=12345678'), ['approve']);
  // No verdict for a dry run, a help call, the status call of trust, and a command that only names the words.
  assert.deepEqual(kinds('node /p/forge.mjs gate-approve app-7 planned --answer approve --dry-run'), []);
  assert.deepEqual(kinds('node /p/forge.mjs gate-approve --help'), []);
  assert.deepEqual(kinds('forge trust approve -h'), []);
  assert.deepEqual(kinds('node /p/forge.mjs trust'), []);
  assert.deepEqual(kinds('node /p/forge.mjs trust --json'), []);
  assert.deepEqual(kinds('grep gate-approve plugins/forge/scripts/forge.mjs'), []);
  assert.deepEqual(kinds('node /p/forge.mjs lint app-7'), []);
  // A quoted --answer that holds "--dry-run" is one word, so it is still an approval.
  assert.deepEqual(kinds('node /p/forge.mjs gate-approve app-7 planned --answer "approve --dry-run"'), ['approve']);
});

test('preTool asks for an approval command in a ticket worktree, in the main checkout, with an untrusted config, and with gateGuard off', (t) => {
  const s = setup(t);
  const check = (verdict, text) => {
    assert.equal(verdict?.decision, 'ask');
    assert.match(verdict.reason, /^Forge gate guard: /);
    assert.match(verdict.reason, text);
    assert.match(verdict.reason, /Allow it only if you gave this answer yourself\./);
  };
  // The config is not trusted yet, and the folder is a ticket worktree or the main checkout.
  check(run(s.worktree, APPROVE()), /gate-approve.*planned.*app-7.*"approve"/);
  check(run(s.app, APPROVE()), /gate-approve/);
  check(run(s.worktree, 'forge gate-approve app-7 planned --answer approve'), /gate-approve/);
  check(run(s.worktree, 'forge.cmd gate-approve app-7 planned --answer approve'), /gate-approve/);
  check(run(s.worktree, `node ${cli} trust approve config/repo.md=abcdef123456`), /trust approve.*config\/repo\.md=abcdef123456/);
  // A folder with no repository, no ticket, and no wiki.
  const bare = mkdtempSync(path.join(os.tmpdir(), 'forge-guard-bare-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  check(run(bare, APPROVE()), /gate-approve/);
  // policy.gateGuard: off does not turn it off.
  const off = setup(t);
  trustConfig(off, ['policy.gateGuard=off']);
  assert.equal(run(off.worktree, `git push origin users/a/APP-7-doc-import`), null, 'Control: the push guard is off.');
  check(run(off.worktree, APPROVE()), /gate-approve/);
  check(run(off.app, `node ${cli} trust approve config/repo.md=abcdef123456`), /trust approve/);
});

test('preTool denies an approval command in bypassPermissions and gives no verdict for the read forms', (t) => {
  const s = setup(t);
  const verdict = preTool({ cwd: s.worktree, command: APPROVE(), mode: 'bypassPermissions' }, { env });
  assert.equal(verdict.decision, 'deny');
  assert.match(verdict.reason, /gate-approve/);
  assert.match(verdict.reason, /run it in a terminal/);
  assert.equal(preTool({ cwd: s.worktree, command: APPROVE(), mode: 'default' }, { env }).decision, 'ask');
  for (const command of [
    `node ${cli} gate-approve app-7 planned --answer approve --dry-run`,
    `node ${cli} gate-approve --help`,
    `node ${cli} trust`,
    `node ${cli} trust --json`,
    'grep gate-approve plugins/forge/scripts/forge.mjs',
  ]) assert.equal(run(s.worktree, command), null, command);
  assert.equal(run(s.worktree, `node ${cli} gate-approve app-7 planned --answer "approve --dry-run"`)?.decision, 'ask');
});

test('a push is bound to the code of the Shippable? approval: a new commit is denied, a clean rebase and an unchanged branch pass', (t) => {
  const push = 'git push -u origin users/a/APP-7-doc-import';
  const s = setup(t, { approved: ['Planned?', 'Shippable?'] });
  assert.equal(run(s.worktree, push), null, 'The approved code pushes.');
  // A clean rebase: main moves on, the branch is rebased, and the patch-id stays.
  writeFileSync(path.join(s.app, 'c.txt'), 'other\n');
  git(s.app, 'add', 'c.txt');
  git(s.app, 'commit', '-q', '-m', 'other');
  git(s.worktree, 'rebase', '-q', 'main');
  assert.notEqual(git(s.worktree, 'rev-parse', 'HEAD'), s.binding.head);
  assert.equal(run(s.worktree, push), null, 'A clean rebase keeps the patch-id.');
  assert.equal(run(s.app, push), null, 'Also from the main checkout.');
  // A new commit after the approval.
  writeFileSync(path.join(s.worktree, 'b.txt'), 'changed after GO\n');
  git(s.worktree, 'commit', '-q', '-am', 'late fix');
  const late = run(s.worktree, push);
  assert.equal(late.decision, 'deny');
  assert.match(late.reason, /The code changed after the Shippable\? approval/);
  assert.equal(run(s.app, push).decision, 'deny', 'Also from the main checkout.');
});

test('a push is denied with no code binding, with a read error (own message), and with another branch in the manifest', (t) => {
  const push = 'git push -u origin users/a/APP-7-doc-import';
  const old = setup(t, { approved: ['Planned?', 'Shippable?'], code: 'none' });
  const noCode = run(old.worktree, push);
  assert.equal(noCode.decision, 'deny');
  assert.match(noCode.reason, /approved before Forge 13\.1\.0 or without a code binding.*Open Shippable\? again/);
  // A base branch that does not exist: the binding cannot be read, which is not a mismatch.
  const gone = setup(t, { approved: ['Planned?', 'Shippable?'] });
  trustConfig(gone, ['repo.baseBranch=nope']);
  const error = run(gone.worktree, push);
  assert.equal(error.decision, 'deny');
  assert.match(error.reason, /base branch nope not found: set repo\.baseBranch/);
  assert.doesNotMatch(error.reason, /git fetch/);
  assert.doesNotMatch(error.reason, /code changed after/);
  // The missing worktree is the same kind of error.
  const away = setup(t, { approved: ['Planned?', 'Shippable?'] });
  rmSync(away.worktree, { recursive: true, force: true });
  assert.match(run(away.app, push).reason, /Forge cannot read the code/);
  // The manifest names another branch than the README.
  const other = setup(t, { approved: ['Planned?', 'Shippable?'] });
  const manifest = path.join(other.dir, 'approvals', 'shippable-001.json');
  const bytes = JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), code: { ...other.binding, branch: 'users/a/other' } });
  writeFileSync(manifest, bytes);
  writeFileSync(other.readme, readFileSync(other.readme, 'utf8').replace(/(name: Shippable\?.*hash: )[a-f0-9]{64}/, `$1${sha256(bytes)}`));
  const branch = run(other.worktree, push);
  assert.equal(branch.decision, 'deny');
  assert.match(branch.reason, /is not the branch of the Shippable\? approval/);
  // policy.gateGuard ask keeps its meaning, and off skips the check.
  const asks = setup(t, { approved: ['Planned?', 'Shippable?'], code: 'none' });
  trustConfig(asks, ['policy.gateGuard=ask']);
  assert.equal(run(asks.worktree, push).decision, 'ask');
  const off = setup(t, { approved: ['Planned?', 'Shippable?'], code: 'none' });
  trustConfig(off, ['policy.gateGuard=off']);
  assert.equal(run(off.worktree, push), null);
});

test('H1: the approval parser reads the same value options as parseArgs', () => {
  const cwd = path.resolve('/wt');
  const commands = (line) => guardActions(line, cwd).map((action) => action.command);
  assert.deepEqual(commands('node /p/scripts/forge.mjs --base x gate-approve L-1 Shippable? --answer yes'), ['gate-approve']);
  assert.deepEqual(commands('node /p/scripts/forge.mjs --summary s trust approve config/a.md=1'), ['trust approve']);
  assert.deepEqual(commands('node /p/scripts/forge.mjs --port 80 --out o gate-approve L-1 Planned? --answer yes'), ['gate-approve']);
  const first = guardActions('node /p/scripts/forge.mjs --base x gate-approve L-1 Shippable? --answer yes', cwd)[0];
  assert.deepEqual([first.key, first.gate, first.answer], ['L-1', 'Shippable?', 'yes']);
  // Each value option of parseArgs is a value option of the guard: the next word is not the subcommand.
  for (const option of FORGE_VALUE_OPTIONS) {
    assert.deepEqual(parseArgs([option, 'v', 'gate-approve'])._, ['gate-approve'], option);
    assert.deepEqual(commands(`node /p/forge.mjs ${option} v gate-approve L-1 Planned?`), ['gate-approve'], option);
  }
});

test('H2: a push must send the head of the approved ticket branch', (t) => {
  const s = setup(t, { approved: ['Planned?', 'Shippable?'] });
  const branch = 'users/a/APP-7-doc-import';
  assert.equal(run(s.worktree, `git push origin ${branch}:main`), null, 'The branch itself passes.');
  assert.equal(run(s.worktree, `git push origin ${s.binding.head}:main`), null, 'Its sha passes.');
  assert.equal(run(s.worktree, 'git push origin HEAD:main'), null, 'HEAD is the branch head here.');
  // Another sha: the first commit of main.
  const other = git(s.app, 'rev-parse', 'main');
  const denied = run(s.worktree, `git push origin ${other}:main`);
  assert.equal(denied.decision, 'deny');
  assert.match(denied.reason, new RegExp(`this push sends ${other.slice(0, 12)}, not the head of the ticket branch ${branch}`));
  assert.equal(run(s.worktree, 'git push origin main').decision, 'deny', 'Another branch name.');
  // A detached HEAD with a new commit: the branch ref has not moved, but the push sends new code.
  git(s.worktree, 'checkout', '-q', '--detach');
  assert.equal(run(s.worktree, 'git push origin HEAD:main'), null, 'A detached HEAD on the branch head is the approved code.');
  writeFileSync(path.join(s.worktree, 'c.txt'), 'new\n');
  git(s.worktree, 'add', 'c.txt');
  git(s.worktree, 'commit', '-q', '-m', 'detached');
  const detached = run(s.worktree, 'git push origin HEAD:main');
  assert.equal(detached.decision, 'deny');
  assert.match(detached.reason, /this push sends [0-9a-f]{12}, not the head of the ticket branch/);
  assert.equal(run(s.worktree, 'git push').decision, 'deny', 'A push with no refspec sends HEAD.');
  assert.equal(run(s.worktree, `git push origin ${git(s.worktree, 'rev-parse', 'HEAD')}:main`).decision, 'deny');
  // A delete sends no code.
  assert.equal(run(s.worktree, `git push origin --delete ${branch}`), null);
  assert.equal(run(s.worktree, `git push origin :${branch}`), null);
});

test('H3: an empty README branch does not turn the code binding off', (t) => {
  const s = setup(t, { approved: ['Planned?', 'Shippable?'] });
  const push = 'git push -u origin users/a/APP-7-doc-import';
  assert.equal(run(s.worktree, push), null);
  writeFileSync(s.readme, readFileSync(s.readme, 'utf8').replace('branch: "users/a/APP-7-doc-import"', 'branch: ""'));
  const denied = run(s.worktree, 'git push origin HEAD:main');
  assert.equal(denied?.decision, 'deny');
  assert.match(denied.reason, /the README branch is empty, but the Shippable\? approval binds the branch users\/a\/APP-7-doc-import/);
});

test('M2: an untrusted config and a missing base branch have their own message, a closed ticket and a delete get no binding check', (t) => {
  const push = 'git push -u origin users/a/APP-7-doc-import';
  const untrusted = setup(t, { approved: ['Planned?', 'Shippable?'] });
  setValues(resolveConfigDir(untrusted), ['repo.baseBranch=develop']);
  const a = run(untrusted.worktree, push);
  assert.equal(a.decision, 'deny');
  assert.match(a.reason, /the Forge config is not trusted \(run \`forge\.mjs trust\`\)/);
  assert.doesNotMatch(a.reason, /git fetch/);
  const gone = setup(t, { approved: ['Planned?', 'Shippable?'] });
  trustConfig(gone, ['repo.baseBranch=nope']);
  assert.match(run(gone.worktree, push).reason, /base branch nope not found: set repo\.baseBranch/);
  assert.equal(run(gone.worktree, 'git push origin --delete users/a/APP-7-doc-import'), null, 'A delete is not checked.');
  // A closed ticket: its work is merged, so the binding does not apply.
  const closed = setup(t, { approved: ['Planned?', 'Shippable?'] });
  writeFileSync(path.join(closed.worktree, 'b.txt'), 'changed after GO\n');
  git(closed.worktree, 'commit', '-q', '-am', 'late fix');
  assert.equal(run(closed.worktree, push).decision, 'deny');
  writeFileSync(closed.readme, readFileSync(closed.readme, 'utf8').replace('phase: start', 'phase: closed').replace('state: active', 'state: done'));
  assert.equal(run(closed.worktree, push), null, 'A closed ticket gets no binding check.');
});

function resolveConfigDir(s) {
  return seed(resolve({ cwd: s.app, env }), templates).configDir;
}

test('M3: one deadline for the whole call: an over deadline denies with a clear message', (t) => {
  const s = setup(t, { approved: ['Planned?', 'Shippable?'] });
  const push = 'git push -u origin users/a/APP-7-doc-import';
  assert.equal(preTool({ cwd: s.worktree, command: push }, { env, deadlineMs: 0 }).decision, 'deny');
  assert.match(preTool({ cwd: s.worktree, command: push }, { env, deadlineMs: 0 }).reason, /ran out of time/);
  assert.equal(preTool({ cwd: s.worktree, command: push }, { env }), null, 'The default budget is enough.');
});

// L-2 step 1: the parser reads shell keywords, wrapper options, substitutions in quotes, folders, and hidden approval forms.
const HIDDEN = [
  'if true; then CMD; fi', 'while true; do CMD; break; done', 'for b in a; do CMD; done', '{ CMD || true; }', '! CMD', 'if ! CMD; then echo x; fi',
  'timeout 120 CMD', 'timeout -s KILL 30 CMD', 'timeout --signal=KILL -k 5 30 CMD', 'nice -n 5 CMD', 'stdbuf -o0 CMD', 'stdbuf -o 0 -e L CMD',
  'env -i CMD', 'env -i -u NAME CMD', 'env -u NAME -C /x CMD', 'sudo -u x CMD', 'sudo -u x -g y CMD', 'command -p CMD', 'exec -a name CMD', 'time -p CMD',
  'nohup CMD', 'sudo -- CMD', 'sudo env -i timeout 5 nice -n 1 CMD', 'env -S "CMD"',
  'out="$(CMD)"', 'echo "x $(CMD) y"', 'echo "`CMD`"', 'echo "a $(echo "$(CMD)")"',
];

test('L-2: a push is found behind shell keywords, wrapper options, and substitutions in double quotes', () => {
  const base = path.resolve('/base');
  for (const form of HIDDEN) {
    const line = form.replace('CMD', 'git push');
    assert.deepEqual(shipActions(line, base, []).map((action) => action.kind), ['push'], line);
  }
});

test('L-2: a change command and a write command are found in the same hidden forms', () => {
  const base = path.resolve('/base');
  const texts = Object.fromEntries(['tracker', 'repo', 'ci'].map((kind) => [kind, readFileSync(path.join(templates, `${kind}.md`), 'utf8')]));
  const options = { changes: changeCommands(texts.repo), writes: writeCommands(texts) };
  for (const form of HIDDEN) {
    assert.deepEqual(guardActions(form.replace('CMD', 'gh pr create -t T'), base, options).map((action) => action.kind), ['change'], form);
    assert.deepEqual(guardActions(form.replace('CMD', 'gh issue comment 7 -F b.md'), base, options).map((action) => action.kind), ['write'], form);
  }
});

test('L-2: an approval command is found in the hidden forms, and a text scan finds the forms that no word parser reads', () => {
  const cwd = path.resolve('/base');
  for (const form of HIDDEN) {
    const line = form.replace('CMD', 'node /p/forge.mjs gate-approve L-2 Planned? --answer approve');
    assert.deepEqual(guardActions(line, cwd).map((action) => action.kind), ['approve'], line);
  }
  const asks = [
    'F=/x/forge.mjs; node $F gate-approve L-2 Planned? --answer approve',
    'node "$F" trust approve config/repo.md=abcdef123456',
    'npx forge gate-approve L-2 Planned?',
    'bun $F gate-approve',
    `node -e "import('/x/plugins/forge/scripts/lib/approve.mjs').then((m) => m.approveGate())"`,
    `node --eval "import('/x/approve.mjs')"`,
    `node -p "require('/x/approve.mjs')"`,
    'node --import /x/lib/approve.mjs a.js',
    'node -r /x/approve.mjs a.js',
    `bash -c 'node "$F" gate-approve L-2 Planned?'`,
    `sh -c "node forge.mjs trust approve x=1"`,
    `bash -lc "node /x/approve.mjs"`,
    "node - <<'EOF'\nimport('/x/approve.mjs');\nEOF",
    "node <<EOF\nawait import('/x/approve.mjs')\nEOF",
    "bash <<'EOF'\nF=/x/forge.mjs; node $F gate-approve L-2 Planned?\nEOF",
    'timeout 5 node $F gate-approve',
  ];
  for (const line of asks) assert.deepEqual(guardActions(line, cwd).map((action) => action.kind), ['approve'], line);
  const none = [
    'grep gate-approve x', 'cat approve.mjs', 'echo "node forge.mjs gate-approve"', 'node --check plugins/forge/scripts/lib/approve.mjs',
    'node --test', 'node --test tests/approve.test.mjs', 'node a.js', 'if true; then git log; fi', 'timeout 5 gh pr view 5',
    'node /p/forge.mjs gate-approve L-2 Planned? --dry-run', 'node $F gate-approve --help', 'npx forge lint', 'bash -c "ls approve"',
    'node -e "console.log(1)"', "cat <<EOF\nnode forge.mjs gate-approve\nEOF", 'sudo -u x ls', 'timeout 5 sleep 1', 'env -i ls', 'ls "$(pwd)"',
  ];
  for (const line of none) assert.deepEqual(guardActions(line, cwd).map((action) => action.kind), [], line);
});

test('L-2: a text scan hit has the verdict of an approval: ask, and deny in a mode with no prompt', (t) => {
  const s = setup(t);
  const line = 'F=/x/forge.mjs; node $F gate-approve L-2 Planned?';
  assert.equal(run(s.worktree, line).decision, 'ask');
  assert.equal(preTool({ cwd: s.worktree, command: line, mode: 'bypassPermissions' }, { env }).decision, 'deny');
  assert.equal(run(os.tmpdir(), 'timeout 30 node /p/forge.mjs gate-approve L-2 Planned? --answer approve').decision, 'ask');
  assert.equal(run(s.worktree, 'grep gate-approve x'), null);
  assert.equal(run(s.worktree, 'node --check plugins/forge/scripts/lib/approve.mjs'), null);
  assert.equal(run(s.worktree, 'if true; then git log; fi'), null);
});

test('L-2: a push in a hidden form is denied in a ticket worktree with no approvals', (t) => {
  const s = setup(t);
  for (const form of HIDDEN) {
    const line = form.replace('CMD', 'git push');
    assert.equal(run(s.worktree, line)?.decision, 'deny', line);
  }
});

test('L-2: a substitution in a heredoc with an unquoted delimiter gives commands, and a quoted delimiter keeps the body as data', () => {
  const base = path.resolve('/base');
  const kinds = (line) => shipActions(line, base, []).map((action) => action.kind);
  assert.deepEqual(kinds('cat <<EOF\nresult: $(git push)\nEOF'), ['push']);
  assert.deepEqual(kinds('cat <<EOF\nresult: `git push`\nEOF'), ['push']);
  assert.deepEqual(kinds('cat <<-EOF\n\t$(git push)\n\tEOF'), ['push']);
  assert.deepEqual(kinds('cat > a.md <<EOF\nline $(echo $(git push))\nEOF\necho done'), ['push']);
  assert.deepEqual(kinds("cat <<'EOF'\n$(git push)\nEOF"), []);
  assert.deepEqual(kinds('cat <<"EOF"\n$(git push)\n`git push`\nEOF'), []);
  assert.deepEqual(kinds('cat <<\\EOF\n$(git push)\nEOF'), []);
  assert.deepEqual(kinds('cat <<EOF\nescaped \\$(git push) and \\`git push\\`\nEOF'), [], 'An escaped substitution is text.');
  assert.deepEqual(kinds('cat <<EOF\nplain git push text\nEOF'), []);
  assert.deepEqual(shellCommands("cat <<'EOF'\n$(git push)\nEOF\ngit status"), [['cat'], ['git', 'status']]);
  assert.deepEqual(shellCommands('echo "$(git push)"'), [['echo', '$(git push)'], ['git', 'push']], 'The quoted word stays, and the substitution gives its command.');
});

test('L-2: a cd inside parentheses does not leak after the closing parenthesis', () => {
  const base = path.resolve('/base');
  const cwds = (line) => shipActions(line, base, []).map((action) => action.cwd);
  assert.deepEqual(cwds('(cd /tmp/x && ls); git push'), [base]);
  assert.deepEqual(cwds('(cd /tmp/x && git push); git push'), [path.resolve('/tmp/x'), base]);
  assert.deepEqual(cwds('cd /one && (cd /two; ls) && git push'), [path.resolve('/one')]);
  assert.deepEqual(cwds('echo $(cd /tmp/x; pwd); git push'), [base]);
  assert.deepEqual(cwds('echo "$(cd /tmp/x; pwd)"; git push'), [base]);
  assert.deepEqual(cwds('cd /one; git push'), [path.resolve('/one')]);
  assert.deepEqual(cwds('cd /other/repo && git push'), [path.resolve('/other/repo')], 'A real folder keeps its own folder.');
});

test('L-2: cd and git -C expand ~ with HOME, then USERPROFILE, then the home of the user, and a target that cannot be known has no folder', () => {
  const base = path.resolve('/base');
  const home = path.resolve('/home/u');
  const withEnv = (line, vars) => guardActions(line, base, { env: vars });
  assert.deepEqual(withEnv('cd ~ && git push', { HOME: home }).map((a) => a.cwd), [home]);
  assert.deepEqual(withEnv('cd ~/x && git push', { HOME: home }).map((a) => a.cwd), [path.join(home, 'x')]);
  assert.deepEqual(withEnv('git -C ~/x push', { HOME: home }).map((a) => a.cwd), [path.join(home, 'x')]);
  assert.deepEqual(withEnv('git -C ~ push', { HOME: home }).map((a) => a.cwd), [home]);
  assert.deepEqual(withEnv('cd ~/x && git push', { USERPROFILE: home }).map((a) => a.cwd), [path.join(home, 'x')]);
  assert.deepEqual(withEnv('cd ~/x && git push', { HOME: '', USERPROFILE: home }).map((a) => a.cwd), [path.join(home, 'x')]);
  assert.deepEqual(withEnv('cd ~/x && git push', {}).map((a) => a.cwd), [path.join(os.homedir(), 'x')]);
  assert.deepEqual(withEnv('cd && git push', { HOME: home }).map((a) => a.cwd), [home]);
  assert.deepEqual(withEnv('cd /abs/dir && git push', { HOME: home }).map((a) => a.cwd), [path.resolve('/abs/dir')]);
  for (const target of ['$HOME/x', '"$X"', '`pwd`', '$(pwd)', '~root/x', '-', '${HOME}']) {
    const actions = withEnv(`cd ${target} && git push`, { HOME: home });
    assert.deepEqual(actions.map((a) => [a.kind, a.cwd, a.unknown]), [['push', base, true]], target);
  }
  assert.deepEqual(withEnv('git -C $X push', { HOME: home }).map((a) => [a.cwd, a.unknown]), [[base, true]]);
  assert.deepEqual(withEnv('cd $X; cd /abs && git push', { HOME: home }).map((a) => [a.cwd, a.unknown]), [[path.resolve('/abs'), undefined]], 'An absolute folder after an unknown one is known again.');
  assert.deepEqual(withEnv('cd $X; cd sub && git push', { HOME: home }).map((a) => a.unknown), [true], 'A relative folder after an unknown one is unknown.');
});

test('L-2: G3a, G3b: a push after a cd to a folder that cannot be a ticket folder uses the ticket of the session folder', (t) => {
  const s = setup(t);
  assert.equal(run(s.worktree, 'cd ~/nowhere-forge-test && git push')?.decision, 'deny', 'G3a: the folder does not exist.');
  assert.equal(run(s.worktree, 'cd $HOME/x && git push')?.decision, 'deny', 'G3b: the folder is unknown.');
  assert.equal(run(s.worktree, 'cd "$(mktemp -d)" && git push')?.decision, 'deny');
  assert.equal(run(s.worktree, 'git -C $X push')?.decision, 'deny');
  // A change request command follows the same rule.
  trustConfig(s);
  assert.equal(run(s.worktree, 'cd $HOME/x && gh pr create -t T')?.decision, 'deny');
  // A push in another real repository keeps its folder, so it is not a step of this ticket.
  const other = path.join(s.root, 'other');
  mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  assert.equal(run(s.worktree, `cd ${other} && git push`), null);
  assert.equal(run(s.worktree, `(cd ${other}; ls); git push`)?.decision, 'deny', 'The cd in parentheses does not leak.');
  // `~` uses the HOME of the event env.
  const home = path.join(s.root, 'home');
  mkdirSync(path.join(home, 'x'), { recursive: true });
  git(path.join(home, 'x'), 'init', '-q', '-b', 'main');
  assert.equal(preTool({ cwd: s.worktree, command: 'git -C ~/x push' }, { env: { ...env, HOME: home } }), null);
  assert.equal(preTool({ cwd: s.worktree, command: 'cd ~/x && git push' }, { env: { ...env, HOME: home } }), null);
});

// L-2, step 2: the verdicts of the guard that hold in a fixture (the probes of the ticket: G4, G6, U5, and G1).
const plant = (dir, repoPath) => {
  mkdirSync(path.join(dir, 'forge'), { recursive: true });
  writeFileSync(path.join(dir, 'forge', 'repo.json'), JSON.stringify({ repo: { path: repoPath } }));
};

test('L-2: G4a, G4b, G4c: a planted forge/repo.json is no wiki binding, and a push is denied', (t) => {
  const a = setup(t);
  plant(a.worktree, path.join(a.root, 'elsewhere'));
  assert.equal(run(a.worktree, 'git push')?.decision, 'deny', 'G4a: the file names another folder.');
  const b = setup(t);
  plant(b.worktree, b.app);
  assert.equal(run(b.worktree, 'git push')?.decision, 'deny', 'G4b: the file names the repository itself.');
  const c = setup(t);
  plant(c.app, path.join(c.root, 'elsewhere'));
  assert.equal(run(c.worktree, 'git push')?.decision, 'deny', 'G4c: the file is in the main checkout.');
});

test('L-2: resolve takes an own binding only in a Forge layout or with --wiki', (t) => {
  const s = setup(t);
  const elsewhere = path.join(s.root, 'elsewhere');
  mkdirSync(elsewhere);
  plant(s.worktree, elsewhere);
  const planted = resolve({ cwd: s.worktree, env });
  assert.equal(planted.wiki.path, path.join(s.root, 'app.forge', 'wiki'), 'The planted file is ignored.');
  assert.equal(planted.repo.path, s.app);
  const named = resolve({ cwd: s.worktree, wiki: s.worktree, env });
  assert.equal(named.wiki.path, s.worktree, '--wiki names the folder, so its binding counts.');
  assert.equal(named.repo.path, elsewhere);
});

test('L-2: a push in a work tree that Forge cannot resolve is denied, and a wiki-mismatch keeps its own text', (t) => {
  const s = setup(t);
  git(s.app, 'remote', 'add', 'origin', 'https://example.test/a/app.git');
  mkdirSync(path.join(s.wiki, 'forge'), { recursive: true });
  writeFileSync(path.join(s.wiki, 'forge', 'repo.json'), JSON.stringify({ repo: { path: s.app, remote: 'https://example.test/other/app' } }));
  const verdict = run(s.worktree, 'git push');
  assert.equal(verdict?.decision, 'deny');
  assert.match(verdict.reason, /belongs to https:\/\/example\.test\/other\/app/, 'The error of resolve is the text.');
  assert.equal(run(s.worktree, 'git status'), null, 'Only a push is stopped.');
  // A folder that is not a Git work tree gets no verdict.
  assert.equal(run(s.root, 'git push'), null);
});

/** A repository where Shippable? is approved with one `target: change` draft, and the config is trusted. `draft` is the absolute path of the draft. */
function readyToOpen(t, profile) {
  const s = setup(t, { approved: ['Planned?', 'Shippable?'] });
  if (profile) {
    const where = resolve({ cwd: s.app, env });
    const { configDir } = seed(where, templates, { profile, force: true });
    setValues(configDir, ['repo.baseBranch=main']);
    approve(where, trustStatus(where, { env }).files.filter((f) => f.rel.startsWith('config/')).map((f) => `${f.rel}=${f.sha.slice(0, 12)}`), { env });
  } else trustConfig(s);
  approveDrafts(s, { 'pr.draft.md': 'change' });
  return { ...s, draft: path.join(s.dir, 'outbox', 'pr.draft.md'), body: path.join(s.root, 'send-body.md') };
}

test('L-2: G6a, G6b, G6c, G6d: a new change request is no question only when its body option names a file with the send text of the approved draft', (t) => {
  const s = readyToOpen(t);
  const open = (body) => run(s.worktree, `gh pr create -R a/b -t "APP-7 T" ${body}`);
  assert.equal(open('-b "other text"')?.decision, 'ask', 'G6a: another body, inline.');
  assert.equal(open('--body-file /tmp/other.md')?.decision, 'ask', 'G6b: another file.');
  assert.equal(open(`-F ${s.body}`), null, 'G6c: a file with the send text, by its absolute path.');
  assert.equal(open('--fill')?.decision, 'ask', 'G6d: no body option.');
  assert.equal(open(`--body-file ${s.body}`), null);
  assert.equal(open(`--body-file=${s.body}`), null);
  assert.equal(open(`-F${s.body}`), null);
  assert.equal(open(`-F "$(cat ${s.body})"`), null, 'The form $(cat <path>) of the file.');
  assert.equal(open(`-F ${s.draft}`)?.decision, 'ask', 'The approved draft file itself holds the frontmatter: no match.');
  assert.equal(open(`-F ${s.body} -b "other text"`)?.decision, 'ask', 'One more body option that is not the file.');
  assert.equal(open(`-F ${s.body} -F ${s.body}`)?.decision, 'ask', 'Two body options.');
  assert.equal(open(`-F ${s.body} --body-file ${s.body}`)?.decision, 'ask', 'Two body options.');
  assert.equal(open('-F -')?.decision, 'ask', 'A body from stdin.');
  assert.equal(open(`-F ${s.body}.other`)?.decision, 'ask', 'A file that cannot be read.');
  assert.equal(open(`-F "$(cat ${s.body}; echo more)"`)?.decision, 'ask');
  assert.equal(open('')?.decision, 'ask', 'No body option at all.');
  assert.equal(open(`-F ${s.root}`)?.decision, 'ask', 'A folder is no regular file.');
  // A relative path resolves from the folder of the command, and a link to the file counts as the file (a real path compare).
  assert.equal(run(s.worktree, 'gh pr create -R a/b -t T -F send-body.md')?.decision, 'ask', 'The worktree has no such file.');
  assert.equal(run(s.worktree, `cd ${s.root} && gh pr create -R a/b -t T -F send-body.md`), null);
  const link = path.join(s.root, 'link.md');
  symlinkSync(s.body, link);
  assert.equal(open(`-F ${link}`), null);
  assert.equal(preTool({ cwd: s.worktree, command: `gh pr create -R a/b -t T -F ${s.body}`, mode: 'bypassPermissions' }, { env }), null, 'No verdict, also with no prompt.');
  // The content is compared: the line ends and the blank lines at the ends do not count, any other change does.
  writeFileSync(s.body, `\r\n${SEND_TEXT.replace(/\n/g, '\r\n')}\r\n\r\n`);
  assert.equal(open(`-F ${s.body}`), null, 'CRLF and blank lines at the ends.');
  writeFileSync(s.body, `${SEND_TEXT}Extra line\n`);
  assert.equal(open(`-F ${s.body}`)?.decision, 'ask', 'One more line.');
  writeFileSync(s.body, SEND_TEXT.replace('goes out', 'goes out now'));
  assert.equal(open(`-F ${s.body}`)?.decision, 'ask', 'Another word.');
  writeFileSync(s.body, 'x'.repeat(300 * 1024));
  assert.equal(open(`-F ${s.body}`)?.decision, 'ask', 'A file over the size cap.');
});

test('L-2 review M4: a body option of the profile list next to the send text gives the ask', (t) => {
  const s = readyToOpen(t);
  const open = (body) => run(s.worktree, `gh pr create -R a/b -t "APP-7 T" ${body}`);
  for (const other of ['--recover x', '--recover=x', '-e', '--editor', '-w', '--fill', '--fill-first', '--fill-verbose', '-T x', '--template x', '--body x', '-b x']) {
    assert.equal(open(`-F ${s.body} ${other}`)?.decision, 'ask', other);
  }
  const forgejo = readyToOpen(t, 'forgejo');
  const tea = (body) => run(forgejo.worktree, `tea pulls create --base main --head users/a/APP-7-doc-import --title "APP-7 T" ${body}`);
  assert.equal(tea(`--description "$(cat ${forgejo.body})" -d other`)?.decision, 'ask');
  assert.equal(tea(`--description "$(cat ${forgejo.body})" -dother`)?.decision, 'ask');
});

test('L-2: the shipped Forgejo repo.open-change command with the send text gets no question, and another body asks', (t) => {
  const s = readyToOpen(t, 'forgejo');
  const open = (body) => run(s.worktree, `tea pulls create --base main --head users/a/APP-7-doc-import --title "APP-7 T" ${body}`);
  assert.equal(open(`--description "$(cat ${s.body})"`), null);
  assert.equal(open(`--description ${s.body}`), null);
  assert.equal(open(`--description "$(cat ${s.draft})"`)?.decision, 'ask', 'The draft file itself is no match.');
  assert.equal(open('--description "other text"')?.decision, 'ask');
  assert.equal(open(`--description "$(cat /tmp/other.md)"`)?.decision, 'ask');
  assert.equal(open('')?.decision, 'ask');
});

test('L-2: U5a, U5b: an untrusted config still gives the write ask of the shipped profile', (t) => {
  const s = setup(t);
  assert.equal(run(s.worktree, 'gh issue comment 7 --body x')?.decision, 'ask', 'U5a');
  assert.equal(run(s.worktree, 'gh pr comment 7 --body x')?.decision, 'ask', 'U5b');
  assert.equal(run(s.worktree, 'gh issue view 7'), null, 'A read gets no verdict.');
  // The untrusted wiki text adds commands to the union.
  const where = resolve({ cwd: s.app, env });
  const { configDir } = seed(where, templates);
  writeFileSync(path.join(configDir, 'tracker.md'), readFileSync(path.join(configDir, 'tracker.md'), 'utf8').replace('gh issue comment', 'zz issue comment'));
  assert.equal(run(s.worktree, 'zz issue comment 7 --body x')?.decision, 'ask');
  assert.equal(run(s.worktree, 'gh issue comment 7 --body x')?.decision, 'ask', 'The shipped command stays.');
});

test('L-2: guardActions gives the action kind never, with its verdict, before a write', () => {
  const never = [{ words: ['gh', 'pr', 'merge'], verdict: 'deny' }, { words: ['gh', 'pr', 'review'], with: ['--approve', '-a'], verdict: 'deny' }, { words: ['tea', ['pulls', 'pr'], ['merge', 'm']], verdict: 'deny' }];
  const kinds = (line) => guardActions(line, '/x', { never }).map((a) => [a.kind, a.verdict]);
  assert.deepEqual(kinds('gh pr merge 5 --squash'), [['never', 'deny']]);
  assert.deepEqual(kinds('timeout 5 gh pr -R a/b merge 5'), [['never', 'deny']]);
  assert.deepEqual(kinds('gh pr review 5 --approve'), [['never', 'deny']]);
  assert.deepEqual(kinds('gh pr review 5 --comment'), []);
  assert.deepEqual(kinds('tea pr m 5'), [['never', 'deny']]);
  assert.deepEqual(kinds('gh pr merge --help'), []);
  assert.deepEqual(kinds('gh pr view 5'), []);
});

test('L-2 review H1: a with option also matches the form with a value and a letter in a short cluster', () => {
  const never = [{ words: ['gh', 'pr', 'review'], with: ['--approve', '-a'], verdict: 'deny' }];
  const kinds = (line) => guardActions(line, '/x', { never }).map((a) => a.kind);
  for (const line of ['gh pr review 5 -a', 'gh pr review 5 -ab x', 'gh pr review 5 -ba x', 'gh pr review 5 -ab=x', 'gh pr review 5 --approve=true', 'gh pr review 5 -b x --approve']) assert.deepEqual(kinds(line), ['never'], line);
  for (const line of ['gh pr review 5 --comment -b x', 'gh pr review 5 -b x', 'gh pr review 5 --body x', 'gh pr review 5 --approved-by x', 'gh pr review 5 --comment']) assert.deepEqual(kinds(line), [], line);
});

test('L-2 review M5: the Forgejo never list denies tea pulls reject', (t) => {
  const s = setup(t);
  trustConfig(s);
  for (const command of ['tea pulls reject 5 "no"', 'tea pr reject 5 x', 'tea pull reject 5 x']) assert.equal(run(s.worktree, command)?.decision, 'deny', command);
});

test('L-2: the never words: merge and approve are denied, close asks, in a ticket folder, with gateGuard off, and after a cd', (t) => {
  const s = setup(t);
  trustConfig(s);
  for (const command of ['gh pr merge 5 --squash', 'gh pr review 5 --approve', 'gh pr review 5 -a', 'gh pr -R a/b merge 5', 'timeout 5 gh pr merge 5', 'if true; then gh pr merge 5; fi']) {
    const verdict = run(s.worktree, command);
    assert.equal(verdict?.decision, 'deny', command);
    assert.match(verdict.reason, /web page/, 'The reason says that the user does it in the web page.');
  }
  for (const command of ['tea pulls merge 5', 'tea pull m 5', 'tea pr merge 5', 'tea pulls approve 5', 'tea pr lgtm 5', 'tea pull a 5']) {
    assert.equal(run(s.worktree, command)?.decision, 'deny', command);
  }
  assert.equal(run(s.worktree, 'gh pr close 5')?.decision, 'ask');
  assert.equal(run(s.worktree, 'tea pulls close 5')?.decision, 'ask');
  assert.equal(preTool({ cwd: s.worktree, command: 'gh pr close 5', mode: 'bypassPermissions' }, { env })?.decision, 'deny', 'No prompt: the ask is a deny.');
  for (const command of ['gh pr view 5', 'gh pr review 5 --comment', 'gh pr list', 'tea pulls list', 'gh pr merge --help']) assert.equal(run(s.worktree, command), null, command);
  assert.equal(run(s.worktree, 'cd / && gh pr merge 5')?.decision, 'deny', 'A cd out of the ticket folder does not help.');
  assert.equal(run(s.app, 'gh pr merge 5'), null, 'The main checkout is no ticket folder.');
  // A wiki that names another profile or an unknown one does not remove the list.
  for (const profile of ['forgejo', 'nope']) {
    const named = setup(t);
    trustConfig(named);
    writeFileSync(path.join(named.wiki, 'forge', 'repo.json'), JSON.stringify({ repo: { path: named.app }, profile }));
    assert.equal(run(named.worktree, 'gh pr merge 5')?.decision, 'deny', profile);
  }
  // The verdict holds with gateGuard off, and with an untrusted config.
  const off = setup(t);
  trustConfig(off, ['policy.gateGuard=off']);
  assert.equal(run(off.worktree, 'git push'), null, 'The guard is off for a push.');
  assert.equal(run(off.worktree, 'gh pr merge 5')?.decision, 'deny');
  const untrusted = setup(t);
  assert.equal(run(untrusted.worktree, 'gh pr merge 5')?.decision, 'deny');
});
test('L-2: G1b, G1c: a gateGuard value that is not re-trusted keeps the push denied, and trust approve asks', (t) => {
  const s = setup(t);
  trustConfig(s);
  const where = resolve({ cwd: s.app, env });
  setValues(seed(where, templates).configDir, ['policy.gateGuard=off']);
  assert.equal(run(s.worktree, 'git push')?.decision, 'deny', 'G1b');
  assert.equal(run(s.worktree, `node ${cli} trust approve config/policy.md=abcdef123456`)?.decision, 'ask', 'G1c');
});
