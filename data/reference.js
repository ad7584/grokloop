// Vehicles that have actually flown. These are the yardstick.
//
// The scrutiny gate uses these to answer one question: "has anyone, ever, built
// a stage this good?" A design claiming a structural coefficient better than
// everything in this table is not automatically wrong — but it must say how,
// and the how gets reviewed.

export const REFERENCE_VEHICLES = {
  'falcon-9-block-5': {
    name: 'Falcon 9 Block 5',
    glow: 549054,                 // kg
    payloadLEOExpendable: 22800,  // kg
    payloadLEOReusable: 17500,    // kg, droneship booster recovery
    fullyReusable: false,
    stages: [
      { name: 'Stage 1', dryMass: 22200, propellantMass: 410900, propellant: 'LOX/RP-1', engines: 9, engine: 'merlin-1d', recovered: true, orbital: false },
      { name: 'Stage 2', dryMass: 4000, propellantMass: 107500, propellant: 'LOX/RP-1', engines: 1, engine: 'merlin-1d-vac', recovered: false, orbital: true },
    ],
    confidence: 'established',
    note: 'The calibration vehicle. These masses plus the real 22,800 kg expendable payload pin the ascent budget at 9,428 m/s — that number is a measurement, not a free parameter. The second stage is expended on every flight, so Falcon 9 is not a fully reusable vehicle. Its first stage is recovered but never goes orbital and carries no orbital thermal protection.',
  },
  'starship-v2': {
    name: 'Starship (v2-class)',
    glow: 5000000,
    payloadLEOExpendable: 200000,
    payloadLEOReusable: 100000,
    fullyReusable: true,
    stages: [
      { name: 'Super Heavy', dryMass: 275000, propellantMass: 3400000, propellant: 'LOX/CH4', engines: 33, engine: 'raptor-3', recovered: true, orbital: false },
      { name: 'Ship', dryMass: 85000, propellantMass: 1500000, propellant: 'LOX/CH4', engines: 6, engine: 'raptor-3-vac', recovered: true, orbital: true },
    ],
    confidence: 'estimate',
    unverified: true,
    note: 'PROJECTION, NOT ACHIEVEMENT. As of August 2026 Starship has never reached a stable orbit and no ship has ever been recovered. These masses are SpaceX targets. Worse, they are internally inconsistent: run them through the rocket equation and they imply a fully reusable payload above 200 t (over 4%), while SpaceX quotes 100 t. Something in the published set is wrong, most likely the 85 t ship dry mass. This entry must never be used as evidence that a structural coefficient has been achieved.',
  },
  'space-shuttle': {
    name: 'Space Shuttle',
    glow: 2030000,
    payloadLEOExpendable: null,
    payloadLEOReusable: 24400,
    fullyReusable: false,
    stages: [],
    confidence: 'published',
    note: 'The cautionary tale. Partially reusable, and its payload fraction was ~1.2% — but the orbiter itself was 78,000 kg of recovered hardware. It proved that reusable and RAPIDLY reusable are different problems: refurbishment ran to months and thousands of staff-hours per flight.',
  },
};

/** dry / (dry + propellant). Lower is better. This is the number that matters. */
export function structuralCoefficient(stage) {
  return stage.dryMass / (stage.dryMass + stage.propellantMass);
}

/**
 * The best structural coefficient anyone has actually FLOWN.
 *
 * Three buckets, not two, because they are not comparable:
 *
 *  - expendable: thrown away, no recovery hardware at all.
 *  - recoveredSuborbital: comes home, but stages well below orbital velocity
 *    and carries no orbital thermal protection. Falcon 9's first stage.
 *  - recoveredOrbital: reaches orbit and comes home. NOBODY HAS EVER FLOWN ONE.
 *    This bucket is empty, and that emptiness is the honest answer.
 *
 * Vehicles marked `unverified` are excluded entirely — a target a company has
 * published is not a thing that has been achieved, and letting a projection set
 * the bar is how a search talks itself into a win it has not earned.
 */
export function bestFlownStructuralCoefficient() {
  let expendable = Infinity, recoveredSuborbital = Infinity, recoveredOrbital = Infinity;

  for (const v of Object.values(REFERENCE_VEHICLES)) {
    if (v.unverified) continue;
    for (const s of v.stages) {
      const sc = structuralCoefficient(s);
      if (!s.recovered) expendable = Math.min(expendable, sc);
      else if (s.orbital) recoveredOrbital = Math.min(recoveredOrbital, sc);
      else recoveredSuborbital = Math.min(recoveredSuborbital, sc);
    }
  }

  return {
    expendable: Number.isFinite(expendable) ? expendable : null,
    recoveredSuborbital: Number.isFinite(recoveredSuborbital) ? recoveredSuborbital : null,
    // Deliberately null. There is no empirical anchor here and the gate says so.
    recoveredOrbital: Number.isFinite(recoveredOrbital) ? recoveredOrbital : null,
  };
}
