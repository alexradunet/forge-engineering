// Variants of the plugin for a comparison run: a copy of plugins/forge in a temporary folder, with one rule changed.
// `npm run eval -- --case <name> --variant <variant>` gives the copy to the session, so two runs differ only in that rule.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plugin } from './fixture.mjs';

/** The text of a file without one section: from its heading to the next heading of the same or a higher level. */
export function withoutSection(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`No heading: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const found = /^(#+) /.exec(lines[i]);
    if (found && found[1].length <= level) { end = i; break; }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`The text to change is missing: ${from.slice(0, 70)}`);
  return text.replace(from, () => to);
}

export const VARIANTS = {
  // The cold read of a gate document is gone: the step of the gate procedure, its section, and its section in the agents skill.
  'no-cold-read': {
    'skills/ticket/phases/gates.md': (text) => swap(swap(withoutSection(text, '### 🐟 Cold read'),
      'Write or update the gate document from its template. Run the cold read. Run `<F> lint`', 'Write or update the gate document from its template. Run `<F> lint`'),
    'It has the cold read, the steps of each gate,', 'It has the steps of each gate,'),
    'skills/ticket/SKILL.md': (text) => swap(swap(swap(text,
      '(Cold read, Procedure, Approval revisions, Approval form, Canvas)', '(Procedure, Approval revisions, Approval form, Canvas)'),
    '| Worktree sessions, implementers, reviewers, cold read, hand-off | the `agents` skill |', '| Worktree sessions, implementers, reviewers, hand-off | the `agents` skill |'),
    'the cold read, the manifest, the approval form,', 'the manifest, the approval form,'),
    'skills/agents/SKILL.md': (text) => swap(withoutSection(text, '## 🐟 Cold read'),
      '| Test a gate document on a reader without the session history | a cold read subagent (see "Cold read") | nothing; the result comes back here |\n', ''),
  },
};

/** Makes the copy of the plugin for a variant. Returns { dir, remove }. Without a name, it gives the plugin folder itself. */
export function buildVariant(name) {
  if (!name) return { dir: plugin, remove: () => {} };
  const changes = VARIANTS[name];
  if (!changes) throw new Error(`Unknown variant: ${name}. Use ${Object.keys(VARIANTS).join(', ')}.`);
  const base = mkdtempSync(path.join(os.tmpdir(), 'forge-variant-'));
  const dir = path.join(base, 'forge');
  cpSync(plugin, dir, { recursive: true });
  for (const [file, change] of Object.entries(changes)) {
    const target = path.join(dir, ...file.split('/'));
    const text = readFileSync(target, 'utf8');
    const crlf = text.includes('\r\n');
    const next = change(text.replace(/\r\n/g, '\n'));
    writeFileSync(target, crlf ? next.replace(/\n/g, '\r\n') : next);
  }
  return { dir, remove: () => rmSync(base, { recursive: true, force: true }) };
}
