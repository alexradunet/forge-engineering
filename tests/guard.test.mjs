import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { hookArgs } from '../plugins/forge/scripts/forge.mjs';

// The gate guard is the preToolUse hook: a push or a new change request in a ticket worktree
// needs the gates of checkAction('ship'). All other commands, folders, and failures let the tool run.
const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const templates = path.join(path.dirname(path.dirname(cli)), 'templates', 'config');
const repoTemplate = readFileSync(path.join(templates, 'repo.md'), 'utf8');
const env = { ...process.env, FORGE_WIKI_ROOT: '', FORGE_DATA_DIR: mkdtempSync(path.join(os.tmpdir(), 'forge-guard-data-')) };
const GATES = [['Planned?', ['story.md', 'plan.md']], ['Shippable?', ['review.md']]];

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** A repository with a ticket worktree, and a wiki with one full-v4 ticket. `approved` lists the approved gates. */
function setup(t, { approved = [], workflow = 'full-v4' } = {}) {
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
  const dir = path.join(root, 'app.forge', 'raw', 'tickets', 'app-7');
  mkdirSync(path.join(dir, 'approvals'), { recursive: true });
  mkdirSync(path.join(root, 'app.forge', 'wiki'), { recursive: true });
  const gates = [];
  for (const [name, docs] of GATES) {
    const doc = docs.at(-1);
    for (const item of docs) writeFileSync(path.join(dir, item), `# ${item}\n\nText of ${name}\n`);
    if (!approved.includes(name)) { gates.push(`  - { name: ${name}, doc: ${doc}, need: required, status: todo }`); continue; }
    const manifest = `approvals/${name.replace('?', '').toLowerCase()}-001.json`;
    const bytes = JSON.stringify({ version: 1, gate: name, documents: docs.map((item) => ({ path: item, sha256: sha256(readFileSync(path.join(dir, item))) })) });
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
  return { root, app, worktree, dir, readme, wiki: path.join(root, 'app.forge', 'wiki') };
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

test('writeCommands reads the commands of the 7 write capabilities, also from the Notes cell', () => {
  const texts = Object.fromEntries(['tracker', 'repo', 'ci'].map((kind) => [kind, readFileSync(path.join(templates, `${kind}.md`), 'utf8')]));
  const found = writeCommands(texts).map(({ capability, words, method }) => `${capability}: ${words.join(' ')}${method ? ` (${method})` : ''}`);
  assert.deepEqual(found, [
    'tracker.comment: gh issue comment',
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
  assert.deepEqual(shipActions('git -C ../wt push', base, []), [{ kind: 'push', cwd: path.resolve(base, '../wt'), refs: [], all: false }]);
  assert.deepEqual(shipActions('cd sub/dir && git push; cd .. && gh pr create', base, changes), [
    { kind: 'push', cwd: path.resolve(base, 'sub/dir'), refs: [], all: false }, { kind: 'change', cwd: path.resolve(base, 'sub') },
  ]);
  // A push names its branches: the first plain word is the remote, and each other word is a refspec.
  const targets = (line) => shipActions(line, base, []).map(({ refs, all }) => ({ refs, all }));
  assert.deepEqual(targets('git push -u origin users/a/APP-7 +fix:refs/heads/other refs/heads/x'), [{ refs: ['users/a/APP-7', 'fix', 'x'], all: false }]);
  assert.deepEqual(targets('git push origin :old -o ci.skip HEAD'), [{ refs: ['HEAD'], all: false }]);
  assert.deepEqual(targets('git push --all origin'), [{ refs: [], all: true }]);
  assert.deepEqual(targets('git push --mirror'), [{ refs: [], all: true }]);
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
  assert.equal(run(s.worktree, 'gh pr create -t T'), null, 'Without a trusted config, only git push is a ship action.');
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
  assert.equal(run(plain.worktree, comment), null, 'Without a trusted config there is no write command.');
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

/** Puts outbox drafts (name: target) into the Shippable? manifest, and records the new manifest hash in the README. */
function approveDrafts(s, drafts, { listed = Object.keys(drafts) } = {}) {
  mkdirSync(path.join(s.dir, 'outbox'), { recursive: true });
  for (const [name, target] of Object.entries(drafts)) writeFileSync(path.join(s.dir, 'outbox', name), `---\nstatus: draft\ntarget: ${target}\n---\n# Title\n\nText\n`);
  const documents = ['review.md', ...listed.map((name) => `outbox/${name}`)].map((doc) => ({ path: doc, sha256: sha256(readFileSync(path.join(s.dir, ...doc.split('/')))) }));
  const bytes = JSON.stringify({ version: 1, gate: 'Shippable?', documents });
  writeFileSync(path.join(s.dir, 'approvals', 'shippable-001.json'), bytes);
  writeFileSync(s.readme, readFileSync(s.readme, 'utf8').replace(/(name: Shippable\?.*hash: )[a-f0-9]{64}/, `$1${sha256(bytes)}`));
}

test('the approval of the Shippable? set that holds the one change draft is the yes for a new change request', (t) => {
  const create = 'gh pr create -R a/b -t "APP-7 T" -F outbox/pr.draft.md';
  const ready = () => {
    const s = setup(t, { approved: ['Planned?', 'Shippable?'] });
    trustConfig(s);
    return s;
  };
  const s = ready();
  approveDrafts(s, { 'pr.draft.md': 'change' });
  assert.equal(run(s.worktree, create), null);
  assert.equal(preTool({ cwd: s.worktree, command: create, mode: 'bypassPermissions' }, { env }), null, 'No verdict, also with no prompt.');
  assert.equal(run(s.worktree, 'git push -u origin users/a/APP-7-doc-import'), null);
  for (const command of ['gh issue comment 7 -R a/b -F b.md', 'gh issue close 7', 'gh workflow run ci.yml', 'gh api -X POST repos/a/b/pulls/1/comments/2/replies -F body=@b.md']) {
    assert.equal(run(s.worktree, command).decision, 'ask', `Another write keeps its ask: ${command}`);
  }
  // The draft changes after the approval: the gate is stale.
  writeFileSync(path.join(s.dir, 'outbox', 'pr.draft.md'), '---\nstatus: draft\ntarget: change\n---\n# Title\n\nOther text\n');
  assert.equal(run(s.worktree, create).decision, 'deny');
  // A draft that is not in the manifest is no approval.
  const none = ready();
  assert.equal(run(none.worktree, create).decision, 'ask');
  assert.equal(preTool({ cwd: none.worktree, command: create, mode: 'bypassPermissions' }, { env }).decision, 'deny');
  const unlisted = ready();
  approveDrafts(unlisted, { 'pr.draft.md': 'change' }, { listed: [] });
  assert.equal(run(unlisted.worktree, create).decision, 'ask');
  // Two change drafts, a draft of another target, and an existing change request all keep the ask.
  const two = ready();
  approveDrafts(two, { 'pr.draft.md': 'change', 'pr-2.draft.md': 'change' });
  assert.equal(run(two.worktree, create).decision, 'ask');
  const other = ready();
  approveDrafts(other, { 'item-comment.draft.md': 'tracker-comment' });
  assert.equal(run(other.worktree, create).decision, 'ask');
  const open = ready();
  approveDrafts(open, { 'pr.draft.md': 'change' });
  writeFileSync(open.readme, readFileSync(open.readme, 'utf8').replace('changes: []', 'changes:\n  - { url: "https://github.com/a/b/pull/9", state: open }'));
  assert.equal(run(open.worktree, create).decision, 'ask');
  writeFileSync(open.readme, readFileSync(open.readme, 'utf8').replace('state: open }', 'state: merged }'));
  assert.equal(run(open.worktree, create), null, 'A merged change request does not count.');
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
