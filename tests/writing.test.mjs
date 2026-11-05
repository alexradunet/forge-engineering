import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../plugins/forge/scripts/lib/config.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(root, 'plugins', 'forge');
const skillDir = path.join(pluginDir, 'skills', 'writing');
const skillFile = path.join(skillDir, 'SKILL.md');
const styleRule = path.join(pluginDir, 'context', 'style.md');

function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Drops inline code and catalog "Before" examples. Fenced blocks stay: inline templates are prose.
function withoutCode(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^>\s*Before:/.test(line))
    .join('\n')
    .replace(/`[^`\n]*`/g, '');
}

// Also drops fenced blocks, where ` -- ` is a command separator.
function prose(text) {
  return withoutCode(text.replace(/\r\n/g, '\n').replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ''));
}

test('writing skill has discoverable frontmatter and a matching folder name', () => {
  const { data } = parseFile(readFileSync(skillFile, 'utf8'), skillFile);
  assert.equal(data.name, path.basename(skillDir));
  assert.equal(typeof data.description, 'string');
  for (const phrase of ['humanize', 'remove AI tells', 'check the writing', 'Sendable?', 'wiki page']) {
    assert.ok(data.description.includes(phrase), `missing discovery phrase: ${phrase}`);
  }
});

test('writing skill keeps the license notice and links that exist', () => {
  const skill = readFileSync(skillFile, 'utf8');
  const notice = readFileSync(path.join(skillDir, 'NOTICE.md'), 'utf8');
  assert.match(notice, /humanizer/);
  assert.match(notice, /i-have-adhd/);
  assert.equal((notice.match(/Permission is hereby granted/g) ?? []).length, 2);
  const local = [...skill.matchAll(/\]\(((?!https?:)[^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
  assert.ok(local.includes('NOTICE.md'));
  assert.ok(local.some((target) => target.endsWith('ticket/templates/_style.md')));
  for (const target of local) assert.ok(existsSync(path.join(skillDir, target)), target);
});

test('pattern catalog numbers 26 patterns in order', () => {
  const skill = readFileSync(skillFile, 'utf8');
  const numbers = [...skill.matchAll(/^#### §(\d+) /gm)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, Array.from({ length: 26 }, (_, i) => i + 1));
});

test('the style rule of the session context points to the writing skill', () => {
  const rule = readFileSync(styleRule, 'utf8');
  assert.match(rule, /`writing`/);
  assert.match(rule, /No AI tells/);
});

test('plugin, docs, README, and AGENTS text has no em, en, or double-hyphen dashes', () => {
  const files = [
    ...markdownFiles(pluginDir),
    ...markdownFiles(path.join(root, 'docs')),
    path.join(root, 'README.md'),
    path.join(root, 'AGENTS.md'),
  ];
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const line of withoutCode(text).split('\n')) {
      if (/[\u2013\u2014]/.test(line)) hits.push(`${path.relative(root, file)}: ${line.trim()}`);
    }
    for (const line of prose(text).split('\n')) {
      if (/\s--\s/.test(line)) hits.push(`${path.relative(root, file)}: ${line.trim()}`);
    }
  }
  assert.deepEqual(hits, []);
});
