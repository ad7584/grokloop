// Calibration against reality.
//
// These are the tests that decide whether anything else in this project is
// worth reading. If the model cannot reproduce a vehicle that actually flies,
// from that vehicle's own declared hardware, then every number the search
// produces is decoration.
//
// Falcon 9 is the calibration vehicle because it is the only launcher with two
// published payload figures for the same hardware — expendable and droneship —
// which pins both the ascent budget AND the cost of recovery.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deliverablePayload, ascentBudget, massRatioFor } from '../src/physics.js';
import { DELTA_V, TRAJECTORY_PENALTY, RECOVERY_DELTA_V } from '../data/constants.js';
import { REFERENCE_VEHICLES, bestFlownStructuralCoefficient } from '../data/reference.js';

// Falcon 9 Block 5, declared masses, vacuum Isp for both stages.
const F9 = [
  { dryMass: 22200, propellantMass: 410900, ispVac: 311 },
  { dryMass: 4000, propellantMass: 107500, ispVac: 348 },
];

test('POINT 1 — Falcon 9 expendable reproduces its published 22,800 kg to LEO', () => {
  const r = deliverablePayload(F9, DELTA_V.toLEO);
  assert.equal(r.achievable, true);
  const err = Math.abs(r.payload - 22800) / 22800;
  assert.ok(err < 0.02,
    `predicted ${Math.round(r.payload)} kg against a published 22,800 kg — ${(err * 100).toFixed(1)}% error`);
});

test('the ascent budget is a measurement, not a chosen number', () => {
  // Stated the other way round: the published hardware plus the published
  // payload imply this budget. If someone edits DELTA_V.toLEO to make a design
  // close, this test fails and says so.
  const withPublishedPayload = deliverablePayload(F9, 1); // force full delta-v at ~0 payload
  assert.ok(withPublishedPayload.payload > 22800,
    'at a trivial delta-v requirement the vehicle should lift far more than its rated payload');

  const r = deliverablePayload(F9, DELTA_V.toLEO);
  assert.ok(Math.abs(r.payload - 22800) / 22800 < 0.02,
    `DELTA_V.toLEO = ${DELTA_V.toLEO} does not reproduce Falcon 9. It is calibration, not a dial.`);
});

test('POINT 2 — all three reuse channels together reproduce the droneship figure', () => {
  // Recovering the booster costs three separate things, and leaving any one out
  // mis-prices reuse:
  //   1. landing propellant          (reserved, and INERT during ascent)
  //   2. landing hardware            (heavier booster: legs, fins, actuators)
  //   3. trajectory de-optimisation  (stage lower and shallower)
  const LANDING_HARDWARE_FACTOR = 1.15;

  const dry = F9[0].dryMass * LANDING_HARDWARE_FACTOR;
  // The landing burn accelerates the empty booster only, never the stack above.
  const landingPropellant = dry * (massRatioFor(RECOVERY_DELTA_V.boosterDownrange.value, F9[0].ispVac) - 1);

  const reusable = [
    {
      dryMass: dry + landingPropellant,                       // carried to burnout, unusable for ascent
      propellantMass: F9[0].propellantMass - landingPropellant,
      ispVac: F9[0].ispVac,
    },
    F9[1],
  ];

  const r = deliverablePayload(reusable, DELTA_V.toLEO + TRAJECTORY_PENALTY.recoveredBooster);
  // Sources quote the droneship figure as 17,500 kg and 18,500 kg, so the
  // target is a band rather than a point.
  assert.ok(r.payload > 16800 && r.payload < 19200,
    `predicted ${Math.round(r.payload)} kg against a published 17,500-18,500 kg droneship range`);

  const expendable = deliverablePayload(F9, DELTA_V.toLEO).payload;
  const penalty = 1 - r.payload / expendable;
  assert.ok(penalty > 0.15 && penalty < 0.30,
    `reuse penalty came out at ${(penalty * 100).toFixed(1)}%; the real figure is ~23%`);
});

test('landing propellant is inert mass, not a surcharge on the whole stack', () => {
  // Charging recovery delta-v to the entire vehicle means the upper stage and
  // payload get pushed through the landing burn too, which never happens. It
  // roughly doubles the apparent cost of reuse and would drive the search to
  // conclude reusability is impossible for reasons that are pure modelling
  // artefact.
  const expendable = deliverablePayload(F9, DELTA_V.toLEO).payload;
  const wrong = deliverablePayload(F9, DELTA_V.toLEO + RECOVERY_DELTA_V.boosterDownrange.value).payload;
  const wrongPenalty = 1 - wrong / expendable;
  assert.ok(wrongPenalty > 0.30,
    `the discredited whole-stack model gives ${(wrongPenalty * 100).toFixed(1)}%, far above the real ~23% — ` +
    `this test exists so nobody reintroduces it`);
});

test('a recovered booster is charged more ascent delta-v than an expended one', () => {
  const stage = (recovery) => ({ stages: [{ recovery }, { recovery: 'orbital' }] });
  assert.equal(ascentBudget(stage('none')), DELTA_V.toLEO);
  assert.equal(ascentBudget(stage('RTLS')), DELTA_V.toLEO + TRAJECTORY_PENALTY.recoveredBooster);
  assert.ok(ascentBudget(stage('RTLS')) > ascentBudget(stage('none')),
    'reuse must never be free in the ascent budget');
});

test('no recovered ORBITAL stage has ever flown, and the data says so', () => {
  const best = bestFlownStructuralCoefficient();
  assert.equal(best.recoveredOrbital, null,
    'nothing has ever reached orbit and come home; this bucket must stay empty');
  assert.ok(best.recoveredSuborbital > 0, 'Falcon 9 stage 1 anchors the suborbital bucket');
  assert.ok(best.expendable > 0, 'Falcon 9 stage 2 anchors the expendable bucket');
  assert.ok(best.expendable < best.recoveredSuborbital,
    'recovery hardware must make a stage structurally worse, never better');
});

test('Starship is excluded from the flown record because it has not flown to orbit', () => {
  const ship = REFERENCE_VEHICLES['starship-v2'];
  assert.equal(ship.unverified, true);
  // Its claimed ship coefficient (85t / 1500t = 0.0536) is better than Falcon 9
  // stage 1. If it were admitted as flight-proven it would silently raise the
  // bar the scrutiny gate checks against, and a design could cite an
  // achievement that has not happened.
  const best = bestFlownStructuralCoefficient();
  assert.ok(best.recoveredSuborbital > 0.05,
    'the suborbital anchor should be Falcon 9 stage 1 (~0.051), not a Starship projection');
});
