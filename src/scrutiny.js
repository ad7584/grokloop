// The scrutiny gate.
//
// The calculator answers "does the arithmetic close". This answers the harder
// question: "are the numbers you fed it defensible?" Without it the model wins
// on its first afternoon by assuming a tank nobody can build.
//
// The rule is not "you may never beat what has flown". It is "if you beat what
// has flown, you must say how, and the how gets read". A claim with a real
// manufacturing route attached is allowed through to review; a bare number is
// not.

import { ENGINES, THEORETICAL_MAX_ISP_VAC } from '../data/engines.js';
import { MATERIALS, COMPOSITE_LAYUP_EFFICIENCY, specificStrength } from '../data/materials.js';
import { TPS } from '../data/constants.js';
import { bestFlownStructuralCoefficient } from '../data/reference.js';

const BEST = bestFlownStructuralCoefficient();

// How far past the best flown value a claim may go before it must be justified,
// and past which it is refused outright regardless of justification.
export const LIMITS = {
  structuralWarnRatio: 0.85,  // claiming better than 85% of best flown needs an argument
  structuralHardRatio: 0.55,  // better than 55% of best flown is refused: nobody is 2x the field
  ispToleranceS: 2,           // measurement slack against the theoretical ceiling
};

/**
 * Check one design. Returns { passed, violations[], warnings[] }.
 * A violation blocks. A warning demands a manufacturing justification, which is
 * supplied by the model and recorded for review.
 */
export function scrutinise(design) {
  const violations = [];
  const warnings = [];

  for (const [i, s] of design.stages.entries()) {
    const label = s.name || `Stage ${i + 1}`;
    const engine = ENGINES[s.engine];
    const material = MATERIALS[s.material];

    // --- hard physical ceilings -------------------------------------------
    if (engine) {
      const ceiling = THEORETICAL_MAX_ISP_VAC[engine.propellant];
      if (ceiling && engine.ispVac > ceiling + LIMITS.ispToleranceS) {
        violations.push(
          `${label}: ${engine.name} is credited with ${engine.ispVac}s vacuum Isp, above the ` +
          `${ceiling}s theoretical ceiling for ${engine.propellant}. That is not an engineering ` +
          `claim, it is a chemistry violation.`);
      }
    }

    // --- the engine must be able to fly THIS mission -----------------------
    // These are facts about hardware, not judgments, and no quantity of
    // justification prose overrides them. The design that slipped through
    // before this check carried its own confession in the justification text —
    // "RS-25 restart is unflown, fails first" — and passed anyway, because the
    // gate measured the paragraph's length instead of acting on its content.
    const recoveredHere = s.recovery && s.recovery !== 'none';
    if (engine && recoveredHere) {
      const propulsiveLanding = s.recovery === 'RTLS' || s.recovery === 'downrange' || s.recovery === 'orbital';
      if (propulsiveLanding && engine.restartInFlight === false) {
        violations.push(
          `${label}: ${engine.name} cannot restart in flight. A propulsive landing needs a ` +
          `landing burn, and there is no engine to light it with.`);
      }
      if (engine.rapidReuse === false) {
        violations.push(
          `${label}: ${engine.name} has never been rapidly reusable — Shuttle-era refurbishment ` +
          `took months of teardown per flight, and no RL10 has ever flown twice. The requirement ` +
          `is full AND RAPID reuse; this engine is disqualified by its own service history.`);
      }
    }

    // --- structural coefficient -------------------------------------------
    const recovered = s.recovery && s.recovery !== 'none';
    // An orbital stage that comes home is a different animal from a booster
    // that comes home: it reaches orbital velocity and reenters from it, so it
    // carries thermal protection a booster never needs.
    const isOrbitalStage = s.recovery === 'orbital';
    const claimed = s.structuralCoefficient;

    // There is no flight-proven anchor for a recovered orbital stage, because
    // no such stage has ever flown. Falcon 9's recovered booster is the closest
    // thing that exists, and it stages well below orbital velocity.
    const anchor = !recovered ? BEST.expendable
      : (BEST.recoveredOrbital ?? BEST.recoveredSuborbital);
    const anchorName = !recovered ? 'expended'
      : (BEST.recoveredOrbital ? 'recovered orbital' : 'recovered booster');

    if (claimed != null && anchor != null) {
      if (claimed < anchor * LIMITS.structuralHardRatio) {
        violations.push(
          `${label}: claimed structural coefficient ${claimed.toFixed(4)} is ${(anchor / claimed).toFixed(1)}x ` +
          `better than the best ${anchorName} stage ever flown (${anchor.toFixed(4)}). ` +
          `Refused — no manufacturing argument closes a gap that size.`);
      } else if (claimed < anchor * LIMITS.structuralWarnRatio) {
        warnings.push({
          field: 'structuralCoefficient',
          stage: label,
          message:
            `${label}: claimed structural coefficient ${claimed.toFixed(4)} beats the best ` +
            `${anchorName} stage (${anchor.toFixed(4)}) by ` +
            `${((1 - claimed / anchor) * 100).toFixed(0)}%. Requires a manufacturing route.`,
          justification: s.structuralJustification ?? null,
        });
      }
    }

    /* An orbital stage that comes home has no precedent at all. Whatever number
     * is claimed for it is an extrapolation, and the honest thing is to say so
     * every time rather than quietly borrowing a booster's record. */
    if (isOrbitalStage && claimed != null && BEST.recoveredOrbital == null) {
      warnings.push({
        field: 'structuralCoefficient',
        stage: label,
        message:
          `${label}: no orbital stage has ever been recovered and reflown, so there is no flight ` +
          `record to check ${claimed.toFixed(4)} against. The closest comparison is Falcon 9's ` +
          `booster at ${BEST.recoveredSuborbital.toFixed(4)}, which stages far below orbital ` +
          `velocity and carries no orbital heat shield. Requires a route, not a comparison.`,
        justification: s.structuralJustification ?? null,
      });
    }

    /* Hydrogen's bulk density is roughly 40% of methalox, so its tanks are far
     * larger for the same propellant mass and every hydrolox stage ever flown
     * lands in the 9-13% band. A model proposing hydrogen must accept that or
     * argue its way out. */
    if (s.propellant === 'LOX/LH2' && claimed != null && claimed < 0.085) {
      warnings.push({
        field: 'structuralCoefficient',
        stage: label,
        message:
          `${label}: ${claimed.toFixed(4)} on hydrogen. Every hydrolox stage ever flown sits ` +
          `between 0.09 and 0.13 (Delta IV CBC 0.118, Centaur III 0.097, S-IVB 0.126) because ` +
          `liquid hydrogen bulk density is under half that of methalox and the tanks balloon. ` +
          `Requires a route.`,
        justification: s.structuralJustification ?? null,
      });
    }

    // --- material reality --------------------------------------------------
    if (material) {
      if (material.name.startsWith('Carbon') && !s.layupEfficiencyApplied) {
        warnings.push({
          field: 'material',
          stage: label,
          message:
            `${label}: composite unidirectional strength is a coupon figure. A real layup delivers ` +
            `around ${(COMPOSITE_LAYUP_EFFICIENCY * 100).toFixed(0)}% of it, and cryogenic cycling ` +
            `drives matrix microcracking — the failure that ended X-33. Requires a route that ` +
            `addresses permeation and inspection between flights.`,
          justification: s.materialJustification ?? null,
        });
      }

      // A stage that reenters with no thermal protection must survive on its
      // structure alone, which almost no tank material can do.
      if (recovered && !s.tps && s.recovery === 'orbital' && material.maxServiceTempK < 1100) {
        violations.push(
          `${label}: reenters from orbital velocity with no thermal protection, on ${material.name}, ` +
          `which loses strength above ${material.maxServiceTempK}K. The stage does not survive to land.`);
      }
    }

    // --- reuse bookkeeping -------------------------------------------------
    if (recovered && (s.landingHardwareFraction ?? 0) === 0) {
      violations.push(
        `${label}: recovered but carries zero landing hardware mass. Legs, catch fittings, grid ` +
        `fins and actuators are not free.`);
    }
    if (s.recovery === 'orbital' && !s.tps) {
      violations.push(
        `${label}: recovered from orbit with no thermal protection system specified.`);
    }
    if (s.tps && !TPS[s.tps]) {
      violations.push(`${label}: unknown thermal protection system "${s.tps}".`);
    }
    if (s.tps && TPS[s.tps] && !TPS[s.tps].reusable) {
      warnings.push({
        field: 'tps',
        stage: label,
        message:
          `${label}: ${s.tps} is ablative — it is consumed on each flight and must be replaced. ` +
          `That is reusable but not RAPIDLY reusable, which is the requirement.`,
        justification: s.tpsJustification ?? null,
      });
    }
  }

  // Full reuse is the entire premise; an expended stage is not a cheaper answer.
  if (!design.stages.every(s => s.recovery && s.recovery !== 'none')) {
    violations.push(
      'Not fully reusable: at least one stage is expended. Falcon 9 already reaches 4% that way. ' +
      'The problem is 4% with everything recovered.');
  }

  const unjustified = warnings.filter(w => !w.justification || w.justification.length < 40);

  return {
    passed: violations.length === 0 && unjustified.length === 0,
    violations,
    warnings,
    unjustified,
  };
}

/** One-line summary for the terminal and for X. */
export function summarise(result) {
  if (result.passed) return 'assumptions accepted';
  if (result.violations.length) return result.violations[0];
  return result.unjustified[0].message + ' No route given.';
}

export { BEST as BEST_FLOWN };
