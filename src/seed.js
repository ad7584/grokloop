// Render check only.
//
// Builds one known design through the REAL solver and writes it into state so
// the website can be verified without spending a model call. The events it
// writes are labelled as a render check so they can never be mistaken for
// research the loop actually did. `npm run reset` clears it.

import { loadEnv } from './env.js';
loadEnv();

import { load, save } from './loop.js';
import { createRoot, makeChild, resetIds } from './tree.js';
import { evaluate } from './physics.js';

const DESIGN = {
  payloadMass: 100000,
  architecture: 'two-stage, both stages recovered',
  stages: [
    { name: 'Booster', propellant: 'LOX/CH4', engine: 'raptor-3', engineCount: 33,
      material: 'ss-301-fullhard', structuralCoefficient: 0.075, diameter: 9,
      recovery: 'RTLS', tps: null, landingHardwareFraction: 0.06, deltaVShare: 0.55 },
    { name: 'Upper stage', propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: 3,
      material: 'ss-301-fullhard', structuralCoefficient: 0.054, diameter: 9,
      recovery: 'orbital', tps: 'starshipHexTile', landingHardwareFraction: 0.08, deltaVShare: 0.45 },
  ],
};

const result = evaluate(DESIGN);
if (!result.closed) {
  console.error('seed design does not close:', result.reason);
  process.exit(1);
}

resetIds(1);
const root = createRoot();
const s = load();
s.nodes = { 0: root };

const node = makeChild(root, 'architecture', {
  label: 'RENDER CHECK — Starship-class, published masses',
  value: 'two-stage', stageCount: 2,
  reasoning: 'Seeded locally to verify the renderer. Not produced by the model.',
});
node.design = DESIGN;
node.result = result;
node.payloadFraction = result.payloadFraction;
node.status = 'complete';
s.nodes[node.id] = node;
root.children = [node.id];

s.bestId = node.id;
s.bestFraction = result.payloadFraction;
s.currentId = node.id;
s.step = 1;
s.events = [
  { type: 'question', at: Date.now() - 3000, message: 'RENDER CHECK — seeded state, not model output' },
  { type: 'branch', at: Date.now() - 2000, message: 'RENDER CHECK — Starship-class, published masses',
    reasoning: 'Seeded locally to verify the renderer and the parts table.' },
  { type: 'best', at: Date.now() - 1000,
    message: `seeded design closes at ${(result.payloadFraction * 100).toFixed(2)}% fully reusable` },
];

save(s);
console.log(`seeded. payload fraction ${(result.payloadFraction * 100).toFixed(2)}%, GLOW ${Math.round(result.glow / 1000)} t`);
console.log('run "npm run reset" to clear this before any real run.');
