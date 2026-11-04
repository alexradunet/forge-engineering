import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFile } from '../plugins/forge/scripts/lib/config.mjs';

const read = (file) => readFileSync(new URL(`../plugins/forge/skills/${file}`, import.meta.url), 'utf8');
const agents = read('agents/SKILL.md');
const ticket = read('ticket/SKILL.md');
const plan = read('ticket/templates/plan.draft.md');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('agents discovery and handoff allow reuse of the current worktree', () => {
  const { data } = parseFile(agents, 'agents/SKILL.md');
  assert.equal(data.name, 'agents');
  assert.match(data.description, /Reuse a suitable Git worktree/);
  assert.match(agents, /Continue here when it is suitable/);
  assert.match(agents, /do not delegate again merely to obtain isolation/);
  assert.match(agents, /`worktree`: `false` for an existing verified worktree/);
  assert.doesNotMatch(agents, /Each implementer gets its own worktree/);
});

test('worktree selection checks Git identity and gives explicit baselines priority', () => {
  for (const command of [
    'git rev-parse --show-toplevel', 'git rev-parse --git-common-dir',
    'git worktree list --porcelain', 'git branch --show-current',
    'git rev-parse HEAD', 'git status --short',
  ]) assert.ok(agents.includes(command), command);
  assert.match(agents, /an explicit required commit; the recorded ticket branch for existing work;.*only for a new task without a ticket branch/);
  assert.match(agents, /missing, ambiguous, or conflicts with ticket evidence, stop and ask/);
  assert.match(agents, /tool has no base-branch parameter/);
  assert.match(agents, /choose the ticket branch as the base only after its tip matches the required SHA/);
});

test('pinned proof checks stay exact while resumed implementation preserves task changes', () => {
  assert.match(agents, /exact-commit proof, require `HEAD == required commit`/);
  assert.match(agents, /Being ahead by 15 commits is still a mismatch/);
  assert.match(agents, /git merge-base --is-ancestor <baseline> HEAD/);
  assert.match(agents, /Ancestry alone does not prove that the changes belong to this task/);
  assert.match(agents, /Never reset, force-switch, stash, delete, or change the approved baseline/);
  assert.match(agents, /Do not edit approved documents or their manifests to repair it/);
});

test('ticket start, resume, implementation, and plan template agree on worktree reuse', () => {
  const start = ticket.split('## 🚀 Start')[1].split('###')[0];
  const resume = ticket.split('## 🔁 Resume')[1].split('## 🔎 Investigate')[0];
  const implement = ticket.split('## 🛠️ Implement')[1].split('## 🔬 Evidence Testing')[0];
  assert.match(start, /Preserve an existing session worktree/);
  assert.match(resume, /does not need another worktree when the current one is suitable/);
  assert.match(implement, /Continue in a suitable current worktree/);
  assert.match(ticket, /exact-commit proof requires HEAD equality, not just ancestry/);
  assert.match(plan, /Reuse the current one when suitable/);
  assert.match(readme, /reuses a suitable current worktree/);
  assert.match(readme, /Exact-commit proofs require HEAD equality/);
  for (const text of [ticket, plan]) {
    assert.doesNotMatch(text, /The `agents` skill creates a worktree session at Implement|After GO, the build starts in a new worktree/);
  }
});
