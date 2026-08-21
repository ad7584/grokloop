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

test('a stage with no legal engine is dead before a model call is made', async () => {
  // Hydrogen: RS-25 cannot restart and was never rapidly reusable; RL10 has
  // never flown twice. So no engine can fly a reusable hydrogen stage, and the
  // search must say so at the engine slot instead of discovering a mismatch
  // sixteen decisions later — which is what produced 297 identical dead ends.
  const { step } = await import('../src/loop.js');
  const { createRoot, makeChild, resetIds } = await import('../src/tree.js');
  resetIds(1);
  const root = createRoot();
  let n = makeChild(root, 'architecture', { label: 'two-stage', value: 'two-stage', stageCount: 2, plain: 'two stages' });
  n = makeChild(n, 'diameter', { label: '9 m', diameter: 9 });
  n = makeChild(n, 'payloadMass', { label: '100 t', payloadMass: 100000 });
  n = makeChild(n, 'propellant', { label: 'hydrolox booster', propellant: 'LOX/LH2', plain: 'hydrogen booster' });
  // Point the cursor at the booster's engine slot.
  n.cursor = { slotIndex: 4, stageIndex: 0 };
  n.status = 'open';
  root.children = [n.id];
  const s = { step: 0, nodes: { 0: root, [n.id]: n }, events: [], currentId: 0, bestId: null,
    bestFraction: 0, solvedId: null, spend: {}, lastError: null, startedAt: 0 };
  root.status = 'expanded';

  const r = await step(s);
  assert.equal(r.blocked, 1);
  assert.equal(r.costUsd, 0, 'no model call should have been made');
  assert.equal(s.nodes[n.id].status, 'blocked');
  assert.match(s.nodes[n.id].plainBlocked, /no hydrogen engine on earth/);
  const ev = s.events.at(-1);
  assert.equal(ev.type, 'blocked');
  assert.equal(ev.trivial, false, 'this kill is a finding and must be postable');
});

test('compatibleEngines applies every mission constraint', async () => {
  const { compatibleEngines } = await import('../src/loop.js');
  assert.deepEqual(compatibleEngines({ propellant: 'LOX/LH2' }, 0), [], 'no reusable sea-level hydrogen engine exists');
  assert.deepEqual(compatibleEngines({ propellant: 'LOX/LH2' }, 1), [], 'nor an upper-stage one');
  assert.deepEqual(compatibleEngines({ propellant: 'LOX/CH4' }, 0).sort(), ['be-4', 'raptor-3'], 'methane booster engines');
  assert.ok(compatibleEngines({ propellant: 'LOX/CH4' }, 1).includes('raptor-3-vac'), 'vacuum Raptor is an upper-stage option');
  assert.ok(!compatibleEngines({ propellant: 'LOX/CH4' }, 0).includes('raptor-3-vac'), 'but never a booster');
  assert.deepEqual(compatibleEngines({ propellant: 'LOX/RP-1' }, 0), ['merlin-1d']);
});
