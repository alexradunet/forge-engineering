import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseFile } from '../plugins/forge/scripts/lib/config.mjs';

const read = (file) => readFileSync(new URL(`../plugins/forge/skills/${file}`, import.meta.url), 'utf8');
const agents = read('agents/SKILL.md');
// 7.3.0: the ticket skill is a short SKILL.md and one file for each phase in phases/, so that SKILL.md stays whole
// in the context after a compaction. `ticket` is the text of all parts, in the order of the workflow.
const ticketCore = read('ticket/SKILL.md');
const PHASES = ['start', 'state', 'worktrees', 'gates', 'investigate-plan', 'implement', 'evidence', 'closing'];
const phase = (name) => read(`ticket/phases/${name}.md`);
const ticket = [ticketCore, ...PHASES.map(phase)].join('\n');
const plan = read('ticket/templates/plan.md');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('agents discovery and handoff allow reuse of the current worktree', () => {
  const { data } = parseFile(agents, 'agents/SKILL.md');
  assert.equal(data.name, 'agents');
  assert.match(data.description, /Reuse a suitable Git worktree/);
  assert.match(agents, /Continue here when it is suitable/);
  assert.match(agents, /do not delegate again merely to obtain isolation/);
  assert.match(agents, /folder: the verified worktree path when one already exists/);
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
  assert.match(agents, /Never assume that a new worktree selects the ticket branch or a required commit/);
  assert.match(agents, /Create the worktree from the required SHA: `<F> worktree <KEY> --summary "<short>" --base <full SHA> --create`/);
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
  const start = phase('start').split('## 🚀 Start')[1].split('###')[0];
  const resume = ticketCore.split('## 🔁 Resume')[1];
  const implement = phase('implement').split('## 🛠️ Implement')[1];
  assert.match(start, /Preserve an existing session worktree/);
  assert.match(resume, /does not need another worktree when the current one is suitable/);
  assert.match(implement, /Continue in a suitable current worktree/);
  assert.match(ticket, /exact-commit proof requires HEAD equality, not just ancestry/);
  // full-v4 documents hold no process text.
  assert.doesNotMatch(plan, /worktree/);
  assert.match(readme, /reuses a suitable current worktree/);
  assert.match(readme, /Exact-commit proofs require HEAD equality/);
  for (const text of [ticket, plan]) {
    assert.doesNotMatch(text, /The `agents` skill creates a worktree session at Implement|After GO, the build starts in a new worktree/);
  }
});

test('the ticket skill is full-v4 only, with three review gates, and it has no rules of the removed layouts', () => {
  assert.match(ticket, /Every new ticket uses `full-v4`/);
  assert.match(ticket, /Forge reads only `workflow: full-v4`/);
  assert.match(ticketCore, /Three review gates in order: Planned\?, Shippable\?, Learned\?/);
  assert.match(ticketCore.split('\n', 4).join('\n'), /full-v4 workflow .* with three review gates/);
  assert.match(ticketCore, /When the marker is `full-v3`, stop\. Tell the user to finish this ticket with Forge 10\.1\./);
  for (const [file, text] of [['SKILL.md', ticketCore], ...PHASES.map((name) => [name, phase(name)]), ['agents', agents]]) {
    const rest = text.replace(/^- When the marker is `full-v3`.*$/m, '');
    assert.doesNotMatch(rest, /Scoped\?|full-v3/, file);
  }
  assert.ok(!existsSync(new URL('../plugins/forge/skills/ticket/legacy', import.meta.url)), 'Forge 8 removed legacy/.');
  assert.doesNotMatch(ticket, /Understood\?|Agreed\?|Diagnosed\?|Designed\?|Briefed\?|plan\.draft\.md|approvedCopies|track: [SML]/);
  const parts = [[ticketCore, 'ticket/'], ...PHASES.map((name) => [phase(name), 'ticket/phases/'])];
  for (const [text, base] of parts) {
    for (const [, target] of text.matchAll(/\]\(((?:templates|phases|\.\.)\/[^)#]+|[a-z-]+\.md)\)/g)) {
      assert.ok(existsSync(new URL(`../plugins/forge/skills/${base}${target}`, import.meta.url)), `${base}${target}`);
    }
  }
});

test('full-v4 templates are plain: no emoji in headings, no bold labels, and the gate documents ask for one answer', () => {
  const dir = new URL('../plugins/forge/skills/ticket/templates/', import.meta.url);
  const names = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== '_style.md');
  assert.deepEqual(names.sort(), ['README.md', 'close.md', 'journal.md', 'map.md', 'outbox.draft.md', 'plan.md', 'proof.md', 'qa-handover.md', 'review.md', 'story.md']);
  for (const name of names) {
    const text = read(`ticket/templates/${name}`);
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
    for (const heading of body.match(/^#{1,6} .*$/gm) ?? []) assert.doesNotMatch(heading, /\p{Extended_Pictographic}/u, `${name}: ${heading}`);
    assert.doesNotMatch(body, /\*\*/, `${name}: bold text`);
    assert.doesNotMatch(body, /^> /m, `${name}: quote block`);
    assert.doesNotMatch(body, /```mermaid/, `${name}: no Mermaid diagram in a template`);
    assert.ok(ticket.includes(`templates/${name})`), `a part of the skill links templates/${name}`);
  }
  // story.md is a document of Planned?: it has no Need line, because the plan asks for the GO.
  for (const [name, gate] of [['story.md', 'Planned?'], ['plan.md', 'Planned?'], ['review.md', 'Shippable?'], ['close.md', 'Learned?']]) {
    const text = read(`ticket/templates/${name}`);
    assert.match(text, new RegExp(`^gate: ${gate.replace('?', '\\?')}$`, 'm'));
    if (name === 'story.md') {
      assert.doesNotMatch(text, /^Need from you:/m, name);
      assert.match(text, /^Problem: /m, name);
      assert.match(text, /^Scope: /m, name);
    } else assert.match(text, new RegExp(`^Need from you: GO on ${gate.replace('?', '\\?')}`, 'm'), name);
  }
});

test('the scope check is a question in chat, and Planned? covers story.md and plan.md', () => {
  const start = phase('start');
  assert.match(start, /^### 🎯 Scope check$/m);
  for (const value of ['correct', 'change', 'reporter', 'later']) assert.ok(start.includes(`| \`${value}\` |`), value);
  assert.match(start, /policy\.scopeComment/);
  assert.match(start, /no manifest, no cold read, and no \`gate-open\`/);
  assert.match(phase('investigate-plan'), /Start only after the \`scope\` decision is in \`journal\.md\`/);
  assert.match(phase('investigate-plan'), /Verify that the \`scope\` decision is in \`journal\.md\`/);
  const gates = phase('gates');
  assert.match(gates, /Are the scope and the plan for APP-123 correct\?/);
  assert.match(gates, /For Planned\?, it gets the paths of \`story\.md\` and \`plan\.md\`/);
  const evidence = phase('evidence');
  assert.match(evidence, /- \`false\` \(default\): do Evidence Testing after the implementation and the adversarial review, and before Shippable\?/);
  assert.match(evidence, /- \`true\`: start it after Shippable\? and the change request/);
  assert.match(phase('implement'), /When \`policy\.evidenceOnDeployedEnv\` is \`false\`: do Evidence Testing and write \`proof\.md\`/);
});

test('a repository with no change requests pushes to the base branch after Shippable?', () => {
  const implement = phase('implement');
  assert.match(implement, /\`repo\.changeName\` is \`none\`/);
  assert.match(implement, /git push origin HEAD:<base branch>/);
  assert.match(implement, /Never force-push/);
  assert.match(agents, /and before a push to the base branch when the repository has no change requests/);
});

test('each review gate has a cold read by a reader without the session history', () => {
  assert.match(agents, /## 🐟 Cold read/);
  assert.match(agents, /Give it only this, and nothing from the session/);
  assert.match(agents, /Can you implement this plan from `story\.md`, `plan\.md`, and `map\.md` alone\?/);
  assert.match(agents, /does not approve a gate, and it does not replace the adversarial review/);
  assert.match(ticket, /Before you open Planned\?, Shippable\?, or Learned\?, run one cold read/);
  assert.doesNotMatch(phase('gates'), /### .*Canvas/);
  assert.doesNotMatch(phase('gates'), /canvas-comments\.md/);
  assert.match(phase('gates'), /I added comments in the chat/);
  assert.doesNotMatch(ticketCore.split('\n', 4).join('\n'), /canvas/i, 'the description of the ticket skill has no canvas');
});

test('each host table has the part for the pages, and the live server stays on this machine', () => {
  assert.match(phase('gates'), /Give the link to the document with `host\.open`/);
  for (const host of ['claude', 'copilot-cli']) {
    const table = readFileSync(new URL(`../plugins/forge/hosts/${host}.md`, import.meta.url), 'utf8');
    assert.match(table, /`forge\.mjs open --no-browser`/, host);
    assert.match(table, /^## Pages$/m, host);
    assert.doesNotMatch(table, /canvas-comments|Send to agent|`sent`/, host);
    assert.match(table, /`http:\/\/127\.0\.0\.1`/, host);
    assert.match(table, /Never use another address than `127\.0\.0\.1`/, host);
  }
  assert.match(readFileSync(new URL('../plugins/forge/hosts/claude.md', import.meta.url), 'utf8'), /`run_in_background: true`/);
});

test('the plan has design options, a baseline run, and a plan review, and the gate steps use gate-open', () => {
  assert.match(phase('start'), /Give 2 other possible readings/);
  assert.match(phase('start'), /Ask which reading is right as the first question of the form/);
  const plan = phase('investigate-plan');
  for (const part of ['Design options', 'Baseline run', 'Plan review', '(new)', 'gate-open <key> planned']) assert.ok(plan.includes(part), part);
  assert.match(plan, /A baseline that gives the Expected result means that the check cannot show the change/);
  assert.match(agents, /## 🧐 Plan review/);
  assert.ok(agents.indexOf('## 🧐 Plan review') > agents.indexOf('## 🐟 Cold read'));
  assert.ok(agents.indexOf('## 🧐 Plan review') < agents.indexOf('## 🥊 Adversarial review'));
  for (const role of ['Design Critic', 'Codebase Auditor', 'Operability Reviewer']) assert.ok(agents.includes(role), role);
  assert.match(agents, /plan-sha256/);
  assert.match(agents, /policy\.planReview/);
  const gates = phase('gates');
  assert.match(gates, /Run \`<F> gate-open <key> <gate> \[extra files\]\`/);
  assert.match(gates, /Never write a manifest by hand/);
  assert.doesNotMatch(gates, /Get the form text: run/);
  assert.match(gates, /is part of the approved Shippable\? set/);
  assert.ok(gates.includes('change-update.draft.md'));
  assert.ok(phase('evidence').includes('change-update.draft.md'));
  assert.match(phase('implement'), /Keep this order before the push/);
  assert.ok(plan.includes('gate-open <key> planned --dry-run'));
  assert.ok(plan.indexOf('gate-open <key> planned --dry-run') < plan.indexOf('**Plan review.**'), 'The plan checks run before the plan review.');
  assert.match(plan, /Never write a \`plan-sha256\` for a revision that no reviewer read/);
  assert.match(agents, /Write \`plan-sha256\` only after your last edit of \`plan\.md\` in this round, and never change it later/);
});

test('a ticket with no code change has steps, and story.md has no Need from you line', () => {
  const implement = phase('implement');
  assert.match(implement, /### .*Ticket with no code change/);
  assert.match(implement, /Leave \`branch\` and \`worktree\` empty in the README/);
  assert.match(phase('evidence'), /A ticket with no code change has no push\. Its checks run before Shippable\? in each case/);
  assert.match(ticketCore, /A ticket with no code change has the same gates/);
  assert.match(read('ticket/templates/_style.md'), /\`story\.md\` has no \`Need from you:\` line/);
  assert.doesNotMatch(read('ticket/templates/story.md'), /Need from you:/);
  assert.match(plan, /Need from you: GO on Planned\?/);
  assert.match(phase('gates'), /set \`status: sent\` in the frontmatter of the draft, and change nothing else in it/);
});

test('the team size values are the same in the setup skill, the policy template, and docs/config.md', () => {
  const setup = read('forge-setup/SKILL.md');
  const policy = readFileSync(new URL('../plugins/forge/templates/config/policy.md', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../docs/config.md', import.meta.url), 'utf8');
  for (const text of ['Team size', '`small` (solo, or a team of 5 or less)', '`large` (a large team with QA and deployed test environments)', 'the response style rules of the plugin', 'one `host.ask` form with 2 questions', '`planReview: panel`']) assert.ok(setup.includes(text), text);
  const fromSkill = (size) => Object.fromEntries([...new RegExp(`^- ${size}: .*$`, 'm').exec(setup)[0].matchAll(/"policy\.(\w+)=([^"<]+)"/g)].map((m) => [m[1], m[2]]));
  const fromPolicy = (name) => Object.fromEntries([...new RegExp(`^${name} team: .*$`, 'm').exec(policy)[0].matchAll(/\`(\w+)=(\w+)\`/g)].map((m) => [m[1], m[2]]));
  const rows = [...docs.matchAll(/^\| \`(\w+)\` \| \`(\w+)\` \| \`(\w+)\` \|$/gm)];
  const fromDocs = (column) => Object.fromEntries(rows.filter((m) => ['planReview', 'scopeComment', 'evidenceOnDeployedEnv', 'qaHandover'].includes(m[1])).filter((m) => m[2 + column] !== undefined).map((m) => [m[1], m[2 + column]]));
  const small = fromSkill('small');
  const large = fromSkill('large');
  assert.deepEqual(Object.keys(small).sort(), ['evidenceOnDeployedEnv', 'planReview', 'qaHandover', 'scopeComment']);
  assert.deepEqual([fromPolicy('Small'), fromPolicy('Large')], [small, large]);
  assert.deepEqual([fromDocs(0), fromDocs(1)], [small, large]);
  assert.match(setup, /"policy\.styleRules=<true\|false>"/);
  // The frontmatter of the template is the small-team set, with styleRules false.
  const { data } = parseFile(policy, 'policy.md');
  for (const [key, value] of Object.entries(small)) assert.equal(String(data[key]), value, key);
  assert.equal(data.styleRules, false);
});

test('the local ticket texts: Start, closing, and the session context name the local key', () => {
  const start = phase('start');
  assert.match(start, /### 📝 A ticket with no work item/);
  assert.match(start, /<F> local-key/);
  assert.match(start, /evidence\/<yyyy-mm-dd>-request\.md/);
  assert.match(phase('closing'), /A local ticket \(key \`L-<n>\`\)[\s\S]*another ticket[\s\S]*<F> local-key/);
  assert.match(ticketCore, /local key \`L-<n>\`/);
  assert.match(readFileSync(new URL('../plugins/forge/context/forge.md', import.meta.url), 'utf8'), /ticket with no key[^\n]*Start gives it a key \`L-<n>\`/);
});

test('the setup skill has no profile, tool, or credential step', () => {
  const setup = read('forge-setup/SKILL.md');
  for (const text of ['repo.changeName=<value>', 'Never answer for the user', 'Forge calls no tracker, no change request host, and no CI tool']) assert.ok(setup.includes(text), text);
  assert.doesNotMatch(setup, /profile\.md|seed --profile|bind --profile|cred\.mjs|Live read|Queries|MCP/);
});
