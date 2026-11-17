import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseFile } from '../plugins/forge/scripts/lib/config.mjs';

const read = (file) => readFileSync(new URL(`../plugins/forge/skills/${file}`, import.meta.url), 'utf8');
const agents = read('agents/SKILL.md');
const ticket = read('ticket/SKILL.md');
const plan = read('ticket/templates/plan.md');
const legacy = read('ticket/legacy/rules.md');
const legacyPlan = read('ticket/legacy/templates/plan.draft.md');
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
  // full-v3 documents hold no process text, so only the older plan template names the worktree rule.
  assert.match(legacyPlan, /Reuse the current one when suitable/);
  assert.doesNotMatch(plan, /worktree/);
  assert.match(readme, /reuses a suitable current worktree/);
  assert.match(readme, /Exact-commit proofs require HEAD equality/);
  for (const text of [ticket, plan, legacy, legacyPlan]) {
    assert.doesNotMatch(text, /The `agents` skill creates a worktree session at Implement|After GO, the build starts in a new worktree/);
  }
});

test('the ticket skill is full-v3 only, and the older rules stay complete in legacy/', () => {
  assert.match(ticket, /Every new ticket uses `full-v3`/);
  assert.match(ticket, /\| `workflow: full-v2`, `workflow: full-v1`, or no marker \| \[legacy\/rules\.md\]\(legacy\/rules\.md\)/);
  assert.match(ticket, /Never move it to `full-v3`/);
  // The words of the older workflows belong to legacy/rules.md, not to the steps of new tickets.
  assert.doesNotMatch(ticket, /Understood\?|Agreed\?|Diagnosed\?|Designed\?|Briefed\?|plan\.draft\.md|approvedCopies|track: [SML]/);
  for (const text of ['workflow: full-v2', 'workflow: full-v1', 'track: M', 'Briefed?', 'approvedCopies', 'forge.mjs" context']) assert.ok(legacy.includes(text), text);
  assert.match(legacy, /A ticket with `workflow: full-v3` uses \[SKILL\.md\]\(\.\.\/SKILL\.md\)/);
  for (const [text, base] of [[ticket, 'ticket/'], [legacy, 'ticket/legacy/']]) {
    for (const [, target] of text.matchAll(/\]\(((?:templates|legacy|\.\.)\/[^)#]+)\)/g)) {
      assert.ok(existsSync(new URL(`../plugins/forge/skills/${base}${target}`, import.meta.url)), `${base}${target}`);
    }
  }
});

test('full-v3 templates are plain: no emoji in headings, no bold labels, and the gate documents ask for one answer', () => {
  const dir = new URL('../plugins/forge/skills/ticket/templates/', import.meta.url);
  const names = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== '_style.md');
  assert.deepEqual(names.sort(), ['README.md', 'close.md', 'journal.md', 'map.md', 'outbox.draft.md', 'plan.md', 'proof.md', 'qa-handover.md', 'review.md', 'story.md']);
  for (const name of names) {
    const text = read(`ticket/templates/${name}`);
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
    for (const heading of body.match(/^#{1,6} .*$/gm) ?? []) assert.doesNotMatch(heading, /\p{Extended_Pictographic}/u, `${name}: ${heading}`);
    assert.doesNotMatch(body, /\*\*/, `${name}: bold text`);
    assert.doesNotMatch(body, /^> /m, `${name}: quote block`);
    assert.doesNotMatch(body, /```mermaid/, `${name}: the canvas draws the diagrams`);
    assert.ok(ticket.includes(`(templates/${name})`), `the skill lists templates/${name}`);
  }
  for (const [name, gate] of [['story.md', 'Scoped?'], ['plan.md', 'Planned?'], ['review.md', 'Shippable?'], ['close.md', 'Learned?']]) {
    const text = read(`ticket/templates/${name}`);
    assert.match(text, new RegExp(`^gate: ${gate.replace('?', '\\?')}$`, 'm'));
    assert.match(text, new RegExp(`^Need from you: GO on ${gate.replace('?', '\\?')}`, 'm'), name);
  }
});

test('each review gate has a cold read by a reader without the session history', () => {
  assert.match(agents, /## 🐟 Cold read/);
  assert.match(agents, /Give it only this, and nothing from the session/);
  assert.match(agents, /Can you implement this plan from `plan\.md` and `map\.md` alone\?/);
  assert.match(agents, /does not approve a gate, and it does not replace the adversarial review/);
  assert.match(ticket, /Before you open Scoped\?, Planned\?, Shippable\?, or Learned\?, run one cold read/);
  assert.match(ticket, /Canvas comments for <KEY>:/);
  assert.match(ticket, /Never edit it, never list it in a manifest, and never take a fact or an approval from it/);
});
