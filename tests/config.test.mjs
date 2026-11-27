import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig, parseFile, parseScalar, parseTable, loadConfig, KINDS } from '../plugins/forge/scripts/lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const templates = path.join(here, '..', 'plugins', 'forge', 'templates', 'config');

test('parseScalar reads the flat YAML subset', () => {
  assert.equal(parseScalar(' null '), null);
  assert.equal(parseScalar('"a: b"'), 'a: b');
  assert.equal(parseScalar('true'), true);
  assert.equal(parseScalar('42'), 42);
  assert.deepEqual(parseScalar('[Thursday, Friday]'), ['Thursday', 'Friday']);
  assert.deepEqual(parseScalar('[]'), []);
  assert.equal(parseScalar('https://x/{KEY}'), 'https://x/{KEY}');
});

test('parseFile rejects nested frontmatter', () => {
  assert.throws(() => parseFile('---\na:\n  b: 1\n---\n'), /flat keys only/);
});

test('parseFile rejects opened, incomplete frontmatter with a named config error', () => {
  for (const text of ['---', '---\n', '---\nprovider: github\n', '\uFEFF---\r\nprovider: github\r\n']) {
    assert.throws(() => parseFile(text, 'tracker.md'), (e) => e.code === 'bad-config' && /tracker\.md.*frontmatter/i.test(e.message));
  }
});

test('parseFile preserves body-only content and accepts empty and complete headers', () => {
  for (const body of ['', '# Config\n\n---\nText\n', '# Config\n---\nprovider: github\n---\n', '--- not a delimiter\n']) {
    assert.deepEqual(parseFile(body), { data: {}, body });
  }
  assert.deepEqual(parseFile('---\n---\nBody\n'), { data: {}, body: 'Body\n' });
  assert.deepEqual(parseFile('\uFEFF---\r\nprovider: github\r\n---'), { data: { provider: 'github' }, body: '' });
});

test('parseTable reads the table under a heading, with escaped pipes and code cells', () => {
  const body = '# T\n\n## 🔎 Queries\n\nText.\n\n| Name | Query |\n|---|---|\n| `mine` | `a \\| b` |\n| team | x |\n\n## Other\n| Name | Query |\n|---|---|\n| no | no |\n';
  assert.deepEqual(parseTable(body, 'Queries'), [{ name: 'mine', query: 'a | b' }, { name: 'team', query: 'x' }]);
});

test('missing files give the defaults', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    const { config, files } = loadConfig(dir);
    assert.equal(files.length, 0);
    assert.equal(config.repo.changeName, 'PR');
    assert.equal(config.policy.maxImplementers, 6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('changeName accepts PR, MR, and none, and another value names the 3', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    writeFileSync(path.join(dir, 'repo.md'), '---\nchangeName: none\n---\n');
    assert.equal(loadConfig(dir).config.repo.changeName, 'none');
    writeFileSync(path.join(dir, 'repo.md'), '---\nchangeName: CR\n---\n');
    assert.throws(() => loadConfig(dir), /changeName must be PR, MR, or none/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid values throw with every problem', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    writeFileSync(path.join(dir, 'policy.md'), '---\nnoMergeWeekdays: [Thu]\nmaxImplementers: 0\n---\n');
    assert.throws(() => loadConfig(dir), /noMergeWeekdays.*maxImplementers/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every template loads as its kind', () => {
  for (const file of readdirSync(templates).filter((f) => f.endsWith('.md'))) {
    const kind = KINDS.find((k) => file === `${k}.md`);
    if (!kind) continue;
    const dir = mkdtempSync(path.join(here, '.forge-tpl-'));
    try {
      copyFileSync(path.join(templates, file), path.join(dir, `${kind}.md`));
      const { config } = loadConfig(dir);
      assert.equal(config.policy.maxImplementers, 6, `${file} must load with the defaults`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('loadConfig rejects incomplete files instead of silently using defaults', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    const file = path.join(dir, 'repo.md');
    const text = '---\nbaseBranch: main\n';
    writeFileSync(file, text);
    assert.throws(() => loadConfig(dir), (e) => e.code === 'bad-config' && e.message.includes(file));
    assert.equal(readFileSync(file, 'utf8'), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('body-only configuration retains defaults without rewriting the file', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    const file = path.join(dir, 'policy.md');
    const text = '# Policy\n\nOptional settings are not configured.\n';
    writeFileSync(file, text);
    const { config } = loadConfig(dir);
    assert.equal(config.policy.maxImplementers, 6);
    assert.equal(readFileSync(file, 'utf8'), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('policy.styleRules defaults to true and accepts true or false only', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    assert.equal(loadConfig(dir).config.policy.styleRules, true);
    writeFileSync(path.join(dir, 'policy.md'), '---\nstyleRules: false\n---\n');
    assert.equal(loadConfig(dir).config.policy.styleRules, false);
    writeFileSync(path.join(dir, 'policy.md'), '---\nstyleRules: maybe\n---\n');
    assert.throws(() => loadConfig(dir), /styleRules must be true or false/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('policy.scopeComment defaults to false and accepts true or false only', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    assert.equal(loadConfig(dir).config.policy.scopeComment, false);
    writeFileSync(path.join(dir, 'policy.md'), '---\nscopeComment: true\n---\n');
    assert.equal(loadConfig(dir).config.policy.scopeComment, true);
    writeFileSync(path.join(dir, 'policy.md'), '---\nscopeComment: maybe\n---\n');
    assert.throws(() => loadConfig(dir), /scopeComment must be true or false/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('policy.planReview defaults to off and accepts off, attacker, and panel only', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    assert.equal(loadConfig(dir).config.policy.planReview, 'off');
    for (const value of ['off', 'attacker', 'panel']) {
      writeFileSync(path.join(dir, 'policy.md'), `---\nplanReview: ${value}\n---\n`);
      assert.equal(loadConfig(dir).config.policy.planReview, value);
    }
    writeFileSync(path.join(dir, 'policy.md'), '---\nplanReview: maybe\n---\n');
    assert.throws(() => loadConfig(dir), /planReview must be off, attacker, or panel/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('KINDS are repo and policy, and an old tracker.md or ci.md is ignored without an error', () => {
  assert.deepEqual(KINDS, ['repo', 'policy']);
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    writeFileSync(path.join(dir, 'tracker.md'), '---\nprefix: L\nitemUrl: nope\nprovider: github\n---\n\n## Queries\n\n| Name | Query |\n|---|---|\n| mine | x |\n');
    writeFileSync(path.join(dir, 'ci.md'), '---\nprovider: github\n');
    writeFileSync(path.join(dir, 'repo.md'), '---\nbaseBranch: main\n---\n');
    const { config, files } = loadConfig(dir);
    assert.deepEqual(files.map((f) => path.basename(f)), ['repo.md']);
    assert.equal(config.repo.baseBranch, 'main');
    assert.equal(config.tracker, undefined);
    assert.equal(config.ci, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('policy.gateGuard accepts deny, ask, and off (off acts as deny in the guard), and refuses another value', () => {
  for (const value of ['deny', 'ask', 'off']) assert.equal(buildConfig({ policy: `---\ngateGuard: ${value}\n---\n` }).policy.gateGuard, value);
  assert.throws(() => buildConfig({ policy: '---\ngateGuard: maybe\n---\n' }), /gateGuard must be deny or ask/);
});
