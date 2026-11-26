import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from './scenarios/evaluator.mjs';
import { sha256 } from '../plugins/forge/scripts/lib/validation.mjs';
import { GATE_DOCS } from '../plugins/forge/scripts/lib/ticket.mjs';

const scenarios = JSON.parse(readFileSync(new URL('./fixtures/scenarios.json', import.meta.url), 'utf8'));
const action = (name) => ({ kind: 'action', name });
const SCOPE = { kind: 'decision', subject: 'scope', value: 'accepted' };
const source = (name) => ({ kind: 'source', name, status: 'available' });
const APPROVAL_SETS = GATE_DOCS;
function fixture(scenario) {
  const artifacts = Object.fromEntries((scenario.expectedArtifacts ?? []).map((artifact) => [artifact.path, (artifact.includes ?? ['Synthetic evidence']).join('\n') + '\n']));
  const trace = [];
  const revision = (name) => {
    artifacts[name] ??= 'Synthetic evidence\n';
    const doc = { path: name, sha256: sha256(artifacts[name]) };
    trace.push({ kind: 'artifact', ...doc });
    return doc;
  };
  for (const [name] of Object.entries(artifacts)) revision(name);
  const approve = (gate, names) => trace.push({ kind: 'approval', gate, explicit: true, documents: names.map(revision) });
  const approvals = { ...APPROVAL_SETS, ...scenario.gateDocuments };
  for (const [gate, names] of Object.entries(approvals)) {
    if (!scenario.gateAfterActions?.[gate]) approve(gate, names);
  }
  const requiredEvent = (expected) => ({ ...expected, ...(expected.status === 'unavailable' ? { gap: 'Synthetic source is unavailable; evidence gap recorded.' } : {}) });
  // Decisions answer a question that the sequence asks, so they follow the actions.
  for (const expected of scenario.requiredEvents ?? []) {
    if (expected.kind !== 'approval' && expected.kind !== 'decision') trace.push(requiredEvent(expected));
  }
  trace.push(...['ticket-history', 'wiki', 'affected-code', 'existing-tests', 'regression-risks']
    .filter((name) => !trace.some((event) => event.kind === 'source' && event.name === name)).map(source));
  const completed = [];
  const approved = new Set();
  // The user decides the scope in chat after scope-check. A sequence with no scope-check has the decision at its start.
  if (!scenario.sequence?.includes('scope-check')) trace.push(SCOPE);
  for (const name of scenario.sequence ?? []) {
    trace.push(action(name));
    if (name === 'scope-check') trace.push(SCOPE);
    completed.push(name);
    for (const [gate, actions] of Object.entries(scenario.gateAfterActions ?? {})) {
      if (!approved.has(gate) && actions.every((item) => completed.includes(item))) {
        approve(gate, approvals[gate]);
        approved.add(gate);
      }
    }
  }
  for (const expected of scenario.requiredEvents ?? []) {
    if (expected.kind === 'decision') trace.push(requiredEvent(expected));
  }
  return { artifacts, trace };
}

for (const scenario of scenarios) {
  test(`synthetic scenario: ${scenario.id} checks artifacts and complete trace`, () => {
    const { trace, artifacts } = fixture(scenario);
    const result = evaluate(scenario, trace, artifacts);
    assert.equal(result.passed, true, JSON.stringify(result.checks.filter((check) => !check.pass)));
    assert.equal(evaluate(scenario, [], artifacts).passed, false, 'Artifact shape alone is insufficient.');
    for (const name of scenario.forbiddenActions) {
      assert.equal(evaluate(scenario, [...trace, action(name)], artifacts).passed, false, name);
    }
  });
}

test('small and large scenarios require the same full phase sequence', () => {
  assert.ok(scenarios.every((entry) => entry.workflow === 'full-v4'), 'Forge 12 reads only full-v4.');
  const v4 = scenarios.filter((entry) => entry.id.endsWith('-full-research'));
  assert.equal(v4.length, 2);
  assert.deepEqual(v4[0].sequence, v4[1].sequence);
  assert.equal(v4[0].sequence.indexOf('scope-check') + 1, v4[0].sequence.indexOf('investigate'), 'The scope question comes right before investigate.');
  assert.ok(!Object.keys(v4[0].gateAfterActions).includes('Scoped?'), 'Scope is not a gate.');
});

test('the flow of Forge 12: the proof comes before Shippable?, unless the proof needs a deployed environment', () => {
  const flow = ['research', 'interview', 'scope-check', 'investigate', 'options', 'plan', 'baseline', 'cold-read', 'implement', 'evidence', 'review', 'close', 'distill', 'archive'];
  const small = scenarios.find((entry) => entry.id === 'v4-small-fix-full-research');
  assert.deepEqual(small.sequence, flow);
  const deployed = scenarios.find((entry) => entry.deployedEvidence);
  assert.equal(deployed?.id, 'deployed-evidence');
  assert.ok(deployed.sequence.indexOf('review') < deployed.sequence.indexOf('evidence'), 'A deployed check needs the pushed code.');
  assert.deepEqual(deployed.gateAfterActions['Shippable?'], ['review']);
  assert.ok(small.gateAfterActions['Shippable?'].includes('evidence'), 'The default flow approves Shippable? after the proof.');
  const early = fixture(small);
  const gate = early.trace.findIndex((event) => event.kind === 'approval' && event.gate === 'Shippable?');
  const [approval] = early.trace.splice(gate, 1);
  early.trace.splice(early.trace.findIndex((event) => event.kind === 'action' && event.name === 'evidence'), 0, approval);
  assert.equal(evaluate(small, early.trace, early.artifacts).passed, false, 'A Shippable? approval before evidence fails in the default flow.');
  const late = fixture(deployed);
  assert.equal(evaluate(deployed, late.trace, late.artifacts).passed, true);
  const before = late.trace.findIndex((event) => event.kind === 'action' && event.name === 'evidence');
  assert.ok(late.trace.findIndex((event) => event.kind === 'approval' && event.gate === 'Shippable?') < before, 'In the deployed flow the approval comes before evidence.');
});

test('investigate and plan need the accepted scope decision of the user, not a gate', () => {
  const scenario = scenarios.find((entry) => entry.id === 'v4-small-fix-full-research');
  const { trace, artifacts } = fixture(scenario);
  assert.ok(!trace.some((event) => event.kind === 'approval' && event.gate === 'Scoped?'));
  const without = trace.filter((event) => !(event.kind === 'decision' && event.subject === 'scope'));
  assert.equal(evaluate(scenario, without, artifacts).passed, false, 'No scope decision.');
  const declined = trace.map((event) => event.kind === 'decision' && event.subject === 'scope' ? { ...event, value: 'declined' } : event);
  assert.equal(evaluate(scenario, declined, artifacts).passed, false, 'A declined scope does not count.');
  const late = trace.filter((event) => event !== trace.find((item) => item.kind === 'decision' && item.subject === 'scope'));
  late.splice(late.findIndex((event) => event.kind === 'action' && event.name === 'plan') + 1, 0, SCOPE);
  assert.equal(evaluate(scenario, late, artifacts).passed, false, 'The decision comes before investigate.');
});

test('Planned? approves story.md and plan.md, and a change of either after the approval blocks the implementation', () => {
  const scenario = scenarios.find((entry) => entry.id === 'v4-small-fix-full-research');
  assert.deepEqual(APPROVAL_SETS['Planned?'], ['story.md', 'plan.md']);
  for (const gate of Object.keys(APPROVAL_SETS)) {
    const { trace, artifacts } = fixture(scenario);
    const without = trace.filter((event) => !(event.kind === 'approval' && event.gate === gate));
    assert.equal(evaluate(scenario, without, artifacts).passed, false, gate);
  }
  for (const name of ['plan.md', 'story.md']) {
    const { trace, artifacts } = fixture(scenario);
    const index = trace.findIndex((event) => event.kind === 'action' && event.name === 'implement');
    artifacts[name] = `Changed ${name}\n`;
    trace.splice(index, 0, { kind: 'artifact', path: name, sha256: sha256(artifacts[name]) });
    assert.equal(evaluate(scenario, trace, artifacts).passed, false, `A ${name} that changed after Planned? is not approved.`);
  }
  for (const [name, keep] of [['story.md', 'plan.md'], ['plan.md', 'story.md']]) {
    const old = fixture(scenario);
    const partial = old.trace.map((event) => event.kind === 'approval' && event.gate === 'Planned?'
      ? { ...event, documents: event.documents.filter((doc) => doc.path === keep) } : event);
    assert.equal(evaluate(scenario, partial, old.artifacts).passed, false, `A Planned? approval that omits ${name} does not approve.`);
  }
});

test('an agreed scope change after diagnosis blocks planning until the user decides the scope again, and it voids Planned?', () => {
  const scenario = scenarios.find((entry) => entry.id === 'diagnosis-contradicts-scope');
  const { trace, artifacts } = fixture(scenario);
  const relaxed = { ...scenario, forbiddenActions: [] };
  assert.equal(evaluate(relaxed, [...trace, action('plan')], artifacts).passed, false, 'The old scope decision no longer counts.');
  assert.equal(evaluate(relaxed, [...trace, SCOPE, action('plan')], artifacts).passed, true, 'A new scope decision lets planning continue.');
  assert.equal(evaluate(relaxed, [...trace, SCOPE, action('implement')], artifacts).passed, false, 'The old Planned? approval no longer counts.');
  artifacts['story.md'] = 'Changed scope\n';
  const rescoped = [...trace, SCOPE, { kind: 'artifact', path: 'story.md', sha256: sha256(artifacts['story.md']) }];
  const documents = ['story.md', 'plan.md'].map((name) => ({ path: name, sha256: sha256(artifacts[name] ?? 'Synthetic evidence\n') }));
  rescoped.push({ kind: 'approval', gate: 'Planned?', explicit: true, documents });
  assert.equal(evaluate(relaxed, [...rescoped, action('implement')], artifacts).passed, true, 'A new Planned? approval lets the implementation start.');
  const fresh = fixture(scenario);
  const declined = fresh.trace.map((event) => event.kind === 'decision' && event.subject === 'scope-change' ? { ...event, value: 'declined' } : event);
  assert.equal(evaluate({ ...relaxed, requiredEvents: [] }, [...declined, action('plan')], fresh.artifacts).passed, true, 'A declined change keeps the scope.');
});

test('a combined approval cannot omit linked revisions', () => {
  const scenario = scenarios.find((entry) => entry.id === 'combined-approval');
  const { trace, artifacts } = fixture(scenario);
  const approval = trace.find((event) => event.kind === 'approval' && event.gate === 'Planned?');
  approval.documents = approval.documents.filter((doc) => doc.path !== 'evidence/history.md');
  assert.equal(evaluate(scenario, trace, artifacts).passed, false);
});
test('combined approval goes stale if any listed document changes before the blocked action', () => {
  const scenario = scenarios.find((entry) => entry.id === 'combined-approval');
  const { trace, artifacts } = fixture(scenario);
  trace.splice(trace.length - 1, 0, { kind: 'artifact', path: 'evidence/history.md', sha256: sha256('Changed\n') });
  artifacts['evidence/history.md'] = 'Changed\n';
  assert.equal(evaluate(scenario, trace, artifacts).passed, false);
});

test('external tools need exact per-write approval and a refusal prevents a write or retry', () => {
  const documents = [{ path: 'outbox/comment.draft.md', sha256: sha256('Draft\n') }];
  const trace = [
    { kind: 'artifact', ...documents[0] },
    { kind: 'approval', gate: 'Sendable?', explicit: true, documents, command: 'synthetic comment', target: 'synthetic item' },
    { kind: 'tool', effect: 'external-write', command: 'synthetic comment', target: 'synthetic item' },
  ];
  const scenario = { workflow: 'full-v4' };
  assert.equal(evaluate(scenario, trace, {}).passed, true);
  assert.equal(evaluate(scenario, [...trace, trace[2]], {}).passed, false, 'Retry consumes new approval.');
  assert.equal(evaluate(scenario, [trace[0], trace[1], { ...trace[2], target: 'different item' }], {}).passed, false);
  assert.equal(evaluate(scenario, [trace[0], trace[1], { kind: 'decision', subject: 'external-write', value: 'declined' }, trace[2]], {}).passed, false);
  assert.equal(evaluate(scenario, [{ kind: 'tool', command: 'unclassified' }], {}).passed, false);
});

test('source gaps and declined learning have explicit negative trace checks', () => {
  const unavailable = scenarios.find((entry) => entry.id === 'unavailable-sources');
  let { trace, artifacts } = fixture(unavailable);
  trace.find((event) => event.status === 'unavailable').gap = '';
  assert.equal(evaluate(unavailable, trace, artifacts).passed, false);
  ({ trace, artifacts } = fixture(scenarios.find((entry) => entry.id === 'declined-learning')));
  assert.equal(evaluate({ workflow: 'full-v4' }, [...trace, action('create-learning')], artifacts).passed, false);
  assert.equal(evaluate({ workflow: 'full-v4' }, [{ kind: 'decision', subject: 'learning', value: 'cancelled' }, action('create-learning')], {}).passed, false);
});
