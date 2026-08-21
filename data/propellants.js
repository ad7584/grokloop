// Propellant combinations. Densities are at normal boiling point unless noted.
//
// Density is the quiet villain of launch vehicle design: hydrogen has the best
// specific impulse by a wide margin and the worst density by a wider one, so the
// tanks grow, the structure grows, and the gain is eaten. The solver needs real
// densities to see that happen rather than being told about it.

export const PROPELLANTS = {
  'LOX/CH4': {
    name: 'Liquid oxygen / liquid methane',
    short: 'methalox',
    oxidiserDensity: 1141,   // kg/m^3, LOX at 90K
    fuelDensity: 422,        // kg/m^3, LCH4 at 111K
    mixtureRatio: 3.6,       // oxidiser:fuel by mass, typical for full-flow staged combustion
    bulkDensity: 828,        // kg/m^3, computed from the above at MR 3.6
    confidence: 'published',
    note: 'Raptor, BE-4. Good density, clean-burning enough for rapid reuse, and manufacturable on Mars via Sabatier.',
    coking: false,
    deepCryo: false,
  },
  'LOX/LH2': {
    name: 'Liquid oxygen / liquid hydrogen',
    short: 'hydrolox',
    oxidiserDensity: 1141,
    fuelDensity: 71,         // kg/m^3, LH2 at 20K — the problem in one number
    mixtureRatio: 6.0,
    bulkDensity: 358,
    confidence: 'published',
    note: 'RS-25, RL10. Highest Isp available chemically, but bulk density is less than half of methalox, so tanks and dry mass balloon. Also needs heavy insulation and leaks through everything.',
    coking: false,
    deepCryo: true,
  },
  'LOX/RP-1': {
    name: 'Liquid oxygen / refined kerosene',
    short: 'kerolox',
    oxidiserDensity: 1141,
    fuelDensity: 810,
    mixtureRatio: 2.56,
    bulkDensity: 1030,
    confidence: 'published',
    note: 'Merlin. Densest of the three, so the smallest tanks, but lowest Isp and RP-1 coking deposits make rapid reuse of the engine harder.',
    coking: true,
    deepCryo: false,
  },
};

/** Bulk density of the loaded propellant at a given mixture ratio. */
export function bulkDensity(p) {
  const mr = p.mixtureRatio;
  // 1 kg fuel + mr kg oxidiser occupies 1/fuelDensity + mr/oxidiserDensity m^3
  const volumePerKgFuel = 1 / p.fuelDensity + mr / p.oxidiserDensity;
  return (1 + mr) / volumePerKgFuel;
}
