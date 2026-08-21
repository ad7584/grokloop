// The search tree.
//
// One node is one committed decision. The path from the root to a node is a
// partial vehicle. The loop walks down committing choices, and when a branch is
// shown to be dead it walks back up and takes a different one — which is the
// thing the site is actually for. The backtrack is not a UI flourish, it is the
// search working.
//
// Pruning is done by the optimistic bound in physics.js, never by the model. A
// branch is only ever declared dead by arithmetic.

import { optimisticBound, boundWorkings, evaluate } from './physics.js';
import { scrutinise } from './scrutiny.js';
import { TARGET_PAYLOAD_FRACTION } from '../data/constants.js';

/**
 * The order decisions get made in. Each slot is one question put to the model,
 * which is why they are small and concrete: a question with four plausible
 * answers produces a real fork, a question with forty produces noise.
 */
export const SLOTS = [
  { key: 'architecture', scope: 'vehicle', short: 'how many stages',
    question: 'How many stages, and what overall architecture?' },
  { key: 'diameter', scope: 'vehicle', short: 'how wide to build it',
    question: 'What vehicle diameter? This sets tank volume and, through surface area, thermal protection mass.' },
  { key: 'payloadMass', scope: 'vehicle', short: 'what size of rocket',
    question: 'What payload class is this vehicle sized for? Thermal protection scales with area, so vehicle size changes the achievable fraction.' },
  { key: 'propellant', scope: 'stage', short: 'which fuel',
    question: 'Which propellant combination for this stage?' },
  { key: 'engine', scope: 'stage', short: 'which engine',
    question: 'Which engine for this stage?' },
  { key: 'material', scope: 'stage', short: 'what to build the tanks from',
    question: 'Which primary structural material, and what structural coefficient does it deliver? If the claim beats what has flown, give the manufacturing route.' },
  { key: 'recovery', scope: 'stage', short: 'how this stage comes home',
    question: 'How does this stage come home, and what does that cost in landing hardware and thermal protection?' },
  { key: 'deltaVSplit', scope: 'vehicle', short: 'how to split the work between stages',
    question: 'How is the ascent delta-v divided between the stages?' },
];

let nextId = 1;
export function resetIds(n = 1) { nextId = n; }

export function createRoot() {
  return {
    id: 0,
    parentId: null,
    depth: 0,
    slot: null,
    choice: null,
    label: 'clean sheet',
    reasoning: 'Nothing committed. Every architecture is still open.',
    design: { stages: [] },
    cursor: { slotIndex: 0, stageIndex: 0 },
    status: 'open',
    bound: null,
    children: [],
    createdAt: Date.now(),
  };
}

/** Apply one choice to a partial design, returning a new one. */
export function applyChoice(design, cursor, slotKey, choice) {
  const d = structuredClone(design);
  const si = cursor.stageIndex;

  switch (slotKey) {
    case 'architecture':
      d.stages = Array.from({ length: choice.stageCount }, (_, i) => ({
        name: choice.stageCount === 1 ? 'Single stage'
          : i === 0 ? 'Booster'
          : i === choice.stageCount - 1 ? 'Upper stage'
          : `Stage ${i + 1}`,
      }));
      d.architecture = choice.value;
      break;
    case 'diameter':
      d.stages.forEach(s => { s.diameter = choice.diameter; });
      break;
    case 'payloadMass':
      d.payloadMass = choice.payloadMass;
      break;
    case 'propellant':
      d.stages[si].propellant = choice.propellant;
      break;
    case 'engine':
      d.stages[si].engine = choice.engine;
      d.stages[si].engineCount = choice.engineCount ?? null;
      break;
    case 'material':
      d.stages[si].material = choice.material;
      d.stages[si].structuralCoefficient = choice.structuralCoefficient;
      d.stages[si].structuralJustification = choice.justification ?? null;
      d.stages[si].materialJustification = choice.justification ?? null;
      break;
    case 'recovery':
      d.stages[si].recovery = choice.recovery;
      d.stages[si].tps = choice.tps ?? null;
      d.stages[si].landingHardwareFraction = choice.landingHardwareFraction ?? 0;
      d.stages[si].tpsJustification = choice.justification ?? null;
      break;
    case 'deltaVSplit':
      choice.shares.forEach((sh, i) => { if (d.stages[i]) d.stages[i].deltaVShare = sh; });
      break;
  }
  return d;
}

/** Where the next question lands: walk stage-scoped slots once per stage. */
export function advanceCursor(cursor, design) {
  const slot = SLOTS[cursor.slotIndex];
  const stageCount = design.stages?.length ?? 0;

  if (slot.scope === 'stage' && cursor.stageIndex < stageCount - 1) {
    return { slotIndex: cursor.slotIndex, stageIndex: cursor.stageIndex + 1 };
  }
  return { slotIndex: cursor.slotIndex + 1, stageIndex: 0 };
}

export function isComplete(cursor) {
  return cursor.slotIndex >= SLOTS.length;
}

/**
 * Turn a choice into a child node, and let arithmetic decide whether it lives.
 *
 * A node is born 'open'. It becomes 'blocked' only when the optimistic bound —
 * every remaining decision going as well as physics permits — still cannot
 * reach the target. That is a genuine dead end, not a guess.
 */
export function makeChild(parent, slotKey, choice) {
  const design = applyChoice(parent.design, parent.cursor, slotKey, choice);
  const cursor = advanceCursor(parent.cursor, design);

  const node = {
    id: nextId++,
    parentId: parent.id,
    depth: parent.depth + 1,
    slot: slotKey,
    choice,
    label: choice.label,
    reasoning: choice.reasoning ?? '',
    plain: choice.plain ?? '',   // the one-line version, written for a general reader
    design,
    cursor,
    status: 'open',
    bound: null,
    blockedReason: null,
    result: null,
    children: [],
    createdAt: Date.now(),
  };

  // Only bound once the vehicle has enough shape for the maths to mean anything.
  const boundable = design.stages.length > 0 && design.stages.every(s => s.recovery !== undefined || s.propellant);
  if (design.stages.length > 0) {
    try {
      const b = optimisticBound(design, TARGET_PAYLOAD_FRACTION);
      node.bound = b.bound;
      // Keep the arithmetic, not just its conclusion.
      try { node.workings = boundWorkings(design, TARGET_PAYLOAD_FRACTION).lines; } catch { /* partial design */ }
      if (b.dead && boundable) {
        node.status = 'blocked';
        node.blockedReason = b.reason
          ? b.reason
          : `even with a structural coefficient better than any stage ever flown and the ` +
            `theoretical Isp ceiling for its propellant, this branch tops out at ` +
            `${(b.bound * 100).toFixed(2)}% — below the ${(TARGET_PAYLOAD_FRACTION * 100).toFixed(0)}% target`;
        // The same verdict for a reader who does not know what a coefficient is.
        node.plainBlocked = b.plain
          ? b.plain
          : `even with perfect tanks and perfect engines this path tops out at ` +
            `${(b.bound * 100).toFixed(2)}%. needs ${(TARGET_PAYLOAD_FRACTION * 100).toFixed(0)}%`;
      }
    } catch {
      // A partial design too sparse to bound is simply not bounded yet.
    }
  }

  if (isComplete(cursor) && node.status === 'open') {
    finalise(node);
  }

  return node;
}

/** A complete design: run the real numbers and the scrutiny gate. */
export function finalise(node) {
  const result = evaluate(node.design);
  node.result = result;

  if (!result.valid) {
    node.status = 'blocked';
    node.blockedReason = result.reason;
    node.trivial = true;  // an incompatible combination, not a physics verdict
    return node;
  }
  if (!result.closed) {
    node.status = 'blocked';
    node.blockedReason = result.reason;
    node.plainBlocked = result.plain ?? null;
    return node;
  }

  const gate = scrutinise(node.design);
  node.scrutiny = gate;

  if (!gate.passed) {
    node.status = 'blocked';
    node.blockedReason = gate.violations[0]
      ?? (gate.unjustified[0].message + ' No manufacturing route was given.');
    return node;
  }

  node.payloadFraction = result.payloadFraction;
  node.status = result.payloadFraction >= TARGET_PAYLOAD_FRACTION ? 'solved' : 'complete';
  if (node.status === 'complete') {
    node.blockedReason =
      `closes at ${(result.payloadFraction * 100).toFixed(2)}% — a real vehicle, but short of ` +
      `${(TARGET_PAYLOAD_FRACTION * 100).toFixed(0)}%`;
  }
  return node;
}

/**
 * Pick where to work next: the open node with the best optimistic bound, and
 * deepest as a tie-break so the search finishes a line of thought rather than
 * skimming. Returns null when every branch is exhausted.
 */
/** True when work is in flight elsewhere, so "nothing open" means busy, not done. */
export function anyExploring(nodes) {
  return Object.values(nodes).some(n => n.status === 'exploring');
}

export function selectNext(nodes, { haveIncumbent = false } = {}) {
  const open = Object.values(nodes).filter(n => n.status === 'open' && !isComplete(n.cursor));
  if (!open.length) return null;

  /* Two phases, because branch-and-bound without an incumbent is just breadth.
   *
   * Until one design has been carried all the way through and scored, there is
   * no best-known value to bound against, so pure best-bound selection fans out
   * sideways forever — measured at 23 propellant decisions against a single
   * engine decision, with no complete vehicle after 20 steps and nothing on the
   * site to look at.
   *
   * So: dive first. Take the deepest open node and drive it to a finished
   * design. Once there is something to beat, switch to best-bound, which is
   * the right rule for finding the OPTIMUM rather than merely an answer. */
  if (!haveIncumbent) {
    open.sort((a, b) => b.depth - a.depth || (b.bound ?? 1) - (a.bound ?? 1) || a.id - b.id);
  } else {
    open.sort((a, b) => (b.bound ?? 1) - (a.bound ?? 1) || b.depth - a.depth || a.id - b.id);
  }
  return open[0];
}

/** The chain of committed decisions from the root down to a node. */
export function pathTo(nodes, id) {
  const path = [];
  let cur = nodes[id];
  while (cur && cur.parentId !== null) {
    path.unshift(cur);
    cur = nodes[cur.parentId];
  }
  return path;
}

/** True when the next step is a jump to a different branch, not a step down. */
export function isBacktrack(nodes, fromId, toId) {
  if (fromId == null || toId == null) return false;
  const to = nodes[toId];
  return to.parentId !== fromId;
}
