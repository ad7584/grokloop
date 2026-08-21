# GROK LOOP

Grok 4.6 researching one problem, continuously, in public: **a fully and rapidly
reusable orbital rocket that puts at least 4% of its liftoff mass into orbit.**

That is the number Musk named on the Howard Stern interview as the threshold for
full reusability, and the same interview where he said it is so preposterously
difficult that he sometimes wonders whether it can be done at all. Nobody has hit
it. Falcon 9 reaches 4.15% only by throwing its second stage away. Starship,
fully reusable, targets about 2% — and has not yet reached orbit at all.

The loop picks a path, works the numbers, hits a wall, backs out, and takes a
different path. The site shows the reasoning on the left and the vehicle on the
right, with every part labelled and every mass real.

## The one rule everything else follows

**Grok chooses what to try. Code decides what survives.**

The model proposes options and argues for them. It never scores its own work.
[`src/physics.js`](src/physics.js) computes the mass budget from the Tsiolkovsky
equation and real constants, and a design either closes or it does not. A
language model is very good at confident prose about aerospace and cannot talk
its way past a mass budget that fails to balance.

The model also cannot invent hardware. It selects from
[`data/engines.js`](data/engines.js), [`data/materials.js`](data/materials.js)
and [`data/propellants.js`](data/propellants.js) — real, flown or
flight-qualified, every figure carrying a source and a confidence flag. If it
wants a number better than anything ever built, it has to say how the part is
manufactured, and [`src/scrutiny.js`](src/scrutiny.js) reads the answer.

## How the search works

A node is one committed decision; the path from root to node is a partial
vehicle. At each step the loop takes the most promising unexplored branch, asks
Grok for two to four options worth trying there, and computes an **optimistic
bound** for each — the best payload fraction still reachable if every remaining
choice goes as well as physics permits.

If even that bound falls short of 4%, the branch is genuinely dead and is cut.
That is branch-and-bound, and the cut is always made by arithmetic, never by the
model's opinion. When the best remaining branch is elsewhere in the tree, the
loop walks back to it — and that walk back is the thing the site exists to show.

The optimism has to be real optimism. A bound that is too generous prunes
nothing; one that is too mean prunes live branches and the search quietly lies.

## Calibration — the part that makes the rest worth reading

Falcon 9 is the only launcher with **two published payload figures for the same
hardware**, expendable and droneship. That pins both the ascent budget and the
true cost of recovery, and [`test/calibration.test.js`](test/calibration.test.js)
holds the model to both:

| | model | published |
|---|---|---|
| Falcon 9 expendable | **22,804 kg** | 22,800 kg |
| Falcon 9, booster recovered | **18,268 kg** | 17,500–18,500 kg |

The ascent budget of 9,428 m/s is not a chosen number — it is what Falcon 9's
declared masses and declared payload *imply*. Edit it to make a design close and
the calibration test fails and says so.

### Recovery costs three things, not one

Getting this wrong in either direction wrecks the search, and both errors were
made and caught during the build:

1. **Landing propellant** — reserved, and **inert during ascent**. It is *not* a
   delta-v surcharge on the whole stack: the landing burn happens after
   separation and accelerates only the empty booster. Charging it to the full
   vehicle prices reuse at ~37% against the real ~23%, and pushes the search to
   conclude reusability is impossible for reasons that are pure modelling
   artefact.
2. **Landing hardware** — legs, catch fittings, grid fins, actuators.
3. **Trajectory de-optimisation** — a booster that means to come home must stage
   lower and shallower, costing ~300 m/s of ascent. Leaving this out makes the
   whole search about half a percentage point too optimistic, which is larger
   than any single hardware assumption in the model.

On a Starship-class vehicle the booster's claimed structural coefficient of
0.075 becomes an **effective 0.148** once all three are paid for, 540 t of it
landing propellant. The site lists every one of those masses.

## What else it reproduces

- A hydrogen **SSTO passes the optimistic bound** — it is *not* pruned, because
  on paper it closes. That is exactly why single-stage-to-orbit keeps getting
  proposed, and the bound must not prune it early or the search would be hiding
  the most instructive dead end in the field.
- The same SSTO on flight-realistic numbers **fails to close**: *structural
  coefficient 0.0800 cannot buy 11,400 m/s at Isp 366s: the required mass ratio
  of 23.95 times the dry fraction exceeds one, so the stage cannot close at any
  scale.*
- Thermal protection is a **smaller burden on a larger vehicle** — it scales
  with area while propellant scales with volume. Payload fraction is therefore
  not scale-invariant, which is why the solver works in absolute kilograms.

## The empty bucket

The flight record splits three ways, and the third is the point:

```
expendable           0.0359   Falcon 9 upper stage
recoveredSuborbital  0.0513   Falcon 9 booster
recoveredOrbital     null     nobody has ever flown one
```

No orbital stage has ever been recovered and reflown. As of August 2026 Starship
has never reached a stable orbit and no ship has been recovered, so its published
masses are **targets, not achievements**, and are excluded from the flown record
entirely.

That matters because those figures are internally inconsistent: run them through
the rocket equation and they imply a fully reusable payload above 4% while
SpaceX quotes about 2%. Admitting them as evidence would let the search win on
day one by citing a real source — the exact exploit this separation closes.

So any claim about a recovered orbital stage gets the honest answer rather than a
borrowed one: *no orbital stage has ever been recovered and reflown, so there is
no flight record to check this against. Requires a route, not a comparison.*

## Running it

```bash
git clone https://github.com/ad7584/grokloop && cd grokloop && cp .env.example .env
```

Put an OpenRouter key in `.env`, then:

```bash
npm run serve
```

| | |
|---|---|
| `npm run serve` | the website and the loop, on port 4300 |
| `npm run step` | one decision, now |
| `npm run loop` | run continuously in the terminal |
| `npm run status` | counters, spend, current path |
| `npm run tree` | print the whole search tree with kill reasons |
| `npm run reset` | wipe the search and start over |
| `npm test` | 44 tests, no key needed |

Cost is roughly $0.02–0.05 per decision on `x-ai/grok-4.6`. At a step every seven
minutes that is a few dollars a day, and `DAILY_BUDGET_USD` stops it dead.

## Honesty rules baked in

- The site never fakes activity. Idle, broken and out-of-budget each say so in
  plain words, with the real reason.
- Every kill reason shown is the solver's actual output, not a paraphrase.
- Data files carry `confidence: published | established | estimate`. Starship's
  figures are marked `estimate` because they are targets that have moved across
  versions.
- The loop cannot mark itself solved. `status: 'solved'` is set only when
  `evaluate()` closes above 4% **and** the scrutiny gate passes.

## Live

- **grokloop.live** — the site. Research log, streamed chain of thought, the
  vehicle, the archive.

## The false solve, and what it changed

On its first day the loop declared victory: a two-stage hydrogen vehicle with
two RS-25s closed at 4.01% and passed scrutiny. An hour later a thrust check
showed its liftoff thrust-to-weight was **0.77** — the rocket could not leave the
pad. Engine count had been decorative, and the scrutiny gate was measuring the
*length* of a justification rather than acting on its content, so the model's own
admission ("RS-25 restart is unflown, fails first") sailed through.

The run was wiped (archived, not deleted — it is still on the volume) and the
rules were hardened. A design now also has to survive:

- **liftoff thrust-to-weight ≥ 1.15** with the engines actually chosen;
- **upper-stage ignition ≥ 0.45** — the weakest flown (Saturn's S-IVB);
- **engines inside the dry mass** the coefficient implies — real stages spend
  12–19% of dry mass on engines, past 40% the tank budget is fiction;
- an engine that can **restart in flight** on any propulsively landed stage;
- an engine with a **rapid-reuse service history** on any recovered stage. RS-25
  needed months of teardown per flight; no RL10 has flown twice. Both are
  disqualified by their own record — which closes the hydrolox-booster line,
  exactly as reality did.

Re-scored under the new gates, the old winner is refused five separate ways.

## Known limits

- Community forking and PR judging is deliberately not built. Adding it means an
  agent reading untrusted text while holding merge and posting authority, which
  needs the reader and the actor structurally separated first.
- The delta-v split, recovery penalties and TPS areal densities are the softest
  numbers in the model. They are flagged `estimate` and are the first place to
  look if a result seems wrong.
- There is no flight-proven anchor for a recovered orbital stage, because none
  exists. Any coefficient claimed for one is an extrapolation, and the gate says
  so every time rather than borrowing a booster's record.
