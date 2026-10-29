import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, parseScalar, parseTable, loadConfig, KINDS } from '../plugins/forge/scripts/lib/config.mjs';

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
    assert.equal(config.policy.learningMode, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('older policy files and empty learningMode values keep learning disabled', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    for (const policy of ['qaHandover: true', 'learningMode:', 'learningMode: null']) {
      writeFileSync(path.join(dir, 'policy.md'), `---\n${policy}\n---\n`);
      assert.equal(loadConfig(dir).config.policy.learningMode, false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('learningMode accepts explicit booleans', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    for (const enabled of [true, false]) {
      writeFileSync(path.join(dir, 'policy.md'), `---\nlearningMode: ${enabled}\n---\n`);
      assert.equal(loadConfig(dir).config.policy.learningMode, enabled);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('learningMode rejects non-boolean values with a config error', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    for (const value of ['"true"', "'false'", 'yes', '1', '0', '[]', '[true]']) {
      writeFileSync(path.join(dir, 'policy.md'), `---\nlearningMode: ${value}\n---\n`);
      assert.throws(() => loadConfig(dir), (error) => {
        assert.equal(error.code, 'bad-config');
        assert.match(error.message, /policy\.md: learningMode must be true or false/);
        return true;
      }, value);
    }
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
    const kind = KINDS.find((k) => file.startsWith(`${k}-`) || file === `${k}.md`);
    if (!kind) continue;
    const dir = mkdtempSync(path.join(here, '.forge-tpl-'));
    try {
      copyFileSync(path.join(templates, file), path.join(dir, `${kind}.md`));
      const { config } = loadConfig(dir);
      assert.equal(config.policy.learningMode, false, `${file} must load with learning disabled`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('loadConfig rejects incomplete files instead of silently using defaults', () => {
  const dir = mkdtempSync(path.join(here, '.forge-cfg-'));
  try {
    const file = path.join(dir, 'tracker.md');
    const text = '---\nprovider: github\n';
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
    assert.equal(config.policy.learningMode, false);
    assert.equal(config.policy.maxImplementers, 6);
    assert.equal(readFileSync(file, 'utf8'), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
