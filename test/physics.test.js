import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deltaV, massRatioFor, stageMass, stageGeometry,
  evaluate, optimisticBound, recoveryPenalty,
} from '../src/physics.js';
import { PROPELLANTS, bulkDensity } from '../data/propellants.js';
import { REFERENCE_VEHICLES, structuralCoefficient } from '../data/reference.js';
import { TARGET_PAYLOAD_FRACTION } from '../data/constants.js';

test('rocket equation round-trips', () => {
  const dv = deltaV(350, 4);
  assert.ok(Math.abs(massRatioFor(dv, 350) - 4) < 1e-9);
});

test('rocket equation matches a hand-computed case', () => {
  // Isp 300s, mass ratio e -> delta-v is exactly Isp*g0.
  assert.ok(Math.abs(deltaV(300, Math.E) - 300 * 9.80665) < 1e-6);
});

test('stored bulk densities agree with component densities', () => {
  for (const [k, p] of Object.entries(PROPELLANTS)) {
    assert.ok(Math.abs(bulkDensity(p) - p.bulkDensity) < 15, `${k} bulk density drifted`);
  }
});

test('a stage whose dry fraction eats the mass ratio is impossible, not merely heavy', () => {
  // eps 0.25 with a mass ratio near 8 gives r*eps > 1.
  const r = stageMass(1, 9400, 300, 0.25);
  assert.equal(r.impossible, true);
  assert.match(r.reason, /cannot close at any scale/);
});

test('hydrogen tanks are bigger than methane tanks for the same propellant mass', () => {
  const h2 = stageGeometry(100000, 'LOX/LH2', 9);
  const ch4 = stageGeometry(100000, 'LOX/CH4', 9);
  assert.ok(h2.volume > ch4.volume * 2, 'hydrolox should need well over twice the volume');
  assert.ok(h2.surfaceArea > ch4.surfaceArea, 'and therefore more surface to protect');
});

test('recovery penalties are ordered as physics requires', () => {
  assert.ok(recoveryPenalty({ recovery: 'RTLS' }) > recoveryPenalty({ recovery: 'downrange' }));
  assert.equal(recoveryPenalty({ recovery: 'none' }), 0);
});

test('a Starship-like fully reusable design lands near its real payload fraction', () => {
  const r = evaluate({ payloadMass: 100000,
    stages: [
      { name: 'Booster', propellant: 'LOX/CH4', engine: 'raptor-3', engineCount: 33, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery: 'RTLS', tps: null,
        landingHardwareFraction: 0.06, deltaVShare: 0.55 },
      { name: 'Ship', propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: 2, material: 'ss-301-fullhard',
        structuralCoefficient: 0.050, diameter: 9, recovery: 'orbital', tps: 'starshipHexTile',
        landingHardwareFraction: 0.08, deltaVShare: 0.45 },
    ],
  });
  assert.equal(r.valid, true);
  assert.equal(r.closed, true);
  assert.equal(r.fullyReusable, true);
  // Real Starship fully reusable is ~2%. Anything in this band means the model
  // is behaving; wildly outside it means the physics regressed.
  assert.ok(r.payloadFraction > 0.005 && r.payloadFraction < 0.045,
    `payload fraction ${(r.payloadFraction * 100).toFixed(2)}% is outside the plausible band`);
});

test('reuse costs payload: the same design expended beats it', () => {
  // Engine counts differ per variant on purpose: the expended vehicle is much
  // smaller, so the reusable version's engine cluster no longer fits inside its
  // dry mass — the thrust/engine-mass checks are scale-aware, and so is reality.
  const base = (recovery, tps, boosterEngines, shipEngines) => ({ payloadMass: 100000,
    stages: [
      { propellant: 'LOX/CH4', engine: 'raptor-3', engineCount: boosterEngines, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery, tps: null,
        landingHardwareFraction: recovery === 'none' ? 0 : 0.06, deltaVShare: 0.55 },
      { propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: shipEngines, material: 'ss-301-fullhard',
        structuralCoefficient: 0.050, diameter: 9, recovery: recovery === 'none' ? 'none' : 'orbital',
        tps, landingHardwareFraction: recovery === 'none' ? 0 : 0.08, deltaVShare: 0.45 },
    ],
  });
  const reusable = evaluate(base('RTLS', 'starshipHexTile', 33, 2));
  const expended = evaluate(base('none', null, 12, 1));
  assert.equal(reusable.closed, true, reusable.reason);
  assert.equal(expended.closed, true, expended.reason);
  assert.ok(expended.payloadFraction > reusable.payloadFraction,
    'throwing the vehicle away must always deliver more payload');
});

test('a rocket that cannot lift off is refused no matter how well the mass budget closes', () => {
  // The design that once "solved" the whole problem: 2 x RS-25 hydrolox at
  // ~499 t. Its budget closed at 4.01%; its liftoff thrust-to-weight was 0.76.
  const r = evaluate({ payloadMass: 20000,
    stages: [
      { propellant: 'LOX/LH2', engine: 'rs-25', engineCount: 2, material: 'al-li-2195',
        structuralCoefficient: 0.068, diameter: 3.7, recovery: 'RTLS', tps: null,
        landingHardwareFraction: 0.06, deltaVShare: 0.4 },
      { propellant: 'LOX/LH2', engine: 'rs-25', engineCount: 1, material: 'al-li-2195',
        structuralCoefficient: 0.092, diameter: 3.7, recovery: 'orbital', tps: 'shuttleHRSI',
        landingHardwareFraction: 0.05, deltaVShare: 0.6 },
    ],
  });
  assert.equal(r.closed, false);
  assert.match(r.reason, /never leaves the ground/);
});

test('an engine cluster heavier than the dry mass it lives in is refused', () => {
  const r = evaluate({ payloadMass: 5000,
    stages: [
      { propellant: 'LOX/CH4', engine: 'raptor-3', engineCount: 3, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery: 'RTLS', tps: null,
        landingHardwareFraction: 0.06, deltaVShare: 0.55 },
      { propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: 2, material: 'ss-301-fullhard',
        structuralCoefficient: 0.050, diameter: 9, recovery: 'orbital', tps: 'starshipHexTile',
        landingHardwareFraction: 0.08, deltaVShare: 0.45 },
    ],
  });
  assert.equal(r.closed, false);
  assert.match(r.reason, /no budget\s+left for the tanks|% of the stage/);
});

test('the sea-level cheat is rejected', () => {
  const r = evaluate({ payloadMass: 100000,
    stages: [
      { propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: 2, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery: 'RTLS', deltaVShare: 0.55 },
      { propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: 2, material: 'ss-301-fullhard',
        structuralCoefficient: 0.050, diameter: 9, recovery: 'orbital', deltaVShare: 0.45 },
    ],
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /flow-separate/);
});

test('a mismatched engine and propellant is rejected', () => {
  const r = evaluate({ payloadMass: 100000,
    stages: [
      { propellant: 'LOX/LH2', engine: 'raptor-3', engineCount: 33, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery: 'RTLS', deltaVShare: 1.0 },
    ],
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /burns LOX\/CH4/);
});

test('delta-v shares must sum to one', () => {
  const r = evaluate({ payloadMass: 100000,
    stages: [
      { propellant: 'LOX/CH4', engine: 'raptor-3', engineCount: 33, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery: 'RTLS', deltaVShare: 0.5 },
      { propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: 2, material: 'ss-301-fullhard',
        structuralCoefficient: 0.050, diameter: 9, recovery: 'orbital', deltaVShare: 0.3 },
    ],
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /must sum to 1/);
});

test('the optimistic bound is genuinely optimistic', () => {
  const design = { payloadMass: 100000,
    stages: [
      { propellant: 'LOX/CH4', engine: 'raptor-3', engineCount: 33, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery: 'RTLS', tps: null,
        landingHardwareFraction: 0.06, deltaVShare: 0.55 },
      { propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: 2, material: 'ss-301-fullhard',
        structuralCoefficient: 0.050, diameter: 9, recovery: 'orbital', tps: 'starshipHexTile',
        landingHardwareFraction: 0.08, deltaVShare: 0.45 },
    ],
  };
  const actual = evaluate(design);
  const bound = optimisticBound(design, TARGET_PAYLOAD_FRACTION);
  assert.ok(bound.bound >= actual.payloadFraction,
    'a bound below the achieved value would prune live branches');
});

test('SSTO survives the optimistic bound but dies on real numbers', () => {
  // This pairing is the whole reason single-stage-to-orbit keeps getting
  // proposed and keeps failing, and the model must reproduce both halves.
  const bound = optimisticBound({
    payloadMass: 100000,
    stages: [
      { propellant: 'LOX/LH2', engine: null, material: 'al-li-2195',
        structuralCoefficient: null, diameter: 9, recovery: 'RTLS', deltaVShare: 1.0 },
    ],
  }, TARGET_PAYLOAD_FRACTION);
  assert.equal(bound.dead, false,
    'on paper, a 3% structural coefficient on hydrogen clears 4% — the bound must not prune it early');
  assert.ok(bound.bound > TARGET_PAYLOAD_FRACTION);

  const real = evaluate({
    payloadMass: 100000,
    stages: [
      { propellant: 'LOX/LH2', engine: 'rs-25', engineCount: 3, material: 'al-li-2195',
        structuralCoefficient: 0.08, diameter: 9, recovery: 'RTLS', tps: 'shuttleHRSI',
        landingHardwareFraction: 0.06, deltaVShare: 1.0 },
    ],
  });
  assert.equal(real.closed, false, 'with a flight-realistic structural coefficient it cannot close');
  assert.match(real.reason, /cannot close at any scale/);
});

test('thermal protection is a smaller burden on a larger vehicle', () => {
  // Square-cube: TPS scales with area, propellant with volume. This is why
  // payload fraction is not scale-invariant and must not be normalised away.
  // Engine counts scale with the vehicle, because the thrust and engine-mass
  // checks are scale-aware. (A 5 t-payload reusable ship cannot even carry one
  // vacuum Raptor inside its dry mass — itself a square-cube fact — so the
  // small case here is 50 t, the smallest class that closes on this hardware.)
  const design = (payload, boosterEngines, shipEngines) => ({
    payloadMass: payload,
    stages: [
      { propellant: 'LOX/CH4', engine: 'raptor-3', engineCount: boosterEngines, material: 'ss-301-fullhard',
        structuralCoefficient: 0.045, diameter: 9, recovery: 'RTLS', tps: null,
        landingHardwareFraction: 0.06, deltaVShare: 0.55 },
      { propellant: 'LOX/CH4', engine: 'raptor-3-vac', engineCount: shipEngines, material: 'ss-301-fullhard',
        structuralCoefficient: 0.050, diameter: 9, recovery: 'orbital', tps: 'starshipHexTile',
        landingHardwareFraction: 0.08, deltaVShare: 0.45 },
    ],
  });
  const small = evaluate(design(50000, 17, 1));
  const large = evaluate(design(200000, 33, 2));
  assert.equal(small.closed, true, small.reason);
  assert.equal(large.closed, true, large.reason);
  const tpsShare = (r) => r.stages[1].tpsMass / r.stages[1].total;
  assert.ok(tpsShare(large) < tpsShare(small),
    'a bigger orbital stage should carry proportionally less heat shield');
});

test('reference vehicle payload fractions match the published figures', () => {
  const f9 = REFERENCE_VEHICLES['falcon-9-block-5'];
  assert.ok(Math.abs(f9.payloadLEOExpendable / f9.glow - 0.0415) < 0.001);
  assert.ok(Math.abs(f9.payloadLEOReusable / f9.glow - 0.0319) < 0.001);

  const ship = REFERENCE_VEHICLES['starship-v2'];
  assert.ok(Math.abs(ship.payloadLEOReusable / ship.glow - 0.02) < 0.001,
    'Starship fully reusable should be ~2%, the state of the art the loop has to beat');
});

test('the claimed Starship ship coefficient is implausibly good, which is why it is flagged', () => {
  // Recovery hardware — heat shield, flaps, landing propellant, reentry
  // structure — should cost an orbital stage roughly a doubling of its dry mass
  // fraction. SpaceX's published ship figures do not show that cost:
  const ship = structuralCoefficient(REFERENCE_VEHICLES['starship-v2'].stages[1]);
  const f9s2 = structuralCoefficient(REFERENCE_VEHICLES['falcon-9-block-5'].stages[1]);

  assert.ok(ship < f9s2 * 1.6,
    `the claimed recoverable ship (${ship.toFixed(4)}) is barely worse than an EXPENDED stage ` +
    `(${f9s2.toFixed(4)}) despite carrying a full thermal protection system. That is the ` +
    `inconsistency, and it is why this vehicle is marked unverified.`);

  // And it must therefore never be admitted as flight-proven evidence.
  assert.equal(REFERENCE_VEHICLES['starship-v2'].unverified, true);
});
