import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';
import { checkAction, checkGate, classifySource, GATES, lint, sha256, validateTicket } from '../plugins/forge/scripts/lib/validation.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const wiki = mkdtempSync(path.join(os.tmpdir(), 'forge-validation-'));
  t.after(() => rmSync(wiki, { recursive: true, force: true }));
  const dir = path.join(wiki, 'raw', 'tickets', 'synthetic');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(wiki, 'index.md'), '---\ntitle: Index\ntype: index\n---\n# Index\n');
  const put = (name, bytes) => {
    const file = path.join(dir, ...name.split(/[\\/]/));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return file;
  };
  return { wiki, dir, file: path.join(dir, 'README.md'), put };
}
function source({ workflow = 'full-v4', track, phase = 'start', state = 'active', gates } = {}) {
  return `---\ntype: ticket\nkey: SYN-1\ntitle: Synthetic ticket\nphase: ${phase}\nstate: ${state}\nnext: Review evidence\n${workflow ? `workflow: ${workflow}\n` : ''}${track ? `track: ${track}\n` : ''}gates: ${JSON.stringify(gates ?? allGates())}\n---\n# Synthetic\n\n## Now\n\n- State: ${state}\n- Phase: ${phase}\n- Next: Review evidence\n`;
}
// The parser intentionally supports YAML, not JSON object keys.
function yamlTicket(options) {
  const text = source(options);
  return text.replace(/"(\w+)":/g, '$1: ');
}
function record(f, name, documents, extra = {}) {
  const manifest = `approvals\\${name.replace('?', '').toLowerCase()}.json`;
  const bytes = JSON.stringify({ version: 1, gate: name, documents: documents.map((doc) => ({ path: doc, sha256: sha256(readFileSync(path.join(f.dir, ...doc.split(/[\\/]/)))) })), ...extra });
  f.put(manifest, bytes);
  return { name, need: 'required', status: 'approved', date: '2026-10-29', manifest, hash: sha256(bytes) };
}
const allGates = () => GATES.map((name) => ({ name, need: 'required', status: 'todo' }));
const codes = (findings) => findings.map((item) => item.code);

test('full-v4 is the only workflow, it is never inferred, and full-v3 gets the Forge 10.1 hint', () => {
  assert.equal(parseTicket(yamlTicket()).workflow, 'full-v4');
  for (const workflow of [null, 'full-v1', 'full-v2', 'full-v9']) {
    assert.throws(() => parseTicket(yamlTicket({ workflow })), /^Error: Unsupported ticket workflow: .*Forge 12 reads only workflow: full-v4\.$/, String(workflow));
  }
  assert.throws(() => parseTicket(yamlTicket({ workflow: null })), /Unsupported ticket workflow: no workflow marker\./);
  assert.throws(() => parseTicket(yamlTicket({ workflow: 'full-v3' })), /^Error: Unsupported ticket workflow: full-v3\. Forge 12 reads only workflow: full-v4\. Finish this ticket with Forge 10\.1\.$/);
  assert.throws(() => parseTicket(yamlTicket({ track: 'S' })), /must not select a track/);
});

test('full-v4 has three review gates and blocks phases until their approvals', (t) => {
  const f = fixture(t);
  const ticket = parseTicket(yamlTicket({ phase: 'implement', gates: allGates() }));
  const findings = validateTicket(ticket, f.file);
  assert.deepEqual(findings.filter((item) => item.code === 'phase-before-approval').map((item) => item.message),
    ['implement precedes Planned? approval.']);
  assert.ok(!codes(findings).includes('workflow-gate'));
  assert.throws(() => checkAction(ticket, f.file, 'investigate'), /Unknown blocked action/, 'Scope is a question in chat: no gate blocks investigate or plan.');
  assert.deepEqual(checkAction(ticket, f.file, 'implement').findings.map((item) => item.message), ['Planned? is not approved.']);

  const skipped = parseTicket(yamlTicket({ gates: allGates().map((gate) => gate.name === 'Planned?' ? { ...gate, status: 'skipped' } : gate) }));
  assert.ok(validateTicket(skipped, f.file).some((item) => item.code === 'workflow-gate' && item.message === 'Planned? is mandatory for full-v4.'));
});

test('combined approval covers every listed revision with one user record', (t) => {
  const f = fixture(t);
  f.put('story.md', 'Story\n');
  f.put('plan.md', 'Plan\n');
  f.put('evidence\\history.md', 'History\n');
  const gate = record(f, 'Planned?', ['story.md', 'plan.md', 'evidence\\history.md']);
  const ticket = parseTicket(yamlTicket({ gates: [gate] }));
  assert.equal(checkGate(ticket, f.file, gate.name).allowed, true);
  f.put('evidence\\history.md', 'Changed history\n');
  const result = checkGate(ticket, f.file, gate.name);
  assert.equal(result.allowed, false);
  assert.deepEqual(codes(result.findings), ['stale-approval']);
  assert.equal(ticket.gates.length, 1);
});

test('manifest revision, exact document set, traversal, missing files and circular records are checked', (t) => {
  const f = fixture(t);
  f.put('story.md', 'Story\n');
  f.put('plan.md', 'Plan\n');
  const good = record(f, 'Planned?', ['story.md', 'plan.md']);
  const check = (gate) => checkGate(parseTicket(yamlTicket({ gates: [gate] })), f.file, 'Planned?');
  assert.equal(check(good).allowed, true);
  assert.equal(check({ ...good, hash: '0'.repeat(64) }).allowed, false);
  for (const documents of [
    [{ path: 'other.md', sha256: '0'.repeat(64) }],
    [{ path: '..\\outside.md', sha256: '0'.repeat(64) }],
    [{ path: 'README.md', sha256: '0'.repeat(64) }],
    [{ path: 'story.md', sha256: '0'.repeat(64) }, { path: 'STORY.md', sha256: '0'.repeat(64) }],
    [{ path: 'story.md', sha256: sha256(Buffer.from('Story\n')) }],
  ]) {
    const bytes = JSON.stringify({ version: 1, gate: good.name, documents });
    f.put(good.manifest, bytes);
    assert.equal(check({ ...good, hash: sha256(bytes) }).allowed, false);
  }
  const missing = { ...good, manifest: 'approvals\\missing.json' };
  assert.ok(codes(check(missing).findings).includes('approval-manifest'));
});


test('links and malformed draft metadata block repairs without touching external bytes', (t) => {
  const f = fixture(t);
  const outside = fixture(t);
  f.put('README.md', yamlTicket());
  const malformed = f.put('broken.draft.md', '---\nstatus: draft');
  const external = outside.put('outside.draft.md', '---\nstatus: draft\n---\nExternal');
  symlinkSync(outside.dir, path.join(f.dir, 'outbox'), process.platform === 'win32' ? 'junction' : 'dir');
  const before = readFileSync(external);
  const report = lint({ wikiPath: f.wiki, fix: true });
  assert.equal(report.repairs.length, 0);
  assert.ok(report.summary.errors > 0);
  assert.deepEqual(readFileSync(external), before);
  assert.equal(readFileSync(malformed, 'utf8'), '---\nstatus: draft');
});

test('calendar errors, missing gate documents and conflicting full states produce findings', (t) => {
  const f = fixture(t);
  assert.throws(() => parseTicket(yamlTicket({ gates: [{ name: 'Planned?', need: 'required', status: 'approved', date: '2026-02-30' }] })), /needs a date/);
  const ticket = parseTicket(yamlTicket({ state: 'done', gates: [{ name: 'Planned?', need: 'required', status: 'in-review', doc: 'missing.md' }] }));
  const findings = validateTicket(ticket, f.file);
  assert.ok(codes(findings).includes('gate-document'));
  assert.ok(codes(findings).includes('state-conflict'));
  assert.equal(checkAction(ticket, f.file, 'implement').allowed, false);
});
test('read-only lint keeps valid files visible beside invalid tickets and changes no bytes', (t) => {
  const f = fixture(t);
  f.put('README.md', yamlTicket());
  f.put('plan.draft.md', '---\nstatus: draft\n---\nPlan');
  const broken = path.join(f.wiki, 'raw', 'tickets', 'broken');
  mkdirSync(broken);
  writeFileSync(path.join(broken, 'README.md'), '# Invalid');
  const before = readFileSync(path.join(f.dir, 'plan.draft.md'));
  const report = lint({ wikiPath: f.wiki });
  assert.ok(codes(report.findings).includes('invalid-input'));
  assert.ok(codes(report.findings).includes('final-newline'));
  assert.deepEqual(readFileSync(path.join(f.dir, 'plan.draft.md')), before);
  assert.deepEqual(readdirSync(f.dir).sort(), ['README.md', 'plan.draft.md']);
});

test('comments, hashes and repairs cannot approve gates or resolve duplicate states', (t) => {
  const f = fixture(t);
  f.put('plan.md', 'Plan\n');
  const unapproved = { name: 'Planned?', need: 'required', status: 'todo', doc: 'plan.md', note: 'user approved in a comment', hash: sha256('Plan\n') };
  let ticket = parseTicket(yamlTicket({ gates: [unapproved] }));
  assert.equal(checkGate(ticket, f.file, 'Planned?').allowed, false);
  const approved = record(f, 'Planned?', ['plan.md']);
  ticket = parseTicket(yamlTicket({ gates: [approved, unapproved] }));
  assert.equal(checkGate(ticket, f.file, 'Planned?').allowed, false);
  assert.ok(codes(validateTicket(ticket, f.file)).includes('duplicate-gate'));
  f.put('README.md', yamlTicket({ gates: [unapproved] }));
  f.put('plan.draft.md', '---\nstatus: draft\n---\nPlan');
  const before = readFileSync(f.file);
  lint({ wikiPath: f.wiki, fix: true });
  assert.deepEqual(readFileSync(f.file), before);
  assert.equal(checkGate(parseTicket(before.toString('utf8')), f.file, 'Planned?').allowed, false);
});

test('explicit repair appends only the existing line ending, logs hashes and is idempotent', (t) => {
  for (const newline of ['\n', '\r\n']) {
    const f = fixture(t);
    f.put('README.md', yamlTicket());
    const before = Buffer.from(`---${newline}status: draft${newline}---${newline}Plan`);
    const file = f.put('plan.draft.md', before);
    const first = lint({ wikiPath: f.wiki, fix: true });
    assert.equal(first.repairs.length, 1);
    assert.deepEqual(readFileSync(file), Buffer.concat([before, Buffer.from(newline)]));
    const log = readFileSync(path.join(f.dir, 'repair-log.jsonl'), 'utf8');
    const rows = log.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map((row) => row.status), ['started', 'applied']);
    assert.equal(rows[1].before, sha256(before));
    assert.equal(rows[1].after, sha256(readFileSync(file)));
    assert.equal(lint({ wikiPath: f.wiki, fix: true }).repairs.length, 0);
    assert.equal(readFileSync(path.join(f.dir, 'repair-log.jsonl'), 'utf8'), log);
  }
});

test('repair fails explicitly before changing a draft when its log cannot accept a record', (t) => {
  const f = fixture(t);
  f.put('README.md', yamlTicket());
  const draft = f.put('plan.draft.md', '---\nstatus: draft\n---\nPlan');
  const log = f.put('repair-log.jsonl', '{"incomplete":');
  const before = readFileSync(draft);
  const report = lint({ wikiPath: f.wiki, fix: true });
  assert.equal(report.repairs.length, 0);
  assert.ok(report.findings.some((item) => item.code === 'invalid-input' && /Repair log/.test(item.message)));
  assert.deepEqual(readFileSync(draft), before);
  assert.equal(readFileSync(log, 'utf8'), '{"incomplete":');
});

test('repairs never change direct, combined, stale, malformed or self-declared approved revisions', (t) => {
  for (const mode of ['direct', 'combined', 'stale', 'malformed', 'self-approved', 'conflicting-stamp']) {
    const f = fixture(t);
    const file = f.put('close.draft.md', '---\nstatus: draft\n---\nClose');
    let gate;
    // direct: an approval without a manifest. It is a finding, so the draft stays protected.
    if (mode === 'direct') gate = { name: 'Learned?', doc: 'close.draft.md', need: 'required', status: 'approved', date: '2026-10-29', hash: sha256(readFileSync(file)) };
    else if (mode === 'self-approved') { f.put('close.draft.md', '---\nstatus: approved\n---\nClose'); }
    else if (mode === 'conflicting-stamp') { f.put('close.draft.md', '---\nstatus: draft\napproved: 2026-10-29\n---\nClose'); }
    else {
      f.put('close.md', 'Close\n');
      gate = record(f, 'Learned?', ['close.md', 'close.draft.md']);
      if (mode === 'stale') gate.hash = '0'.repeat(64);
      if (mode === 'malformed') f.put(gate.manifest, '{broken');
    }
    f.put('README.md', yamlTicket({ gates: gate ? [gate] : [] }));
    const before = readFileSync(file);
    const report = lint({ wikiPath: f.wiki, fix: true });
    assert.equal(report.repairs.length, 0, mode);
    assert.deepEqual(readFileSync(file), before, mode);
  }
});

test('wiki metadata and source types report uncertainty without asserting claim validity', (t) => {
  const f = fixture(t);
  const page = path.join(f.wiki, 'topic.md');
  writeFileSync(page, `---\ntitle: Shared summary\nstatus: needs-check\nupdated: 2020-01-01\nsources:\n  - https://example.test/doc\n  - archive/tickets/SYN-1/context.md\n  - repo:src/moved.mjs:4\n  - an unknown source\n---\nUseful summary independent of archives.\n`);
  const report = lint({ wikiPath: f.wiki, repoPath: f.wiki });
  assert.ok(codes(report.findings).includes('source-url'));
  assert.ok(codes(report.findings).includes('source-local-only'));
  assert.ok(codes(report.findings).includes('source-moved-path'));
  assert.ok(codes(report.findings).includes('source-unknown'));
  assert.ok(codes(report.findings).includes('wiki-needs-check'));
  assert.equal(classifySource('repo:src/file.mjs:2').kind, 'unresolved');
  assert.equal(classifySource('wiki:index.md', { wikiPath: f.wiki }).kind, 'path');
  assert.equal(classifySource('command:npm test').kind, 'non-path');
});

test('CLI human and JSON reports have stable fields and error exit status', (t) => {
  const f = fixture(t);
  f.put('README.md', yamlTicket());
  const args = [cli, 'lint', '--cwd', cwd, '--wiki', f.wiki];
  let result = spawnSync(process.execPath, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(report), ['version', 'wikiPath', 'findings', 'repairs', 'summary']);
  assert.equal(report.version, 1);
  assert.deepEqual(report.summary, { errors: 0, warnings: 0, repaired: 0 });
  writeFileSync(path.join(f.wiki, 'bad.md'), '---\ntitle: Incomplete\n');
  result = spawnSync(process.execPath, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const invalid = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(invalid.findings[0]), ['file', 'line', 'code', 'severity', 'message', 'remedy']);
  result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /error invalid-input.*bad\.md/);
  result = spawnSync(process.execPath, [...args, '--json', '--guess-state'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).findings[0].code, 'bad-args');
  result = spawnSync(process.execPath, [cli, 'lint', '--wiki', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).findings[0].code, 'bad-args');
});

test('full-v4 Planned? approves story.md and plan.md in one manifest, with no plan copy, and a change of either is stale', (t) => {
  const f = fixture(t);
  for (const name of ['story.md', 'plan.md', 'review.md', 'close.md', 'evidence/query.md']) f.put(name, `${name}\n`);
  const planned = record(f, 'Planned?', ['story.md', 'plan.md', 'evidence/query.md']);
  const gates = allGates().map((gate) => gate.name === 'Planned?' ? planned : gate);
  const ticket = parseTicket(yamlTicket({ phase: 'implement', gates }));
  assert.equal(ticket.workflow, 'full-v4');
  assert.deepEqual(validateTicket(ticket, f.file), []);
  assert.equal(checkAction(ticket, f.file, 'implement').allowed, true);
  assert.equal(checkAction(ticket, f.file, 'ship').allowed, false);

  f.put('plan.md', 'Changed plan\n');
  assert.deepEqual(codes(checkGate(ticket, f.file, 'Planned?').findings), ['stale-approval']);
  assert.equal(checkAction(ticket, f.file, 'implement').allowed, false);
  f.put('plan.md', 'plan.md\n');
  assert.equal(checkGate(ticket, f.file, 'Planned?').allowed, true);
  f.put('story.md', 'Changed story\n');
  assert.deepEqual(codes(checkGate(ticket, f.file, 'Planned?').findings), ['stale-approval']);
  assert.equal(checkAction(ticket, f.file, 'implement').allowed, false, 'A change of story.md after the approval makes Planned? stale.');
  f.put('story.md', 'story.md\n');
  const review = record(f, 'Shippable?', ['review.md']);
  f.put('plan.md', 'Changed plan\n');
  assert.equal(checkGate(parseTicket(yamlTicket({ gates: [planned, review] })), f.file, 'Shippable?').allowed, true, 'Only the gate of the changed document is stale.');
  f.put('plan.md', 'plan.md\n');

  f.put('plan.draft.md', 'plan.draft.md\n');
  const noPlan = record(f, 'Planned?', ['story.md', 'evidence/query.md']);
  assert.match(checkGate(parseTicket(yamlTicket({ gates: [noPlan] })), f.file, 'Planned?').findings[0].message, /omits plan\.md/);
  const noStory = record(f, 'Planned?', ['plan.md', 'evidence/query.md']);
  assert.match(checkGate(parseTicket(yamlTicket({ gates: [noStory] })), f.file, 'Planned?').findings[0].message, /omits story\.md/);
  const scoped = parseTicket(yamlTicket({ gates: [...allGates(), { name: 'Scoped?', doc: 'story.md', need: 'required', status: 'todo' }] }));
  assert.ok(validateTicket(scoped, f.file).some((item) => item.code === 'workflow-gate' && item.message === 'Scoped? does not belong to full-v4.'), 'A Scoped? record is a gate that does not belong to the workflow.');
  const copy = record(f, 'Planned?', ['story.md', 'plan.md', 'plan.draft.md'], { approvedCopies: [{ from: 'plan.draft.md', to: 'plan.md' }] });
  assert.match(checkGate(parseTicket(yamlTicket({ gates: [copy] })), f.file, 'Planned?').findings[0].message, /no approved copy/);
  const foreign = parseTicket(yamlTicket({ gates: [...allGates(), { name: 'Designed?', need: 'required', status: 'todo' }] }));
  assert.ok(validateTicket(foreign, f.file).some((item) => item.code === 'workflow-gate' && item.message === 'Designed? does not belong to full-v4.'));
});

test('a closed full-v4 ticket needs proof.md', (t) => {
  const f = fixture(t);
  for (const name of ['story.md', 'plan.md', 'review.md', 'close.md']) f.put(name, `${name}\n`);
  const docs = { 'Planned?': ['story.md', 'plan.md'], 'Shippable?': ['review.md'], 'Learned?': ['close.md'] };
  const gates = allGates().map((gate) => docs[gate.name] ? record(f, gate.name, docs[gate.name]) : gate);
  const ticket = parseTicket(yamlTicket({ phase: 'closed', state: 'done', gates }));
  assert.deepEqual(codes(validateTicket(ticket, f.file)), ['missing-evidence']);
  assert.match(validateTicket(ticket, f.file)[0].message, /proof\.md/);
  f.put('proof.md', 'Proof\n');
  assert.deepEqual(validateTicket(ticket, f.file), []);
});

test('lint checks the plan paths: a warning in the plan phase, an error in review, nothing after approval', (t) => {
  const f = fixture(t);
  f.put('plan.md', '# Plan\n\n## Steps\n\n1. Edit\n   - Files: [A.cs](/no/such/dir/A.cs)\n');
  const planFindings = (phase, status) => {
    const gates = allGates().map((gate) => (gate.name === 'Planned?' ? { ...gate, status, doc: 'plan.md' } : gate));
    f.put('README.md', yamlTicket({ phase, gates }));
    return lint({ wikiPath: f.wiki, repoPath: f.dir }).findings.filter((item) => item.code === 'plan-path');
  };
  const warn = planFindings('plan', 'todo');
  assert.deepEqual(warn.map((item) => item.severity), ['warning']);
  assert.equal(warn[0].line, 6);
  assert.equal(path.basename(warn[0].file), 'plan.md');
  assert.deepEqual(planFindings('plan', 'in-review').map((item) => item.severity), ['error']);
  assert.deepEqual(planFindings('implement', 'approved'), []);
  assert.deepEqual(planFindings('start', 'todo'), []);
});

test('lint checks the proof: a warning in phase review, an error while Shippable? is in review, nothing after approval or with a deployed proof', (t) => {
  const f = fixture(t);
  f.put('review.md', '# Review\n');
  const proofFindings = (phase, status, policy = { evidenceOnDeployedEnv: false }) => {
    const gates = allGates().map((gate) => (gate.name === 'Shippable?' ? { ...gate, status, doc: 'review.md' } : gate));
    f.put('README.md', yamlTicket({ phase, gates }));
    return lint({ wikiPath: f.wiki, repoPath: f.dir, policy }).findings.filter((item) => item.code.startsWith('proof-'));
  };
  rmSync(path.join(f.dir, 'proof.md'), { force: true });
  const warn = proofFindings('review', 'todo');
  assert.deepEqual(warn.map((item) => [item.code, item.severity]), [['proof-missing', 'warning']]);
  assert.deepEqual(proofFindings('review', 'in-review').map((item) => item.severity), ['error']);
  assert.deepEqual(proofFindings('review', 'approved'), []);
  assert.deepEqual(proofFindings('implement', 'todo'), []);
  assert.deepEqual(proofFindings('review', 'in-review', { evidenceOnDeployedEnv: true }), []);
  f.put('proof.md', '# Proof\n\n## Checks\n\n1. 🔴 failed: a\n');
  assert.deepEqual(proofFindings('review', 'in-review').map((item) => [item.code, item.severity, item.line]), [['proof-failed', 'error', 5]]);
  f.put('evidence/a.md', 'x\n');
  f.put('proof.md', '# Proof\n\n## Checks\n\n1. 🟢 verified: a\n   - [e](evidence/a.md)\n');
  assert.deepEqual(proofFindings('review', 'in-review'), []);
});

test('lint reports a full-v3 README as a read error of that ticket and still checks the other tickets', (t) => {
  const f = fixture(t);
  f.put('README.md', yamlTicket({ workflow: 'full-v3' }));
  const other = path.join(f.wiki, 'raw', 'tickets', 'other');
  mkdirSync(other, { recursive: true });
  writeFileSync(path.join(other, 'README.md'), yamlTicket({ phase: 'implement' }).replace('key: SYN-1', 'key: SYN-2'));
  const { findings } = lint({ wikiPath: f.wiki, repoPath: f.dir });
  const read = findings.filter((item) => item.code === 'invalid-input');
  assert.equal(read.length, 1);
  assert.equal(read[0].severity, 'error');
  assert.equal(path.basename(path.dirname(read[0].file)), 'synthetic');
  assert.match(read[0].message, /Unsupported ticket workflow: full-v3\. Forge 12 reads only workflow: full-v4\. Finish this ticket with Forge 10\.1\./);
  const checked = findings.filter((item) => item.code === 'phase-before-approval');
  assert.deepEqual(checked.map((item) => path.basename(path.dirname(item.file))), ['other']);
});

test('lint reports a Scoped? record in a full-v4 ticket as an error', (t) => {
  const f = fixture(t);
  f.put('story.md', 'Story\n');
  f.put('README.md', yamlTicket({ gates: [...allGates(), { name: 'Scoped?', doc: 'story.md', need: 'required', status: 'todo' }] }));
  const { findings } = lint({ wikiPath: f.wiki, repoPath: f.dir });
  const foreign = findings.filter((item) => item.code === 'workflow-gate');
  assert.deepEqual(foreign.map((item) => [item.severity, item.message]), [['error', 'Scoped? does not belong to full-v4.']]);
});
