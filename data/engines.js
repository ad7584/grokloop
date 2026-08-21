// Real, flown or flight-qualified engines.
//
// The solver may only select from this list. It cannot invent an engine — if it
// wants better performance it has to argue for an uprated variant and justify
// the change, which is checked against `theoreticalMaxIsp` for the propellant.

export const ENGINES = {
  'raptor-3': {
    name: 'Raptor 3',
    maker: 'SpaceX',
    propellant: 'LOX/CH4',
    cycle: 'full-flow staged combustion',
    thrustSL: 2745000,      // N
    thrustVac: 2950000,     // N
    ispSL: 327,             // s
    ispVac: 350,            // s
    mass: 1525,             // kg
    chamberPressure: 350,   // bar
    confidence: 'published',
    note: 'Figures from SpaceX statements rather than a released spec sheet. Thrust-to-weight around 183 is the highest of any flown engine, achieved largely by deleting the heat shield and integrating plumbing into castings.',
    sealevel: true,
    restartInFlight: true,
    rapidReuse: true,
  },
  'raptor-3-vac': {
    name: 'Raptor 3 Vacuum',
    maker: 'SpaceX',
    propellant: 'LOX/CH4',
    cycle: 'full-flow staged combustion',
    thrustSL: null,         // cannot be run at sea level: nozzle would flow-separate
    thrustVac: 3200000,
    ispSL: null,
    ispVac: 380,
    mass: 2000,
    chamberPressure: 350,
    confidence: 'estimate',
    note: 'Vacuum-optimised Raptor with a large expansion nozzle. Mass is an estimate; SpaceX has not published it.',
    sealevel: false,
    restartInFlight: true,
    rapidReuse: true,
  },
  'merlin-1d': {
    name: 'Merlin 1D',
    maker: 'SpaceX',
    propellant: 'LOX/RP-1',
    cycle: 'gas generator',
    thrustSL: 845000,
    thrustVac: 981000,
    ispSL: 282,
    ispVac: 311,
    mass: 470,
    chamberPressure: 108,
    confidence: 'published',
    note: 'The most flown reusable engine in history. Gas generator cycle dumps turbine exhaust overboard, costing Isp but keeping the engine simple and cheap.',
    sealevel: true,
    restartInFlight: true,
    rapidReuse: true,
  },
  'merlin-1d-vac': {
    name: 'Merlin 1D Vacuum',
    maker: 'SpaceX',
    propellant: 'LOX/RP-1',
    cycle: 'gas generator',
    thrustSL: null,
    thrustVac: 981000,
    ispSL: null,
    ispVac: 348,
    mass: 490,
    chamberPressure: 108,
    confidence: 'published',
    note: 'Falcon 9 second stage. Niobium alloy nozzle extension, radiatively cooled.',
    sealevel: false,
    restartInFlight: true,
    rapidReuse: true,
  },
  'rs-25': {
    name: 'RS-25',
    maker: 'Aerojet Rocketdyne',
    propellant: 'LOX/LH2',
    cycle: 'staged combustion',
    thrustSL: 1860000,
    thrustVac: 2279000,
    ispSL: 366,
    ispVac: 452,
    mass: 3527,
    chamberPressure: 206,
    confidence: 'published',
    note: 'Space Shuttle Main Engine. Superb Isp, and it was genuinely reused — but refurbishment between flights took months of teardown, which is the opposite of rapid. It also cannot restart in flight, so no landing burn is possible on it.',
    sealevel: true,
    restartInFlight: false,
    rapidReuse: false,
  },
  'rl10c': {
    name: 'RL10C-1',
    maker: 'Aerojet Rocketdyne',
    propellant: 'LOX/LH2',
    cycle: 'expander',
    thrustSL: null,
    thrustVac: 101820,
    ispSL: null,
    ispVac: 449,
    mass: 301,
    chamberPressure: 44,
    confidence: 'published',
    note: 'Upper stage only. The expander cycle does not scale to high thrust because it is limited by how much heat the chamber walls can pick up. Restarts in flight routinely, but no RL10 has ever flown twice.',
    sealevel: false,
    restartInFlight: true,
    rapidReuse: false,
  },
  'be-4': {
    name: 'BE-4',
    maker: 'Blue Origin',
    propellant: 'LOX/CH4',
    cycle: 'oxidiser-rich staged combustion',
    thrustSL: 2400000,
    thrustVac: 2640000,
    ispSL: 310,
    ispVac: 339,
    mass: 3175,
    chamberPressure: 134,
    confidence: 'estimate',
    note: 'Blue Origin has published thrust but not a full performance set. Isp and mass here are widely-cited estimates, not primary figures. Designed for reuse; recovered on New Glenn.',
    sealevel: true,
    restartInFlight: true,
    rapidReuse: true,
  },
};

// Hard physical ceilings. An engine claim above these is not an engineering
// argument, it is a violation of chemistry, and the scrutiny gate rejects it
// outright. These are ideal vacuum Isp for optimal expansion.
export const THEORETICAL_MAX_ISP_VAC = {
  'LOX/CH4': 380,
  'LOX/LH2': 465,
  'LOX/RP-1': 360,
};
