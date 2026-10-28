import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../plugins/forge/scripts/lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(here, '..', 'plugins', 'forge', 'skills', 'learning-mode');
const skillFile = path.join(skillDir, 'SKILL.md');
const templateFile = path.join(skillDir, 'templates', 'knowledge-bite.md');

test('learning skill has discoverable frontmatter and a matching folder name', () => {
  const { data } = parseFile(readFileSync(skillFile, 'utf8'), skillFile);
  assert.equal(data.name, path.basename(skillDir));
  assert.equal(typeof data.description, 'string');
  for (const phrase of ['learning mode', 'learn:', 'explain this concept', 'knowledge bite']) {
    assert.ok(data.description.includes(phrase), `missing discovery phrase: ${phrase}`);
  }
  assert.notEqual(data['disable-model-invocation'], true);
});

test('learning skill links to an existing lesson template', () => {
  const skill = readFileSync(skillFile, 'utf8');
  const links = [...skill.matchAll(/\]\((templates\/[^)]+)\)/g)];
  assert.ok(links.length > 0);
  for (const [, target] of links) assert.ok(existsSync(path.join(skillDir, target)), target);
});

test('lesson budget covers four sections and totals 15 minutes', () => {
  const template = readFileSync(templateFile, 'utf8').replace(/\r\n/g, '\n');
  const sections = [...template.matchAll(/^\| ([^|]+?) \| (\d+) \|$/gm)];
  assert.equal(sections.length, 4);
  assert.deepEqual(sections.map(([, , minutes]) => Number(minutes)), [3, 4, 5, 3]);
  assert.equal(sections.reduce((sum, [, , minutes]) => sum + Number(minutes), 0), 15);
  for (const [, section] of sections) {
    assert.ok(template.includes(`## ${section}\n`), `missing lesson section: ${section}`);
  }
  assert.match(template, /^### Suggested answers$/m);
  assert.match(template, /^## Sources$/m);
});
