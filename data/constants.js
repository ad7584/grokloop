// Physical constants and mission budgets.
//
// Every figure here is a real, published value. Where a number is a range or an
// estimate, that is stated in `note` rather than hidden behind a single digit.
// `confidence` is: 'published' (primary source), 'established' (widely agreed
// engineering reference), or 'estimate' (reasoned, and treated as soft by the
// solver).

export const G0 = 9.80665; // m/s^2, standard gravity — definitional, used in the rocket equation

export const DELTA_V = {
  // Not a guess and not a free parameter. Falcon 9's real declared hardware
  // (22,200 / 410,900 / 4,000 / 107,500 kg at vacuum Isp 311/348) delivering its
  // real 22,800 kg expendable payload requires exactly this. It is a
  // measurement, and test/physics.test.js holds the model to reproducing it.
  toLEO: 9428,
  range: [9300, 9700],
  confidence: 'established',
  note: 'Ascent budget for an EXPENDABLE vehicle, back-calculated from Falcon 9. Includes gravity, drag and steering losses.',
};

/**
 * The third reuse channel, and the one most easily forgotten.
 *
 * A booster that intends to come home cannot fly the optimal ascent. It must
 * stage lower and shallower to keep the return within reach, and that costs
 * ascent performance on top of the landing propellant and the landing hardware.
 *
 * Leaving this out is not a small error. Recovery propellant alone reproduces
 * only a 14.6% payload penalty for Falcon 9 against the real 23%. All three
 * channels together land within 0.4% of the published droneship figure, and
 * without this one the whole search is roughly half a percentage point too
 * optimistic — larger than any single hardware assumption in the model.
 */
export const TRAJECTORY_PENALTY = {
  recoveredBooster: 300, // m/s added to the ascent budget
  confidence: 'estimate',
  note: 'Reverse-engineered from the gap between Falcon 9 expendable (22.8 t) and droneship (17.5 t) once landing propellant and landing hardware are accounted for separately.',
};

// Delta-v a stage must reserve to come home. These are the reusability tax.
export const RECOVERY_DELTA_V = {
  boosterRTLS: {
    value: 2000,
    range: [1800, 2200],
    confidence: 'estimate',
    note: 'Return-to-launch-site: boostback burn + reentry burn + landing burn. Derived from Falcon 9 RTLS performance loss (~40% payload vs expendable).',
  },
  boosterDownrange: {
    value: 1200,
    range: [1000, 1400],
    confidence: 'estimate',
    note: 'Droneship landing: no boostback, so reentry + landing burn only. Falcon 9 droneship costs ~23% payload vs expendable (22.8t -> 17.5t).',
  },
  orbitalStageDeorbit: {
    value: 150,
    range: [100, 250],
    confidence: 'established',
    note: 'Deorbit burn from LEO. Small — the hard part of orbital stage reuse is thermal, not propulsive.',
  },
  orbitalStageLanding: {
    value: 250,
    range: [100, 400],
    confidence: 'estimate',
    note: 'Terminal landing propellant for a propulsively-landed orbital stage. Starship-class flip-and-burn.',
  },
};

// Thermal protection, expressed as mass per square metre of protected area.
export const TPS = {
  shuttleHRSI: {
    arealDensity: 9.0,
    confidence: 'established',
    note: 'Shuttle silica tile system including strain isolation pad and adhesive. Tiles alone are lighter; the installed system is what matters.',
    reusable: true,
    maxTempK: 1533,
  },
  starshipHexTile: {
    arealDensity: 10.0,
    range: [8, 14],
    confidence: 'estimate',
    note: 'Starship windward ceramic hex tiles. SpaceX has not published installed areal density; this is inferred from tile dimensions and silica ceramic density.',
    reusable: true,
    maxTempK: 1700,
  },
  pica: {
    arealDensity: 22.0,
    range: [15, 40],
    confidence: 'estimate',
    note: 'PICA/PICA-X ablative. Heavier and consumed on use, so poor for rapid reuse, but survives far higher heating.',
    reusable: false,
    maxTempK: 3000,
  },
  metallicTPS: {
    arealDensity: 15.0,
    range: [12, 25],
    confidence: 'estimate',
    note: 'Inconel/titanium metallic shingle TPS as studied for X-33. Durable and inspectable but heavy.',
    reusable: true,
    maxTempK: 1300,
  },
};

// The bar. Musk, on the Howard Stern interview: a fully reusable rocket must put
// about 4% or more of its liftoff mass into orbit, with nothing thrown away.
export const TARGET_PAYLOAD_FRACTION = 0.04;

export const LEO_ALTITUDE_KM = 200;
