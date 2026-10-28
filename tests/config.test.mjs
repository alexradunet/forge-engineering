import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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

test('parseTable reads the table under a heading, with escaped pipes and code cells', () => {
  const body = '# T\n\n## 🔎 Queries\n\nText.\n\n| Name | Query |\n|---|---|\n| `mine` | `a \\| b` |\n| team | x |\n\n## Other\n| Name | Query |\n|---|---|\n| no | no |\n';
  assert.deepEqual(parseTable(body, 'Queries'), [{ name: 'mine', query: 'a | b' }, { name: 'team', query: 'x' }]);
});

test('missing files give the defaults', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-cfg-'));
  try {
    const { config, files } = loadConfig(dir);
    assert.equal(files.length, 0);
    assert.equal(config.repo.changeName, 'PR');
    assert.equal(config.policy.maxImplementers, 6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid values throw with every problem', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-cfg-'));
  try {
    writeFileSync(path.join(dir, 'policy.md'), '---\nnoMergeWeekdays: [Thu]\nmaxImplementers: 0\n---\n');
    assert.throws(() => loadConfig(dir), /noMergeWeekdays.*maxImplementers/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every template loads as its kind', () => {
  for (const file of readdirSync(templates).filter((f) => f.endsWith('.md'))) {
    const kind = KINDS.find((k) => file.startsWith(`${k}-`) || file === `${k}.md`);
    if (!kind) continue;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-tpl-'));
    try {
      copyFileSync(path.join(templates, file), path.join(dir, `${kind}.md`));
      assert.doesNotThrow(() => loadConfig(dir), `${file} must load`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
