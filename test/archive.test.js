// The archive is the record that outlives the scrolling log, so it has to be
// right before anything lands in it — waiting for a real kill to find out takes
// hours.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { snapshot } from '../src/loop.js';
import { createRoot, resetIds } from '../src/tree.js';

/** A state with one of each terminal outcome, built by hand. */
function stateWith() {
  resetIds(1);
  const root = createRoot();
  const nodes = { 0: root };

  const add = (n) => { nodes[n.id] = n; root.children.push(n.id); return n; };

  add({
    id: 1, parentId: 0, depth: 1, label: 'methalox two-stage', slot: 'architecture',
    status: 'complete', payloadFraction: 0.0231, createdAt: 1000,
    result: { closed: true, glow: 4_300_000 }, blockedReason: null, children: [],
  });
  add({
    id: 2, parentId: 0, depth: 1, label: 'hydrolox SSTO', slot: 'architecture',
    status: 'blocked', createdAt: 2000, children: [],
    blockedReason: 'it would have to be 93.3% fuel by weight. this one is 92.0%',
  });
  add({
    id: 3, parentId: 0, depth: 1, label: 'the winner', slot: 'architecture',
    status: 'solved', payloadFraction: 0.0408, createdAt: 3000,
    result: { closed: true, glow: 5_100_000 }, children: [],
  });
  // An open node is still being worked on and is not a result.
  add({ id: 4, parentId: 0, depth: 1, label: 'still open', status: 'open', createdAt: 4000, children: [] });

  return {
    step: 4, nodes, events: [], currentId: 0, bestId: 3, bestFraction: 0.0408,
    solvedId: 3, spend: {}, lastError: null, startedAt: 0,
  };
}

test('the archive collects finished designs and killed branches, and nothing else', () => {
  const a = snapshot(stateWith()).archive;
  const labels = a.map(x => x.label);

  assert.ok(labels.includes('the winner'));
  assert.ok(labels.includes('methalox two-stage'));
  assert.ok(labels.includes('hydrolox SSTO'));
  assert.ok(!labels.includes('still open'), 'work in progress is not a result');
  assert.equal(a.length, 3);
});

test('the archive is ordered best first, with kills last', () => {
  const a = snapshot(stateWith()).archive;
  assert.equal(a[0].label, 'the winner', 'the solve should lead');
  assert.equal(a[0].payloadFraction, 0.0408);
  assert.equal(a[1].label, 'methalox two-stage');
  assert.equal(a[2].label, 'hydrolox SSTO', 'a killed branch has no fraction and sorts last');
  assert.equal(a[2].payloadFraction, null);
});

test('each archive entry carries what it needs to be read on its own', () => {
  const a = snapshot(stateWith()).archive;
  const killed = a.find(x => x.status === 'blocked');
  assert.match(killed.blockedReason, /93\.3% fuel by weight/,
    'a kill without its reason is just an absence');

  const won = a.find(x => x.status === 'solved');
  assert.equal(won.glow, 5_100_000, 'a result needs its liftoff mass');
  assert.ok(Array.isArray(won.path), 'and the decisions that led to it');
});

test('an empty search produces an empty archive rather than throwing', () => {
  resetIds(1);
  const s = {
    step: 0, nodes: { 0: createRoot() }, events: [], currentId: 0,
    bestId: null, bestFraction: 0, solvedId: null, spend: {}, lastError: null, startedAt: 0,
  };
  assert.deepEqual(snapshot(s).archive, []);
});
