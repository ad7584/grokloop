// Structural materials, with the manufacturing reality attached.
//
// `specificStrength` (yield / density) is what decides tank mass, and on that
// metric carbon fibre wins by a mile. It is included here precisely so the
// solver picks it, discovers what `manufacturingRisks` costs, and has to argue
// its way out. That argument is the product.

export const MATERIALS = {
  'ss-301-fullhard': {
    name: '301 stainless steel, full hard',
    density: 8030,            // kg/m^3
    yieldStrength: 1276,      // MPa, cold-rolled full hard
    cryoBehaviour: 'strengthens',
    maxServiceTempK: 1140,
    confidence: 'published',
    manufacturing: 'Rolled sheet, welded. Weldable in open air without a clean room or autoclave. Sheet stock is a commodity — roughly $3/kg against $50-200/kg for aerospace composite prepreg.',
    manufacturingRisks: ['Weld quality control over very long seams', 'Heavier than aluminium or composite for the same strength unless the cryogenic gain is exploited'],
    note: 'Starship’s choice. Gains yield strength at cryogenic temperature rather than losing it, and keeps useful strength when hot on reentry, which lets the structure double as part of the thermal solution.',
    reuseFriendly: true,
  },
  'al-li-2195': {
    name: 'Aluminium-lithium 2195',
    density: 2700,
    yieldStrength: 570,
    cryoBehaviour: 'strengthens slightly',
    maxServiceTempK: 450,
    confidence: 'published',
    manufacturing: 'Friction stir welded plate. Mature process, flown on the Shuttle external tank and SLS core stage. Requires careful control of weld parameters.',
    manufacturingRisks: ['Loses strength rapidly above ~450K, so it needs full thermal protection everywhere', 'Lithium content makes the alloy expensive and corrosion-sensitive'],
    note: 'The Shuttle external tank and SLS core stage material. Excellent at cryo, useless when hot.',
    reuseFriendly: true,
  },
  'cfrp-im7': {
    name: 'Carbon fibre / epoxy composite (IM7-class)',
    density: 1580,
    yieldStrength: 2500,      // MPa, unidirectional tensile — NOT achievable in a real layup
    cryoBehaviour: 'microcracks',
    maxServiceTempK: 420,
    confidence: 'published',
    manufacturing: 'Automated fibre placement onto a mandrel, then autoclave or oven cure. Very large tanks need very large tooling and there are few facilities on Earth that can build one.',
    manufacturingRisks: [
      'Unidirectional strength is a laboratory figure. A real quasi-isotropic layup delivers roughly 30-50% of it.',
      'Cryogenic thermal cycling drives matrix microcracking, which lets hydrogen and oxygen permeate the wall. This is what ended X-33.',
      'Barely-visible impact damage can halve compressive strength and is hard to inspect between flights.',
      'Joints and penetrations are heavy, which erodes much of the theoretical mass saving.',
    ],
    note: 'The highest specific strength available, and the reason it keeps getting proposed. Also the reason X-33/VentureStar was cancelled after its composite hydrogen tank failed on test in 1999.',
    reuseFriendly: false,
  },
  'ti-6al-4v': {
    name: 'Titanium Ti-6Al-4V',
    density: 4430,
    yieldStrength: 880,
    cryoBehaviour: 'strengthens',
    maxServiceTempK: 700,
    confidence: 'published',
    manufacturing: 'Forged, machined or additively manufactured. Difficult and slow to machine; welding requires an inert atmosphere.',
    manufacturingRisks: ['Expensive raw stock and high scrap rates', 'Ignites in pure oxygen at pressure, so it cannot be used freely in LOX systems'],
    note: 'Used for grid fins and high-load fittings rather than tanks. SpaceX cast titanium grid fins specifically to survive reentry heating without ablating.',
    reuseFriendly: true,
  },
  'inconel-718': {
    name: 'Inconel 718 nickel superalloy',
    density: 8190,
    yieldStrength: 1030,
    cryoBehaviour: 'stable',
    maxServiceTempK: 980,
    confidence: 'published',
    manufacturing: 'Cast, forged or 3D printed. SpaceX prints Inconel combustion chamber components.',
    manufacturingRisks: ['Very heavy', 'Hard to machine'],
    note: 'Hot structure and engine parts, not primary tankage. Retains strength where aluminium has long since failed.',
    reuseFriendly: true,
  },
};

/** Yield strength per unit density — the figure of merit for tank walls. */
export function specificStrength(m) {
  return m.yieldStrength / m.density; // MPa / (kg/m^3)
}

// A quasi-isotropic composite layup cannot deliver unidirectional coupon
// strength. The solver is held to this unless it argues otherwise and the
// argument survives review.
export const COMPOSITE_LAYUP_EFFICIENCY = 0.4;
