import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from './scenarios/evaluator.mjs';
import { sha256 } from '../plugins/forge/scripts/lib/validation.mjs';

const scenarios = JSON.parse(readFileSync(new URL('./fixtures/scenarios.json', import.meta.url), 'utf8'));
const action = (name) => ({ kind: 'action', name });
const source = (name) => ({ kind: 'source', name, status: 'available' });
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
  const approvals = {
    'Understood?': ['context.md', 'history.md'], 'Agreed?': ['interview.md'],
    'Diagnosed?': ['investigation.md'], 'Designed?': ['plan.draft.md', 'plan.md'],
    'Shippable?': ['review.md'], 'Learned?': ['close.draft.md'],
  };
  if (scenario.id === 'legacy-resume') approve('Briefed?', ['context.md', 'interview.md']);
  else for (const [gate, names] of Object.entries(approvals)) {
    if (!scenario.gateAfterActions?.[gate]) approve(gate, names);
  }
  for (const expected of scenario.requiredEvents ?? []) {
    if (expected.kind === 'approval') continue;
    trace.push({ ...expected, ...(expected.status === 'unavailable' ? { gap: 'Synthetic source is unavailable; evidence gap recorded.' } : {}) });
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
  assert.deepEqual(scenarios[0].sequence, scenarios[1].sequence);
});

test('every critical full-workflow gate has a failing missing-approval check', () => {
  const scenario = scenarios[0];
  for (const gate of ['Understood?', 'Agreed?', 'Diagnosed?', 'Designed?', 'Shippable?', 'Learned?']) {
    const { trace, artifacts } = fixture(scenario);
    const without = trace.filter((event) => !(event.kind === 'approval' && event.gate === gate));
    assert.equal(evaluate(scenario, without, artifacts).passed, false, gate);
  }
});

test('a combined approval cannot omit linked revisions', () => {
  const scenario = scenarios.find((entry) => entry.id === 'combined-approval');
  const { trace, artifacts } = fixture(scenario);
  const approval = trace.find((event) => event.kind === 'approval' && event.gate === 'Understood?');
  approval.documents = approval.documents.filter((doc) => doc.path !== 'history.md');
  assert.equal(evaluate(scenario, trace, artifacts).passed, false);
});
test('diagnosis approval cannot follow planning, be implicit, or refer to changed evidence', () => {
  const scenario = scenarios.find((entry) => entry.id === 'mandatory-diagnosis');
  for (const change of ['missing', 'late', 'implicit', 'stale']) {
    const { trace, artifacts } = fixture(scenario);
    const index = trace.findIndex((event) => event.kind === 'approval' && event.gate === 'Diagnosed?');
    const [approval] = trace.splice(index, 1);
    if (change === 'late') trace.push(approval);
    if (change === 'implicit') trace.splice(index, 0, { ...approval, explicit: false });
    if (change === 'stale') trace.splice(index, 0, approval, { kind: 'artifact', path: 'investigation.md', sha256: sha256('Changed\n') });
    assert.equal(evaluate(scenario, trace, artifacts).passed, false, change);
  }
});

test('combined approval goes stale if any listed document changes before the blocked action', () => {
  const scenario = scenarios.find((entry) => entry.id === 'combined-approval');
  const { trace, artifacts } = fixture(scenario);
  trace.splice(trace.length - 1, 0, { kind: 'artifact', path: 'history.md', sha256: sha256('Changed\n') });
  artifacts['history.md'] = 'Changed\n';
  assert.equal(evaluate(scenario, trace, artifacts).passed, false);
});

test('external tools need exact per-write approval and a refusal prevents a write or retry', () => {
  const documents = [{ path: 'outbox/comment.draft.md', sha256: sha256('Draft\n') }];
  const trace = [
    { kind: 'artifact', ...documents[0] },
    { kind: 'approval', gate: 'Sendable?', explicit: true, documents, command: 'synthetic comment', target: 'synthetic item' },
    { kind: 'tool', effect: 'external-write', command: 'synthetic comment', target: 'synthetic item' },
  ];
  const scenario = { workflow: 'full-v1' };
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
  assert.equal(evaluate({ workflow: 'full-v1' }, [...trace, action('create-learning')], artifacts).passed, false);
  assert.equal(evaluate({ workflow: 'full-v1' }, [{ kind: 'decision', subject: 'learning', value: 'cancelled' }, action('create-learning')], {}).passed, false);
});
