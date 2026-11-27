import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Forge 14.0.0 calls no external tool: no tracker, no change request host, no CI. The agent gives the user the text to paste.
// No file of the plugin (the vendor folder excluded) may name a capability of such a tool, a credential helper, or a gate for a write.
const plugin = fileURLToPath(new URL('../plugins/forge', import.meta.url));
const REMOVED = [
  'tracker.fetch', 'tracker.search', 'tracker.comment', 'tracker.create', 'tracker.transition',
  'repo.open-change', 'repo.update-change', 'ci.status', 'ci.trigger', 'cred.mjs', 'Sendable', 'host.write',
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === 'vendor' || name === 'node_modules') return [];
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

test('no file of the plugin names a removed external capability, a credential helper, or Sendable?', () => {
  const hits = [];
  for (const file of files(plugin)) {
    const text = readFileSync(file, 'utf8');
    for (const word of REMOVED) if (text.includes(word)) hits.push(`${path.relative(plugin, file)}: ${word}`);
  }
  assert.deepEqual(hits, []);
});
