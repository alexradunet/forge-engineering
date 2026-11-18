import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from './scenarios/evaluator.mjs';
import { sha256 } from '../plugins/forge/scripts/lib/validation.mjs';

const scenarios = JSON.parse(readFileSync(new URL('./fixtures/scenarios.json', import.meta.url), 'utf8'));
const action = (name) => ({ kind: 'action', name });
const source = (name) => ({ kind: 'source', name, status: 'available' });
const APPROVAL_SETS = { 'Scoped?': ['story.md'], 'Planned?': ['plan.md'], 'Shippable?': ['review.md'], 'Learned?': ['close.md'] };
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
  for (const name of scenario.sequence ?? []) {
    trace.push(action(name));
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
  assert.ok(scenarios.every((entry) => entry.workflow === 'full-v3'), 'Forge supports only full-v3.');
  const v3 = scenarios.filter((entry) => entry.workflow === 'full-v3' && entry.id.endsWith('-full-research'));
  assert.equal(v3.length, 2);
  assert.deepEqual(v3[0].sequence, v3[1].sequence);
});

test('full-v3 approves one document for each gate, and a changed plan blocks the implementation', () => {
  const scenario = scenarios.find((entry) => entry.id === 'v3-small-fix-full-research');
  for (const gate of Object.keys(APPROVAL_SETS)) {
    const { trace, artifacts } = fixture(scenario);
    const without = trace.filter((event) => !(event.kind === 'approval' && event.gate === gate));
    assert.equal(evaluate(scenario, without, artifacts).passed, false, gate);
  }
  const { trace, artifacts } = fixture(scenario);
  const index = trace.findIndex((event) => event.kind === 'action' && event.name === 'implement');
  artifacts['plan.md'] = 'Changed plan\n';
  trace.splice(index, 0, { kind: 'artifact', path: 'plan.md', sha256: sha256(artifacts['plan.md']) });
  assert.equal(evaluate(scenario, trace, artifacts).passed, false, 'A plan that changed after Planned? is not approved.');
  const old = fixture(scenario);
  const swapped = old.trace.map((event) => event.kind === 'approval' && event.gate === 'Scoped?'
    ? { ...event, documents: ['scope.md', 'context.md', 'interview.md'].map((name) => ({ path: name, sha256: sha256('x') })) } : event);
  assert.equal(evaluate(scenario, swapped, old.artifacts).passed, false, 'The document set of the removed full-v2 layout does not approve a full-v3 scope.');
});

test('an agreed scope change after diagnosis blocks planning until Scoped? is approved again', () => {
  const scenario = scenarios.find((entry) => entry.id === 'diagnosis-contradicts-scope');
  const { trace, artifacts } = fixture(scenario);
  const relaxed = { ...scenario, forbiddenActions: [] };
  assert.equal(evaluate(relaxed, [...trace, action('plan')], artifacts).passed, false, 'The old scope approval no longer counts.');
  artifacts['story.md'] = 'Changed scope\n';
  const rescoped = [...trace, { kind: 'artifact', path: 'story.md', sha256: sha256(artifacts['story.md']) }];
  rescoped.push({ kind: 'approval', gate: 'Scoped?', explicit: true, documents: [{ path: 'story.md', sha256: sha256(artifacts['story.md']) }] });
  assert.equal(evaluate(relaxed, [...rescoped, action('plan')], artifacts).passed, true);
  const fresh = fixture(scenario);
  const declined = fresh.trace.map((event) => event.kind === 'decision' && event.subject === 'scope-change' ? { ...event, value: 'declined' } : event);
  assert.equal(evaluate({ ...relaxed, requiredEvents: [] }, [...declined, action('plan')], fresh.artifacts).passed, true, 'A declined change keeps the scope.');
});

test('a combined approval cannot omit linked revisions', () => {
  const scenario = scenarios.find((entry) => entry.id === 'combined-approval');
  const { trace, artifacts } = fixture(scenario);
  const approval = trace.find((event) => event.kind === 'approval' && event.gate === 'Scoped?');
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
  const scenario = { workflow: 'full-v3' };
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
  assert.equal(evaluate({ workflow: 'full-v3' }, [...trace, action('create-learning')], artifacts).passed, false);
  assert.equal(evaluate({ workflow: 'full-v3' }, [{ kind: 'decision', subject: 'learning', value: 'cancelled' }, action('create-learning')], {}).passed, false);
});
