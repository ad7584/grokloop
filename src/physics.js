// The arithmetic. Nothing here asks a model anything.
//
// Grok chooses WHAT to try. This file decides whether it closes. That split is
// the whole integrity story: a language model is very good at confident prose
// about aerospace, and it cannot talk its way past a mass budget that does not
// balance.

import { G0, DELTA_V, RECOVERY_DELTA_V, TRAJECTORY_PENALTY, TPS } from '../data/constants.js';
import { PROPELLANTS, bulkDensity } from '../data/propellants.js';
import { ENGINES, THEORETICAL_MAX_ISP_VAC } from '../data/engines.js';
import { MATERIALS } from '../data/materials.js';

/** Tsiolkovsky. Delta-v from exhaust velocity and mass ratio. */
export function deltaV(isp, massRatio) {
  return isp * G0 * Math.log(massRatio);
}

/** The inverse: mass ratio needed to buy a given delta-v. */
export function massRatioFor(dv, isp) {
  return Math.exp(dv / (isp * G0));
}

/**
 * Mass of one stage, given what it must carry and what it must achieve.
 *
 *   m_s = m_payload * (r - 1) / (1 - r*eps)
 *
 * where r is the required mass ratio and eps the structural coefficient. If
 * r*eps >= 1 the stage cannot close at ANY size — the structure alone weighs
 * more than the mass ratio permits. That is not a large number, it is an
 * impossibility, and it is the most common way a design dies.
 */
export function stageMass(payloadMass, dv, isp, eps) {
  const r = massRatioFor(dv, isp);
  const denom = 1 - r * eps;
  if (denom <= 0) {
    /* Two statements of the same fact. The technical one goes on the site,
     * where the audience wants the coefficient. The plain one goes to X, where
     * "structural coefficient 0.08 exceeds 1/r" means nothing and "it would have
     * to be 93% fuel by weight" means everything. Neither is a simplification
     * of the other — they are the same arithmetic said twice. */
    const needFuelPct = (1 - 1 / r) * 100;
    const hasFuelPct = (1 - eps) * 100;
    return {
      impossible: true, r, eps,
      reason: `structural coefficient ${eps.toFixed(4)} cannot buy ${Math.round(dv)} m/s at Isp ${Math.round(isp)}s: `
        + `the required mass ratio of ${r.toFixed(2)} times the dry fraction exceeds one, `
        + `so the stage cannot close at any scale`,
      plain: `it would have to be ${needFuelPct.toFixed(1)}% fuel by weight. this one is ${hasFuelPct.toFixed(1)}%. `
        + `no size of rocket fixes that`,
    };
  }
  const total = payloadMass * (r - 1) / denom;
  return { impossible: false, total, dry: total * eps, propellant: total * (1 - eps), r };
}

/**
 * Vehicle geometry from propellant volume. A cylinder with hemispherical ends.
 *
 * If the propellant will not even fill the two end domes, the stage is not that
 * wide — it is a sphere of the volume it actually needs. Clamping the barrel to
 * zero instead would report a fixed surface area for every small stage, which
 * silently breaks every area-scaled term downstream.
 */
export function stageGeometry(propellantMass, propellantKey, diameter, ullage = 1.08) {
  const rho = bulkDensity(PROPELLANTS[propellantKey]);
  const volume = (propellantMass / rho) * ullage;
  const domeVolume = (2 / 3) * Math.PI * Math.pow(diameter / 2, 3) * 2;

  let surfaceArea, barrelLength, totalLength, effectiveDiameter;

  if (volume <= domeVolume) {
    const r = Math.cbrt((3 * volume) / (4 * Math.PI));
    surfaceArea = 4 * Math.PI * r * r;
    barrelLength = 0;
    totalLength = 2 * r;
    effectiveDiameter = 2 * r;
  } else {
    const csArea = Math.PI * diameter * diameter / 4;
    barrelLength = (volume - domeVolume) / csArea;
    const barrelArea = Math.PI * diameter * barrelLength;
    const domeArea = 4 * Math.PI * Math.pow(diameter / 2, 2);
    surfaceArea = barrelArea + domeArea;
    totalLength = barrelLength + diameter;
    effectiveDiameter = diameter;
  }

  return {
    volume,
    barrelLength,
    totalLength,
    effectiveDiameter,
    surfaceArea,
    // Roughly half the vehicle faces the flow during reentry.
    windwardArea: surfaceArea * 0.5,
  };
}

/**
 * Effective structural coefficient once reuse hardware is added.
 *
 * Solved iteratively because it is circular: thermal protection mass depends on
 * area, area depends on tank volume, volume depends on propellant mass, and
 * propellant mass depends on the very coefficient being solved for. Twenty
 * passes is far more than enough to converge.
 */
export function effectiveStructure(stage, payloadMass, dv, isp) {
  const baseEps = stage.structuralCoefficient;
  const tps = stage.tps ? TPS[stage.tps] : null;
  const landingFraction = stage.landingHardwareFraction ?? 0;
  const recoveryDv = recoveryPenalty(stage);

  /* Landing propellant is INERT MASS during ascent, not a delta-v surcharge on
   * the whole stack. The landing burn happens after separation and accelerates
   * only the empty booster — it never pushes the upper stage or the payload.
   *
   * Charging recovery delta-v to the full vehicle instead makes reuse look
   * roughly 37% expensive against Falcon 9's real 23%, which would push the
   * search to conclude that reusability is impossible for reasons that are an
   * artefact of the model rather than of physics. */
  const landingRatio = recoveryDv > 0 ? massRatioFor(recoveryDv, isp) - 1 : 0;

  const parts = (total, propellantForGeometry) => {
    const geom = stageGeometry(propellantForGeometry, stage.propellant, stage.diameter);
    const tpsMass = tps ? geom.windwardArea * tps.arealDensity : 0;
    const baseDry = total * baseEps;
    const landingMass = baseDry * landingFraction;
    const inert = baseDry + tpsMass + landingMass;
    const landingPropellant = inert * landingRatio;
    return { geom, tpsMass, baseDry, landingMass, inert, landingPropellant,
             burnoutMass: inert + landingPropellant };
  };

  let eps = baseEps;
  let last = null;

  for (let i = 0; i < 20; i++) {
    const m = stageMass(payloadMass, dv, isp, eps);
    if (m.impossible) return { impossible: true, reason: m.reason, plain: m.plain, eps };

    const p = parts(m.total, m.propellant);
    const ascentPropellant = m.total - p.burnoutMass;
    if (ascentPropellant <= 0) {
      return { impossible: true, eps, reason:
        `once thermal protection, landing hardware and landing propellant are carried, ` +
        `no propellant is left for ascent` };
    }
    const newEps = p.burnoutMass / (p.burnoutMass + ascentPropellant);

    if (last !== null && Math.abs(newEps - last) < 1e-7) break;
    last = newEps;
    eps = newEps;
  }

  const final = stageMass(payloadMass, dv, isp, eps);
  if (final.impossible) return { impossible: true, reason: final.reason, plain: final.plain, eps };

  const p = parts(final.total, final.propellant);

  return {
    impossible: false,
    eps,
    total: final.total,
    dry: p.burnoutMass,
    propellant: final.total - p.burnoutMass,
    baseDry: p.baseDry,
    tpsMass: p.tpsMass,
    landingMass: p.landingMass,
    landingPropellant: p.landingPropellant,
    recoveryDv,
    geometry: p.geom,
    massRatio: final.r,
  };
}

/**
 * Total ascent budget, which is NOT a constant.
 *
 * A vehicle whose booster comes home flies a worse ascent than one that throws
 * it away. Charging the same budget to both is the single most effective way to
 * make full reusability look easier than it is.
 */
export function ascentBudget(design) {
  const boosterRecovered = design.stages?.[0]?.recovery && design.stages[0].recovery !== 'none';
  return DELTA_V.toLEO + (boosterRecovered ? TRAJECTORY_PENALTY.recoveredBooster : 0);
}

/** Delta-v this stage must reserve in order to come home. */
export function recoveryPenalty(stage) {
  switch (stage.recovery) {
    case 'RTLS':      return RECOVERY_DELTA_V.boosterRTLS.value;
    case 'downrange': return RECOVERY_DELTA_V.boosterDownrange.value;
    case 'orbital':   return RECOVERY_DELTA_V.orbitalStageDeorbit.value + RECOVERY_DELTA_V.orbitalStageLanding.value;
    case 'none':      return 0;
    default:          return 0;
  }
}

/**
 * Forward model: given REAL stage hardware, what payload does it deliver?
 *
 * This is the inverse of evaluate() and exists to be checked against reality.
 * Feed it Falcon 9's declared masses and it must return Falcon 9's declared
 * payload — if it does not, the model is wrong and nothing built on it can be
 * trusted. Solved by bisection because the delta-v sum is monotonic in payload.
 *
 * `stages` are bottom-up: [{ dryMass, propellantMass, ispVac }].
 */
export function deliverablePayload(stages, budgetMs, { hi = 1e7, iterations = 200 } = {}) {
  const totalDeltaV = (payload) => {
    let dv = 0;
    // Everything above stage i rides on it, so accumulate from the top down.
    for (let i = 0; i < stages.length; i++) {
      let above = payload;
      for (let j = i + 1; j < stages.length; j++) {
        above += stages[j].dryMass + stages[j].propellantMass;
      }
      const m0 = above + stages[i].dryMass + stages[i].propellantMass;
      const mf = above + stages[i].dryMass;
      dv += stages[i].ispVac * G0 * Math.log(m0 / mf);
    }
    return dv;
  };

  // More payload means less delta-v, so bisect downward on the budget.
  let lo = 0, high = hi;
  if (totalDeltaV(lo) < budgetMs) return { payload: 0, achievable: false, deltaVAtZero: totalDeltaV(0) };
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + high) / 2;
    if (totalDeltaV(mid) >= budgetMs) lo = mid; else high = mid;
  }
  return { payload: lo, achievable: true, deltaV: totalDeltaV(lo) };
}

/**
 * Score a complete design. Works top-down: the upper stage carries the payload,
 * the lower stage carries the upper stage and its payload.
 *
 * Payload mass is ABSOLUTE, in kilograms, and that matters. Payload fraction
 * would be scale-invariant if every mass scaled with the vehicle — but thermal
 * protection scales with surface AREA, so it shrinks as a fraction of a larger
 * vehicle. That square-cube effect is one of the real reasons a big vehicle is
 * easier to make reusable than a small one, and normalising it away would hide
 * the single most important scaling law in the problem.
 */
export function evaluate(design) {
  const stages = design.stages;
  if (!stages || !stages.length) return { valid: false, reason: 'no stages' };

  const payloadMass = design.payloadMass ?? 100000;
  if (!(payloadMass > 0)) return { valid: false, reason: 'payload mass must be positive' };

  const shareSum = stages.reduce((a, s) => a + s.deltaVShare, 0);
  if (Math.abs(shareSum - 1) > 0.001) {
    return { valid: false, reason: `delta-v shares sum to ${shareSum.toFixed(3)}, and must sum to 1` };
  }

  const budget = ascentBudget(design);
  let carried = payloadMass;
  const results = [];

  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i];
    const engine = ENGINES[s.engine];
    if (!engine) return { valid: false, reason: `unknown engine "${s.engine}"` };
    if (engine.propellant !== s.propellant) {
      return { valid: false, reason: `${engine.name} burns ${engine.propellant}, not ${s.propellant}` };
    }
    if (!MATERIALS[s.material]) return { valid: false, reason: `unknown material "${s.material}"` };
    if (i === 0 && !engine.sealevel) {
      return { valid: false, reason: `${engine.name} cannot be used at sea level: its nozzle would flow-separate` };
    }

    // A first stage flies through atmosphere and gets sea-level Isp. Using the
    // vacuum figure down there is a real and common way to cheat a mass budget.
    const isp = i === 0 ? (engine.ispSL ?? engine.ispVac) : engine.ispVac;
    const dv = budget * s.deltaVShare;

    const r = effectiveStructure(s, carried, dv, isp);
    if (r.impossible) {
      return { valid: true, closed: false, failedStage: i, reason: r.reason, plain: r.plain, deltaVAssigned: dv, isp };
    }

    results.unshift({ index: i, name: s.name || `Stage ${i + 1}`, deltaV: dv, isp, ...r, stage: s });
    carried += r.total;
  }

  /* Thrust. The mass budget can close perfectly on a vehicle that cannot leave
   * the pad — the design this check was written for had a liftoff
   * thrust-to-weight of 0.76 and "solved" the problem while physically unable
   * to fly. Engine count was decorative until here; now it is load-bearing.
   *
   * Floors are the loose end of the flown range, so they refuse impossibility
   * without pretending to fly a trajectory: liftoff T/W below ~1.15 cannot
   * climb (real vehicles fly 1.2-1.4); an upper stage below ~0.45 vacuum T/W at
   * ignition is outside anything the fixed ascent budget can represent
   * (Saturn's S-IVB, the weakest flown, was ~0.45). */
  for (let i = 0; i < results.length; i++) {
    const st = results[i];
    const s = st.stage;
    const engine = ENGINES[s.engine];
    const n = s.engineCount;
    if (!Number.isInteger(n) || n < 1) {
      return { valid: false, reason: `${st.name}: engine count not specified — thrust cannot be checked` };
    }

    // Mass this stage must move at ignition: itself plus everything above it.
    let above = payloadMass;
    for (let j = i + 1; j < results.length; j++) above += results[j].total;
    const ignitionMass = st.total + above;

    if (i === 0) {
      const tw = (n * engine.thrustSL) / (ignitionMass * G0);
      if (tw < 1.15) {
        return {
          valid: true, closed: false, failedStage: i,
          reason: `liftoff thrust-to-weight is ${tw.toFixed(2)}: ${n} × ${engine.name} lifts ` +
            `${Math.round(n * engine.thrustSL / G0 / 1000)} t against ${Math.round(ignitionMass / 1000)} t on the pad. ` +
            `Below about 1.15 the vehicle cannot climb. It never leaves the ground.`,
          plain: `${n} of those engines can lift ${Math.round(n * engine.thrustSL / G0 / 1000)} tonnes. ` +
            `the rocket weighs ${Math.round(ignitionMass / 1000)}. it never leaves the pad`,
        };
      }
    } else {
      const tw = (n * engine.thrustVac) / (ignitionMass * G0);
      if (tw < 0.45) {
        return {
          valid: true, closed: false, failedStage: i,
          reason: `${st.name} ignites at thrust-to-weight ${tw.toFixed(2)}. The weakest flown upper ` +
            `stage (Saturn S-IVB) ignited near 0.45; below that, gravity losses run away and the ` +
            `fixed ascent budget no longer describes the flight.`,
          plain: `the upper stage engine is too weak for its own weight — it falls while it burns`,
        };
      }
    }

    /* The engines have to fit inside the dry mass the coefficient claims. On
     * every real stage they are 12-19% of dry mass; past ~40% the remaining
     * budget cannot contain tanks, structure, avionics and recovery hardware,
     * and the claimed coefficient is fiction by arithmetic. */
    const engineMass = n * engine.mass;
    if (engineMass > st.baseDry * 0.4) {
      return {
        valid: true, closed: false, failedStage: i,
        reason: `${st.name}: ${n} × ${engine.name} weighs ${Math.round(engineMass / 1000)} t — ` +
          `${Math.round(engineMass / st.baseDry * 100)}% of the stage's claimed ${Math.round(st.baseDry / 1000)} t ` +
          `dry mass. Real stages spend 12-19% of dry mass on engines; past 40% there is no budget ` +
          `left for the tanks the propellant needs.`,
        plain: `the engines alone weigh most of what the whole empty stage is claimed to weigh. ` +
          `the tank budget is fiction`,
      };
    }
  }

  return {
    valid: true,
    closed: true,
    payloadMass,
    payloadFraction: payloadMass / carried,
    glow: carried,
    stages: results,
    fullyReusable: stages.every(s => s.recovery && s.recovery !== 'none'),
  };
}

/**
 * Best payload fraction still reachable from a partial design, assuming every
 * remaining choice goes as well as physically possible.
 *
 * This is what lets the search prune honestly: if even the most optimistic
 * completion of a branch cannot reach the target, the branch is genuinely dead
 * and the loop can back out and say why. The optimism has to be real optimism —
 * best-ever flown values and theoretical Isp ceilings, never fantasy — because
 * an optimistic bound that is too generous prunes nothing, and one that is too
 * mean prunes live branches and the search quietly lies.
 */
export function optimisticBound(partial, target) {
  const BEST_EPS = 0.030; // a shade better than the best stage ever flown (Falcon 9 S2, 0.035)
  const BEST_ISP = Math.max(...Object.values(THEORETICAL_MAX_ISP_VAC));

  const stages = partial.stages;
  const payloadMass = partial.payloadMass ?? 100000;
  let carried = payloadMass;

  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i];
    const engine = s.engine ? ENGINES[s.engine] : null;
    const isp = engine
      ? (i === 0 ? (engine.ispSL ?? engine.ispVac) : engine.ispVac)
      : (s.propellant ? THEORETICAL_MAX_ISP_VAC[s.propellant] : BEST_ISP);
    const eps = Math.min(s.structuralCoefficient ?? BEST_EPS, BEST_EPS);
    const share = s.deltaVShare ?? 1 / stages.length;

    // Optimistic means optimistic: no thermal protection, no landing hardware,
    // no landing propellant. Only the trajectory penalty stays, because a
    // recovered booster genuinely cannot fly the optimal ascent. A bound that
    // is too generous merely prunes less; one that is too mean prunes live
    // branches and the search quietly lies.
    const dv = ascentBudget(partial) * share;

    const m = stageMass(carried, dv, isp, eps);
    if (m.impossible) return { bound: 0, dead: true, reason: m.reason, plain: m.plain };
    carried += m.total;
  }

  const bound = payloadMass / carried;
  return { bound, dead: bound < target, glow: carried };
}

/**
 * A renderable vehicle from a PARTIAL design.
 *
 * The solver only produces geometry for a finished design, which meant the 3D
 * panel sat empty until an entire path — sixteen decisions for a three-stage
 * vehicle — had been walked. That is the wrong thing to watch: the interesting
 * part is the rocket assembling itself as each choice is made.
 *
 * So this fills the undecided gaps with clearly-flagged provisional values and
 * returns whatever can honestly be drawn. Every stage reports which of its
 * properties are real decisions and which are placeholders, so the view can
 * ghost the parts that have not been chosen yet rather than implying they have.
 */
export function previewVehicle(design) {
  const stages = design?.stages ?? [];
  if (!stages.length) return { stages: [], decided: 0, total: 0, provisional: true };

  const PLACEHOLDER = {
    propellant: 'LOX/CH4',
    diameter: 9,
    structuralCoefficient: 0.06,
    deltaVShare: 1 / stages.length,
  };

  const payloadMass = design.payloadMass ?? 100000;
  const budget = ascentBudget(design);
  let carried = payloadMass;
  const out = [];
  let decided = 0, total = 0;

  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i];
    const known = {
      propellant: s.propellant != null,
      engine: s.engine != null,
      material: s.material != null,
      structure: s.structuralCoefficient != null,
      recovery: s.recovery != null,
      diameter: s.diameter != null,
      split: s.deltaVShare != null,
    };
    decided += Object.values(known).filter(Boolean).length;
    total += Object.keys(known).length;

    const propellant = s.propellant ?? PLACEHOLDER.propellant;
    const engine = s.engine ? ENGINES[s.engine] : null;
    const isp = engine ? (i === 0 ? (engine.ispSL ?? engine.ispVac) : engine.ispVac)
      : THEORETICAL_MAX_ISP_VAC[propellant] * 0.85;
    const eps = s.structuralCoefficient ?? PLACEHOLDER.structuralCoefficient;
    const share = s.deltaVShare ?? PLACEHOLDER.deltaVShare;
    const diameter = s.diameter ?? PLACEHOLDER.diameter;
    const dv = budget * share;

    const m = stageMass(carried, dv, isp, eps);
    // An unclosable partial is still worth drawing — it is a real stage that
    // happens not to work, and seeing it is the point.
    const propellantMass = m.impossible ? carried * 4 : m.propellant;
    const totalMass = m.impossible ? carried * 5 : m.total;
    const geometry = stageGeometry(propellantMass, propellant, diameter);

    out.unshift({
      index: i,
      name: s.name || `Stage ${i + 1}`,
      known,
      provisional: Object.values(known).some(v => !v),
      closes: !m.impossible,
      propellant,
      engine: s.engine ?? null,
      engineCount: s.engineCount ?? null,
      material: s.material ?? null,
      recovery: s.recovery ?? null,
      tps: s.tps ?? null,
      total: totalMass,
      propellantMass,
      dry: totalMass - propellantMass,
      geometry,
      stage: s,
    });
    carried += totalMass;
  }

  return {
    stages: out,
    payloadMass,
    glow: carried,
    decided,
    total,
    provisional: decided < total,
  };
}

/**
 * The same bound calculation, but showing its working.
 *
 * Every line here is arithmetic that was going to happen anyway — this just
 * refuses to throw it away. A research log that only shows conclusions is a
 * chat transcript; one that shows the mass ratio and the coefficient it implies
 * is something an engineer can argue with, which is the entire point.
 */
export function boundWorkings(partial, target) {
  const BEST_EPS = 0.030;
  const BEST_ISP = Math.max(...Object.values(THEORETICAL_MAX_ISP_VAC));
  const stages = partial.stages || [];
  const payloadMass = partial.payloadMass ?? 100000;
  const budget = ascentBudget(partial);

  const lines = [];
  const kg = (x) => x >= 1e6 ? (x / 1e6).toFixed(2) + ' kt' : x >= 1000 ? Math.round(x / 1000) + ' t' : Math.round(x) + ' kg';

  lines.push(`ascent budget      ${budget.toLocaleString()} m/s` +
    (budget > DELTA_V.toLEO ? `  (${DELTA_V.toLEO.toLocaleString()} + ${budget - DELTA_V.toLEO} recovered-booster trajectory penalty)` : ''));
  lines.push(`payload            ${kg(payloadMass)}`);

  let carried = payloadMass;
  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i];
    const engine = s.engine ? ENGINES[s.engine] : null;
    const isp = engine
      ? (i === 0 ? (engine.ispSL ?? engine.ispVac) : engine.ispVac)
      : (s.propellant ? THEORETICAL_MAX_ISP_VAC[s.propellant] : BEST_ISP);
    const eps = Math.min(s.structuralCoefficient ?? BEST_EPS, BEST_EPS);
    const share = s.deltaVShare ?? 1 / stages.length;
    const dv = budget * share + recoveryPenalty(s);
    const r = massRatioFor(dv, isp);
    const epsLimit = 1 / r;

    lines.push('');
    lines.push(`${s.name || 'Stage ' + (i + 1)}`);
    lines.push(`  Δv assigned      ${Math.round(dv).toLocaleString()} m/s` +
      (recoveryPenalty(s) ? `  (${Math.round(budget * share).toLocaleString()} ascent + ${recoveryPenalty(s)} recovery)` : ''));
    lines.push(`  Isp              ${Math.round(isp)} s` +
      (engine ? `  ${engine.name}${i === 0 ? ' at sea level' : ' in vacuum'}` : `  theoretical ceiling for ${s.propellant}`));
    lines.push(`  mass ratio       e^(${Math.round(dv)} / (${Math.round(isp)} × 9.807)) = ${r.toFixed(3)}`);
    lines.push(`  ε must be under  1 / ${r.toFixed(3)} = ${epsLimit.toFixed(4)}`);

    const m = stageMass(carried, dv, isp, eps);
    if (m.impossible) {
      lines.push(`  ε assumed        ${eps.toFixed(4)}  → EXCEEDS THE LIMIT, stage cannot close at any size`);
      return { lines, bound: 0, dead: true, reason: m.reason };
    }
    lines.push(`  ε assumed        ${eps.toFixed(4)}  (best flown is ${BEST_EPS.toFixed(3)}, this is the optimistic case)`);
    lines.push(`  stage mass       ${kg(m.total)}  carrying ${kg(carried)}`);
    carried += m.total;
  }

  const bound = payloadMass / carried;
  lines.push('');
  lines.push(`gross liftoff      ${kg(carried)}`);
  lines.push(`best possible      ${kg(payloadMass)} / ${kg(carried)} = ${(bound * 100).toFixed(2)}%`);
  lines.push(`target             ${(target * 100).toFixed(2)}%   → ${bound < target ? 'DEAD, no completion of this branch can reach it' : 'still alive'}`);

  return { lines, bound, dead: bound < target };
}
