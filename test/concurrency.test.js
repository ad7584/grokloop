// Concurrency invariants.
//
// These failed in production, not in testing: three workers started against a
// tree with one node, two of them found it already taken, and declared the
// whole search exhausted one second into the run.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRoot, selectNext, anyExploring, resetIds } from '../src/tree.js';

function tree() {
  resetIds(1);
  const root = createRoot();
  return { 0: root };
}

test('two workers never take the same branch', () => {
  const nodes = tree();
  const first = selectNext(nodes);
  assert.ok(first, 'the first worker gets the root');

  // A step marks its node 'exploring' before it awaits, which is what makes
  // this safe. Simulate that.
  first.status = 'exploring';

  assert.equal(selectNext(nodes), null, 'the second worker must not get the same node');
});

test('a busy tree is distinguishable from a finished one', () => {
  const nodes = tree();
  assert.equal(anyExploring(nodes), false, 'nothing in flight yet');

  nodes[0].status = 'exploring';
  assert.equal(selectNext(nodes), null, 'nothing is selectable...');
  assert.equal(anyExploring(nodes), true, '...but the search is busy, not exhausted');

  // Only once nothing is open AND nothing is in flight is the search over.
  nodes[0].status = 'exhausted';
  assert.equal(selectNext(nodes), null);
  assert.equal(anyExploring(nodes), false, 'now it is genuinely finished');
});

test('workers spread across branches once there are several open', () => {
  resetIds(1);
  const nodes = tree();
  for (let i = 1; i <= 3; i++) {
    nodes[i] = {
      id: i, parentId: 0, depth: 1, status: 'open', bound: 0.05 + i / 1000,
      cursor: { slotIndex: 1, stageIndex: 0 }, label: `branch ${i}`, children: [],
    };
  }
  nodes[0].status = 'expanded';

  const taken = [];
  for (let w = 0; w < 3; w++) {
    const n = selectNext(nodes, { haveIncumbent: true });
    assert.ok(n, `worker ${w} should find work`);
    n.status = 'exploring';
    taken.push(n.id);
  }
  assert.equal(new Set(taken).size, 3, 'three workers, three distinct branches');
  assert.equal(selectNext(nodes, { haveIncumbent: true }), null, 'and then nothing left to take');
});
