import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';
import { checkAction, checkGate, classifySource, FULL_GATES, lint, sha256, validateTicket } from '../plugins/forge/scripts/lib/validation.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const wiki = mkdtempSync(path.join(os.tmpdir(), 'forge-validation-'));
  t.after(() => rmSync(wiki, { recursive: true, force: true }));
  const dir = path.join(wiki, 'raw', 'tickets', 'synthetic');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(wiki, 'index.md'), '---\ntitle: Index\ntype: index\n---\n# Index\n');
  const put = (name, bytes) => {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return file;
  };
  return { wiki, dir, file: path.join(dir, 'README.md'), put };
}
function source({ workflow = 'full-v1', track, phase = 'start', state = 'active', gates } = {}) {
  return `---\ntype: ticket\nkey: SYN-1\ntitle: Synthetic ticket\nphase: ${phase}\nstate: ${state}\nnext: Review evidence\n${workflow ? `workflow: ${workflow}\n` : ''}${track ? `track: ${track}\n` : ''}gates: ${JSON.stringify(gates ?? FULL_GATES.map((name) => ({ name, need: 'required', status: 'todo' })))}\n---\n# Synthetic\n`;
}
// The parser intentionally supports YAML, not JSON object keys.
function yamlTicket(options) {
  const text = source(options);
  return text.replace(/"(\w+)":/g, '$1: ');
}
function record(f, name, documents, extra = {}) {
  const manifest = `approvals\\${name.replace('?', '').toLowerCase()}.json`;
  const bytes = JSON.stringify({ version: 1, gate: name, documents: documents.map((doc) => ({ path: doc, sha256: sha256(readFileSync(path.join(f.dir, doc))) })), ...extra });
  f.put(manifest, bytes);
  return { name, need: 'required', status: 'approved', date: '2026-10-29', manifest, hash: sha256(bytes) };
}
const codes = (findings) => findings.map((item) => item.code);

test('full-v1 is explicit and never inferred from an absent track', () => {
  assert.equal(parseTicket(yamlTicket()).workflow, 'full-v1');
  assert.equal(parseTicket(yamlTicket()).track, null);
  for (const track of [undefined, 'S', 'M', 'L']) {
    const parsed = parseTicket(yamlTicket({ workflow: null, track }));
    assert.equal(parsed.workflow, null);
    assert.equal(parsed.track, track ?? 'Unspecified');
  }
  assert.throws(() => parseTicket(yamlTicket({ workflow: 'full-v2' })), /Unknown ticket workflow/);
  assert.throws(() => parseTicket(yamlTicket({ track: 'S' })), /must not select a track/);
});

test('full workflow rejects skipped diagnosis and blocks planning until explicit approval', (t) => {
  const f = fixture(t);
  const gates = FULL_GATES.map((name) => ({ name, need: 'required', status: name === 'Diagnosed?' ? 'skipped' : 'todo' }));
  const ticket = parseTicket(yamlTicket({ phase: 'plan', gates }));
  const findings = validateTicket(ticket, f.file);
  assert.ok(codes(findings).includes('workflow-gate'));
  assert.ok(findings.some((item) => item.code === 'phase-before-approval' && item.message.includes('Diagnosed?')));
  assert.equal(checkAction(ticket, f.file, 'plan').allowed, false);
  assert.equal(checkGate(ticket, f.file, 'Diagnosed?').allowed, false);
});

test('combined approval covers every listed revision with one user record', (t) => {
  const f = fixture(t);
  f.put('context.md', 'Context\n');
  f.put('evidence\\history.md', 'History\n');
  const gate = record(f, 'Understood?', ['context.md', 'evidence\\history.md']);
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
  f.put('context.md', 'Context\n');
  const good = record(f, 'Understood?', ['context.md']);
  const check = (gate) => checkGate(parseTicket(yamlTicket({ gates: [gate] })), f.file, 'Understood?');
  assert.equal(check({ ...good, hash: '0'.repeat(64) }).allowed, false);
  for (const documents of [
    [{ path: 'other.md', sha256: '0'.repeat(64) }],
    [{ path: '..\\outside.md', sha256: '0'.repeat(64) }],
    [{ path: 'README.md', sha256: '0'.repeat(64) }],
    [{ path: 'context.md', sha256: '0'.repeat(64) }, { path: 'CONTEXT.md', sha256: '0'.repeat(64) }],
  ]) {
    const bytes = JSON.stringify({ version: 1, gate: good.name, documents });
    f.put(good.manifest, bytes);
    assert.equal(check({ ...good, hash: sha256(bytes) }).allowed, false);
  }
  const missing = { ...good, manifest: 'approvals\\missing.json' };
  assert.ok(codes(check(missing).findings).includes('approval-manifest'));
});

test('approved plan is byte-equivalent to the reviewed draft and cannot drift', (t) => {
  const f = fixture(t);
  f.put('plan.draft.md', 'Plan\r\n');
  f.put('plan.md', 'Plan\r\n');
  const gate = record(f, 'Designed?', ['plan.draft.md'], { approvedCopies: [{ from: 'plan.draft.md', to: 'plan.md' }] });
  const ticket = parseTicket(yamlTicket({ gates: [gate] }));
  assert.equal(checkGate(ticket, f.file, gate.name).allowed, true);
  f.put('plan.md', 'Plan\n');
  assert.ok(codes(checkGate(ticket, f.file, gate.name).findings).includes('stale-approved-copy'));
});

test('legacy single-document approvals remain valid; unverifiable combined Briefed records block only affected work', (t) => {
  const f = fixture(t);
  f.put('investigation.md', 'Evidence\n');
  f.put('context.md', 'Context\n');
  f.put('interview.md', 'Interview\n');
  const diagnosis = { name: 'Diagnosed?', doc: 'investigation.md', need: 'recommended', status: 'approved', date: '2026-10-29', hash: sha256('Evidence\n') };
  for (const track of [undefined, 'S', 'M', 'L']) {
    const ticket = parseTicket(yamlTicket({ workflow: null, track, gates: [diagnosis] }));
    assert.equal(checkGate(ticket, f.file, 'Diagnosed?').allowed, true);
    assert.deepEqual(validateTicket(ticket, f.file), []);
  }
  const briefed = { name: 'Briefed?', doc: 'context.md', need: 'required', status: 'approved', date: '2026-10-29', hash: sha256('Context\n') };
  let ticket = parseTicket(yamlTicket({ workflow: null, track: 'M', gates: [briefed] }));
  assert.ok(codes(validateTicket(ticket, f.file)).includes('approval-evidence'));
  assert.equal(checkAction(ticket, f.file, 'plan').allowed, false);
  assert.equal(checkGate(ticket, f.file, 'Briefed?').allowed, false);
  const combined = record(f, 'Briefed?', ['context.md', 'interview.md']);
  ticket = parseTicket(yamlTicket({ workflow: null, track: 'M', gates: [combined] }));
  assert.equal(checkGate(ticket, f.file, 'Briefed?').allowed, true);
  f.put('interview.md', 'Changed\n');
  assert.equal(checkGate(ticket, f.file, 'Briefed?').allowed, false);
});

test('legacy recorded recommended and original size skips do not acquire full-v1 gates', (t) => {
  const f = fixture(t);
  const gates = [{ name: 'Diagnosed?', need: 'recommended', status: 'skipped' }];
  const ticket = parseTicket(yamlTicket({ workflow: null, track: 'M', phase: 'plan', gates }));
  assert.deepEqual(validateTicket(ticket, f.file), []);
  assert.equal(checkGate(ticket, f.file, 'Diagnosed?').allowed, true);
  assert.equal(ticket.workflow, null);
});

test('original S skips, M combined briefing, L optional diagnosis and trackless records remain unchanged', (t) => {
  const f = fixture(t);
  const skips = ['Understood?', 'Agreed?', 'Diagnosed?'].map((name) => ({ name, need: 'required', status: 'skipped' }));
  for (const track of ['S', 'M', undefined]) {
    const ticket = parseTicket(yamlTicket({ workflow: null, track, gates: skips }));
    assert.deepEqual(validateTicket(ticket, f.file), []);
    assert.equal(checkGate(ticket, f.file, 'Understood?').allowed, true);
    if (track === 'S') assert.equal(checkAction(ticket, f.file, 'plan').allowed, true);
    if (track === 'M') assert.equal(checkAction(ticket, f.file, 'plan').allowed, false, 'Missing original Briefed? evidence blocks only planning.');
  }
  const l = parseTicket(yamlTicket({ workflow: null, track: 'L', gates: [{ name: 'Diagnosed?', need: 'recommended', status: 'skipped' }] }));
  assert.deepEqual(validateTicket(l, f.file), []);
  assert.equal(checkGate(l, f.file, 'Diagnosed?').allowed, true);
});

test('per-write sidecars bind the exact command, target and draft without changing approved bytes', (t) => {
  const f = fixture(t);
  const draft = f.put('outbox\\comment.draft.md', '---\nstatus: draft\n---\nDraft');
  const gate = { ...record(f, 'Sendable?', ['outbox\\comment.draft.md'], { command: 'synthetic comment', target: 'synthetic item' }), doc: 'outbox\\comment.draft.md' };
  const ticket = parseTicket(yamlTicket({ workflow: null, gates: [gate] }));
  assert.equal(checkAction(ticket, f.file, 'write', { command: 'synthetic comment', target: 'synthetic item' }).allowed, true);
  assert.equal(checkAction(ticket, f.file, 'write', { command: 'synthetic comment', target: 'different' }).allowed, false);
  assert.equal(checkAction(ticket, f.file, 'write').allowed, false);
  const recordData = {
    version: 1, doc: gate.doc, status: 'sent', approval_manifest: gate.manifest,
    approval_hash: gate.hash, approval_date: gate.date, command: 'synthetic comment',
    target: 'synthetic item', result: 'synthetic result 1',
  };
  const sidecar = f.put('outbox\\comment.approval.json', JSON.stringify(recordData));
  assert.deepEqual(validateTicket(ticket, f.file), []);
  assert.equal(checkAction(ticket, f.file, 'write', { command: 'synthetic comment', target: 'synthetic item' }).allowed, false, 'A sent write consumes its approval.');
  f.put('README.md', yamlTicket({ workflow: null, gates: [] }));
  const before = readFileSync(draft);
  assert.equal(lint({ wikiPath: f.wiki, fix: true }).repairs.length, 0, 'Historical per-write approval still protects the draft.');
  assert.deepEqual(readFileSync(draft), before);
  writeFileSync(sidecar, JSON.stringify({ ...recordData, command: 'different command' }));
  assert.ok(codes(validateTicket(ticket, f.file)).includes('approval-manifest'));
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
  assert.throws(() => parseTicket(yamlTicket({ gates: [{ name: 'Designed?', need: 'required', status: 'approved', date: '2026-02-30' }] })), /needs a date/);
  const ticket = parseTicket(yamlTicket({ state: 'done', gates: [{ name: 'Designed?', need: 'required', status: 'in-review', doc: 'missing.md' }] }));
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
  f.put('investigation.md', 'Evidence\n');
  const unapproved = { name: 'Diagnosed?', need: 'required', status: 'todo', doc: 'investigation.md', note: 'user approved in a comment', hash: sha256('Evidence\n') };
  let ticket = parseTicket(yamlTicket({ gates: [unapproved] }));
  assert.equal(checkGate(ticket, f.file, 'Diagnosed?').allowed, false);
  const approved = record(f, 'Diagnosed?', ['investigation.md']);
  ticket = parseTicket(yamlTicket({ gates: [approved, unapproved] }));
  assert.equal(checkGate(ticket, f.file, 'Diagnosed?').allowed, false);
  assert.ok(codes(validateTicket(ticket, f.file)).includes('duplicate-gate'));
  f.put('README.md', yamlTicket({ gates: [unapproved] }));
  f.put('plan.draft.md', '---\nstatus: draft\n---\nPlan');
  const before = readFileSync(f.file);
  lint({ wikiPath: f.wiki, fix: true });
  assert.deepEqual(readFileSync(f.file), before);
  assert.equal(checkGate(parseTicket(before.toString('utf8')), f.file, 'Diagnosed?').allowed, false);
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
    if (mode === 'direct') gate = { name: 'Learned?', doc: 'close.draft.md', need: 'required', status: 'approved', date: '2026-10-29', hash: sha256(readFileSync(file)) };
    else if (mode === 'self-approved') { f.put('close.draft.md', '---\nstatus: approved\n---\nClose'); }
    else if (mode === 'conflicting-stamp') { f.put('close.draft.md', '---\nstatus: draft\napproved: 2026-10-29\n---\nClose'); }
    else {
      f.put('context.md', 'Context\n');
      gate = record(f, 'Understood?', ['context.md', 'close.draft.md']);
      if (mode === 'stale') gate.hash = '0'.repeat(64);
      if (mode === 'malformed') f.put(gate.manifest, '{broken');
    }
    f.put('README.md', yamlTicket({ workflow: null, gates: gate ? [gate] : [] }));
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
